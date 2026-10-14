# Database Keepalive

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
