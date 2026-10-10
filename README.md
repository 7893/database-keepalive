# Keepalive

One Cloud Run service provides the public dashboard, database reads, and authenticated
manual and scheduled check-ins. [Open the dashboard](https://keepalive-jrvcceccza-uc.a.run.app/).

Five targets: Supabase, US ADB, Japan ADB, IBM Db2, and Japan MySQL.
US MySQL already has business traffic and is excluded.

```text
Cloud Scheduler ── authenticated POST ──┐
Browser ── dashboard / reads / admin ───┤
                                       ▼
                              Cloud Run service
                               ├─ HTTPS → Supabase / US ADB / Japan ADB
                               ├─ JDBC TLS → Db2
                               └─ MySQL TLS → Cloudflare TCP Tunnel → Japan MySQL
```

Japan runs only the cloudflared connector. There is no Worker, separate Cloud Run
Job, or HTTP database bridge. Runtime credentials are Cloud Run environment
variables; releases preserve them. GitHub authenticates to GCP using OIDC,
without a service-account key or database secrets.

## Development

Node.js 26.10.0 and npm 11.19.1 are pinned. Native driver tests use Python 3.
There are no npm dependencies. The single root Dockerfile supplies Python, Java,
cloudflared, and checksum-verified public Db2 dependencies.

```sh
npm ci
npm run check
npm test
npm run test:native
```

Tests use mocks and do not contact production databases. `npm run dev` starts the
server when native dependencies and environment variables are already available;
see [.env.example](.env.example). Never commit populated environment files.

| Directory | Responsibility |
| --- | --- |
| `service/` | HTTP server, scheduled handler, shared backend wiring and native RPC |
| `src/` | Routing, authentication, HTTPS adapters and dashboard |
| `native/` | Db2/MySQL drivers and transaction tests |
| `scripts/` | Source checks, public build dependencies and release smoke check |
| `migrations/` | Bootstrap SQL; existing deployments do not need to rerun it |

## Routes

| Route | Method | Authentication |
| --- | --- | --- |
| `/` | GET / HEAD | Public dashboard |
| `/api/data?service=...` | GET | Public, masked IPs by default |
| `/trigger` | POST | Bearer `TRIGGER_SECRET` |
| `/debug` | GET | Bearer `TRIGGER_SECRET` |
| `/admin/clean?action=repair` | POST | Bearer `TRIGGER_SECRET` |
| `/admin/clean?action=delete` | DELETE | Bearer `TRIGGER_SECRET` |
| `/internal/checkin` | POST | `X-Keepalive-Scheduler: SCHEDULER_TOKEN` |

Service identifiers: `supabase`, `adb_us`, `adb_jp`, `db2`, `mysql_jp`.
Cleanup applies to the existing Supabase/Oracle maintenance operations.
Three UTC schedules remain `23 1 * * *`, `47 9 * * *`, `11 17 * * *`.

## Releases

Pushes and pull requests run checks. Run **Check and release** manually from
`main`, selecting a commit or tag contained in `main`, to build and deploy that
exact version. The release preserves existing Cloud Run environment variables
and IAM policy, then checks the public page, all five reads, and authentication.

See [deployment and configuration](service/README.md),
[database initialization](migrations/README.md), and [contributing](CONTRIBUTING.md).
The pre-cleanup source is retained in Git under `cloudrun-migration-baseline`.
