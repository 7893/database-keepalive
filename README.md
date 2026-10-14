<a id="english"></a>

# Database Keepalive

[English](#english) · [简体中文](#简体中文)

Automatic database check-ins with a read-only dashboard, powered by Cloudflare
Workers and TypeScript. Supports Supabase, Oracle Autonomous Database and MySQL.

[Live dashboard](https://database-keepalive.53.workers.dev) ·
[CI and deployment](https://github.com/7893/database-keepalive/actions/workflows/ci.yml) ·
[Database setup](migrations/README.md)

One Worker serves the dashboard. A SQLite-backed Durable Object coordinates all
database check-ins using alarms, with a five-minute Cron watchdog for recovery.
Private MySQL connections use Hyperdrive and an existing Cloudflare Tunnel.

- **Automatic check-ins:** fixed daily counts or a random range, with random times.
- **Reliable retries:** stable request IDs and unique indexes prevent duplicate writes.
- **Read-only dashboard:** recent records, connection status and the next scheduled time.
- **UTC storage, configurable display:** Hong Kong time (`Asia/Hong_Kong`) by default.
- **GitHub deployment:** push to `main`; checks pass, then the Worker is deployed.

## Supported databases

| Database | Connection | Credentials |
| --- | --- | --- |
| Supabase | HTTPS / PostgREST | Server-side secret key |
| Oracle Autonomous Database | HTTPS / ORDS REST SQL | ORDS schema credentials |
| MySQL | Cloudflare Hyperdrive | Stored in Hyperdrive |

Configure one or more instances, including any mix of repeated instances of the
same type. The application imposes no fixed node-count limit.
Each database stores its own check-in history. The dashboard reads those actual
records; it does not maintain a separate copy.

## Quick start

Requires Node.js 24+, npm, a Cloudflare account and an existing supported database.
Fork the repository if you want GitHub Actions to deploy your own installation,
then clone your fork. To try it locally:

```sh
git clone https://github.com/7893/database-keepalive.git
cd database-keepalive
npm ci
cp config.example.toml config.local.toml
```

1. Edit `config.local.toml` following its inline comments. Keep only the database
   blocks you use and fill in your settings and credentials.
2. Initialize new tables with the appropriate [SQL script](migrations/README.md).
   Existing installations should follow the migration notes there. Complete the
   retention setup too: the default keeps the newest 64 records.
3. If using MySQL, configure [Hyperdrive](#mysql-setup) first. Replace the repository's
   Hyperdrive ID with your own. If you do not use MySQL, remove the `hyperdrive`
   section from `wrangler.jsonc`.
4. Run `npm run types` after changing `wrangler.jsonc`.

```sh
npm run configure
npm run dev
```

Open the local URL printed by Wrangler. The dashboard only reads records; there
is no manual check-in button or HTTP write endpoint.

`configure` validates your settings and creates `.dev.vars` and
`.secrets.local.json`. All three local configuration files contain credentials,
are ignored by Git, and must remain private.

## Deploy with GitHub Actions

**First installation:** create the Worker and upload its database secrets once:

```sh
npx wrangler login
npm run bootstrap
```

This also installs the dashboard, scheduler Durable Object and five-minute Cron
watchdog. The first watchdog invocation starts scheduling. Use
`CLOUDFLARE_ACCOUNT_ID` to select your account when needed. The Worker URL appears
in the output. Cron changes can take several minutes to propagate.

In your GitHub repository, open **Settings → Secrets and variables → Actions**:

| Setting | Kind | Value |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | API token with Workers deployment permissions for your Cloudflare account |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Account containing your Worker and Hyperdrive |

**Routine releases:** push to `main`. The workflow installs dependencies once,
checks types, runs tests, validates the bundle, then deploys. Pull requests only
run checks. You can also start **CI and Deploy** manually on `main`. Without the
account variable, deployment is skipped.

Database credentials stay in Cloudflare Worker secrets and Hyperdrive; they do
not need to be copied into GitHub. To update Worker database credentials, edit
`config.local.toml` and run `npm run secrets:update`. This also applies changes to
the display timezone, daily counts and configured nodes.

Configuration fields, defaults and examples are documented in
[`config.example.toml`](config.example.toml). Edit `config.local.toml`, then run
`npm run configure` locally or `npm run secrets:update` for the deployed Worker.
GitHub deployments reuse the existing Worker secrets.

**Upgrading from JSON:** copy the TOML template and transfer your values from
`config.local.json`; that legacy file is no longer read. If a retention setting
has both rules, keep only the first rule from the old JSON (the previously active
one). Run `npm run secrets:update` before deploying the updated code.

## MySQL setup

1. Create a Hyperdrive configuration using your MySQL credentials and **disable
   query caching**, so reads can verify newly committed writes.
2. For private MySQL, select its existing Tunnel hostname and Access service token.
   The Tunnel connector must remain running in the database's network.
3. Enable TLS certificate verification. Upload a private CA when needed and use
   `VERIFY_CA`, or `VERIFY_IDENTITY` when the hostname matches.
4. Set the Hyperdrive ID and binding in `wrangler.jsonc`. Match the binding name
   in `config.local.toml`, then run `npm run types`.

The checked-in Hyperdrive ID belongs to this project's live installation. It is
not a credential, but it is not portable to another Cloudflare account. Replace
it for your installation, or remove the binding if you do not use MySQL.

```json
"hyperdrive": [{ "binding": "MYSQL_JP", "id": "your-hyperdrive-id" }]
```

For local MySQL development, set
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_MYSQL_JP`, or use
`npx wrangler dev --remote` to read through the deployed Hyperdrive connection.

See Cloudflare's [private database guide](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/)
and [TLS guide](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/).
Access service tokens need renewal before expiry.

## How scheduling works

Every database gets its own daily count and random hour, minute and second.
The scheduler shuffles database order and allocates distinct seconds across the
entire fleet. Configuration order only controls the dashboard card order.

One named Durable Object persists the daily plan and executes one check-in per
alarm. It waits at least one second after an attempt finishes before starting
another database or retry, so slow requests and overdue work are serialized too.
Alarms target the planned second; platform or network delays can make actual
writes later. The dashboard uses the same persisted plan; overdue times are
queue estimates and can move when a preceding operation takes longer.

Cron (`*/5 * * * *`) only restores a missing alarm; it never writes check-ins.
The scheduler wakes at UTC midnight to create the next day's plan. Existing
plans survive restarts and deployments. Added databases and daily-count changes
apply to the next UTC day's plan; removed databases stop at the next alarm.
Credentials and retention settings are read from the current configuration.

Failed attempts retry after five minutes, within 15 minutes of the original
planned time, through the same serial queue. Retries reuse the same request ID;
a committed receipt prevents duplicate inserts even after an interrupted alarm.
Expired work is skipped rather than backfilled. At high load, serialization and
slow databases can reduce successful counts. Keep instance IDs stable.

When first switching from the old Cron writer to the new scheduler, prefer the
UTC day boundary: old check-ins are not imported into the new daily plan. Deploy
the included Durable Object binding and migration together with the code.

Tables store UTC timestamps with microsecond precision; the API returns UTC with
`Z`, and the dashboard uses the configured `timezone` (Hong Kong by default). This
changes display only, not the UTC day used for scheduling.

The dashboard shows recent stored results and current read errors. It is not a
complete failure log; scheduled failures appear in Workers Logs as
`scheduled_checkin` events. The dashboard is public, including database names,
regions and recent activity. See [security guidance](SECURITY.md).

Check-in activity does not guarantee that a provider will retain a free database.
Provider policies, quotas and outages still apply.

## Development

```sh
npm run check   # Generated bindings and TypeScript
npm test        # Scheduling, retries, database adapters and read-only HTTP
npm run build  # Bundle validation without deployment
```

Tests use fake connections and responses, with no production writes. For a
scheduled-handler check against a deliberately chosen database configuration,
run `npx wrangler dev --test-scheduled` and request `/__scheduled` to wake the
scheduler. Its alarms can write when an event is due.

## License

[MIT](LICENSE)

---

# 简体中文

[English](#english) · [简体中文](#简体中文)

Database Keepalive 是基于 Cloudflare Workers 和 TypeScript 的数据库自动打卡工具，
配有只读看板，支持 Supabase、Oracle Autonomous Database 和 MySQL。

[在线看板](https://database-keepalive.53.workers.dev) ·
[CI 与部署](https://github.com/7893/database-keepalive/actions/workflows/ci.yml) ·
[数据库初始化](migrations/README.md)

Worker 提供看板服务；使用 SQLite 存储的 Durable Object 通过告警统一调度所有数据库的打卡任务，
每五分钟运行一次的 Cron 负责恢复调度。私有 MySQL 通过 Hyperdrive 和现有 Cloudflare Tunnel 连接。

- **自动打卡：** 每日次数可固定或在范围内随机，打卡时间随机。
- **可靠重试：** 使用稳定的请求 ID 和唯一索引，防止重复写入。
- **只读看板：** 展示最近记录、连接状态和下一次计划时间。
- **UTC 存储、可配置显示时区：** 默认使用香港时间（`Asia/Hong_Kong`）显示。
- **GitHub 部署：** 推送到 `main` 后，检查通过才会部署 Worker。

## 支持的数据库

| 数据库 | 连接方式 | 凭据 |
| --- | --- | --- |
| Supabase | HTTPS / PostgREST | 服务端密钥 |
| Oracle Autonomous Database | HTTPS / ORDS REST SQL | ORDS schema 凭据 |
| MySQL | Cloudflare Hyperdrive | 存储在 Hyperdrive 中 |

可以配置一个或多个实例，同一种数据库也可以配置多个节点，并与其他类型混用。
应用没有固定的节点数量上限。每个数据库保存自己的打卡历史，看板直接读取这些记录，不另外维护副本。

## 快速开始

需要 Node.js 24+、npm、Cloudflare 账号，以及一个已经可用的受支持数据库。
如果希望通过 GitHub Actions 部署自己的实例，请先 Fork 仓库，再克隆自己的 Fork。
本地试运行步骤如下：

```sh
git clone https://github.com/7893/database-keepalive.git
cd database-keepalive
npm ci
cp config.example.toml config.local.toml
```

1. 按照 `config.local.toml` 中的注释填写配置和凭据，只保留实际使用的数据库配置块。
2. 使用对应的 [SQL 脚本](migrations/README.md) 初始化新表。已有实例请遵循其中的迁移说明。
   同时完成历史记录清理所需的设置：默认保留最新 64 条记录。
3. 使用 MySQL 时，先配置 [Hyperdrive](#mysql-配置)，并将仓库中的 Hyperdrive ID 替换为自己的 ID。
   不使用 MySQL 时，删除 `wrangler.jsonc` 中的 `hyperdrive` 配置段。
4. 修改 `wrangler.jsonc` 后，运行 `npm run types`。

```sh
npm run configure
npm run dev
```

打开 Wrangler 输出的本地地址。看板只读取记录，不提供手动打卡按钮或 HTTP 写入接口。

`configure` 会校验配置并生成 `.dev.vars` 和 `.secrets.local.json`。
这两个文件和 `config.local.toml` 都包含凭据，已被 Git 忽略，必须妥善保密。

## 使用 GitHub Actions 部署

**首次安装：** 创建 Worker，并上传一次数据库密钥：

```sh
npx wrangler login
npm run bootstrap
```

这也会部署看板、调度用的 Durable Object 和每五分钟运行一次的 Cron 恢复任务。
第一次 Cron 调用后开始调度。需要指定账号时，使用 `CLOUDFLARE_ACCOUNT_ID`。
Worker 地址会显示在命令输出中。Cron 配置变更可能需要几分钟才能传播生效。

在 GitHub 仓库中，打开 **Settings → Secrets and variables → Actions**：

| 设置项 | 类型 | 内容 |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | 对目标 Cloudflare 账号具有 Workers 部署权限的 API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Worker 和 Hyperdrive 所在账号的 ID |

**日常发布：** 推送到 `main`。workflow 会安装一次依赖，检查类型、运行测试、验证构建，然后部署。
Pull Request 只运行检查。也可以在 `main` 上手动运行 **CI and Deploy**。
如果没有配置账号变量，部署步骤会跳过。

数据库凭据保存在 Cloudflare Worker secrets 和 Hyperdrive 中，无需复制到 GitHub。
要更新 Worker 的数据库凭据，修改 `config.local.toml`，然后运行 `npm run secrets:update`。
显示时区、每日次数和节点列表的变更也通过这个命令上传。

配置字段、默认值和填写示例都在 [`config.example.toml`](config.example.toml) 的注释中。
修改 `config.local.toml` 后，本地开发运行 `npm run configure`，已部署的 Worker 运行
`npm run secrets:update`。GitHub 部署会复用现有的 Worker secrets。

**从 JSON 升级：** 复制 TOML 模板，将原 `config.local.json` 中的值迁移过去；程序不再读取旧 JSON 文件。
如果某项清理配置同时包含两条规则，只保留旧 JSON 中排在前面的那条，即原先实际生效的规则。
部署新代码前，先运行 `npm run secrets:update`。

## MySQL 配置

1. 使用自己的 MySQL 凭据创建 Hyperdrive 配置，并**关闭查询缓存**，确保读取能验证刚提交的写入。
2. 对于私有 MySQL，选择现有的 Tunnel 主机名和 Access 服务令牌。
   Tunnel 连接器必须持续运行在数据库所在网络中。
3. 启用 TLS 证书验证。必要时上传私有 CA，并使用 `VERIFY_CA`；主机名匹配时可使用 `VERIFY_IDENTITY`。
4. 在 `wrangler.jsonc` 中设置 Hyperdrive ID 和 binding。
   `config.local.toml` 中的 binding 名称必须与之对应，然后运行 `npm run types`。

仓库中的 Hyperdrive ID 属于本项目的线上实例。它不是凭据，但不能直接用于其他 Cloudflare 账号。
部署自己的实例时请替换；不使用 MySQL 时请移除对应 binding。

```json
"hyperdrive": [{ "binding": "MYSQL_JP", "id": "your-hyperdrive-id" }]
```

本地开发 MySQL 连接时，设置 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_MYSQL_JP`，
或者运行 `npx wrangler dev --remote`，通过已部署的 Hyperdrive 连接读取数据库。

参见 Cloudflare 的[私有数据库连接指南](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/)
和 [TLS 指南](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/)。
Access 服务令牌需要在到期前续期。

## 调度原理

每个数据库分别确定每日打卡次数，并随机生成小时、分钟和秒。
调度器会打乱数据库顺序，为整个数据库列表分配互不重复的秒级时间。
配置文件中的排列顺序只决定看板卡片顺序。

一个固定名称的 Durable Object 持久保存每日计划，每次告警执行一个打卡任务。
一次尝试结束后至少间隔一秒，才会开始另一个数据库的打卡或重试；慢请求和积压任务也会串行执行。
告警以计划中的秒为目标，但平台或网络延迟可能使实际写入稍晚。
看板读取同一份持久化计划；积压任务的时间是排队估算值，会随前序任务耗时变化。

Cron（`*/5 * * * *`）只负责恢复缺失的告警，不直接写入打卡记录。
调度器在 UTC 零点唤醒并创建新一天的计划，已有计划在重启和重新部署后仍然保留。
新增数据库和每日次数调整从下一个 UTC 日的计划开始生效；移除的数据库在下一次告警时停止执行。
凭据和历史记录清理设置使用当前配置。

失败任务在五分钟后重试，重试必须位于原计划时间之后的 15 分钟窗口内，并进入同一个串行队列。
重试复用相同的请求 ID；已经提交的记录会阻止重复插入，即使告警执行曾被中断。
超过重试窗口的任务会跳过，不补打。负载较高时，串行排队和慢数据库可能减少实际成功次数。
请保持实例 ID 稳定。

首次从旧 Cron 打卡方式切换到新调度器时，建议选择 UTC 日切换时刻：
旧打卡记录不会导入新每日计划。部署代码时，必须同时部署仓库中对应的 Durable Object binding 和迁移配置。

数据库表以微秒精度保存 UTC 时间；API 返回带 `Z` 的 UTC 时间，看板按配置的 `timezone` 显示，默认香港时间。
显示时区不会改变调度使用的 UTC 日期。

看板展示最近保存的结果和当前读取错误，不是完整的失败日志。
定时任务失败可在 Workers Logs 中查看 `scheduled_checkin` 事件。
看板是公开的，数据库名称、地区和最近活动也会公开。详见[安全说明](SECURITY.md)。

打卡不能保证服务商永久保留免费数据库；服务商政策、配额和故障仍会影响服务。

## 开发

```sh
npm run check   # 检查生成的 binding 类型和 TypeScript
npm test        # 测试调度、重试、数据库适配器和只读 HTTP 接口
npm run build   # 验证构建，不执行部署
```

测试使用模拟连接和响应，不写入生产数据库。
如果要针对明确选定的数据库配置验证调度处理器，运行 `npx wrangler dev --test-scheduled`，
再请求 `/__scheduled` 唤醒调度器；其告警在任务到期时可能写入数据库。

## 许可证

[MIT](LICENSE)
