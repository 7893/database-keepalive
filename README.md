# Keepalive

A Cloud Run service that checks Supabase, US/Japan Oracle Autonomous Database,
Japan MySQL, and IBM Db2. The same service provides the public dashboard,
paginated reads, and authenticated manual/scheduled writes.

[Open the live dashboard](https://keepalive-jrvcceccza-uc.a.run.app/).
See [the current service deployment guide](service/README.md). Japan MySQL is
reached through Cloudflare TCP Tunnel; no Worker or HTTP database bridge is
needed in the final deployment. US business MySQL is excluded.

## Features

- Scheduled and authenticated manual keepalive runs
- Supabase, Oracle ORDS, MySQL, and IBM Db2 adapters
- Public dashboard and paginated JSON API
- Bounded native driver work and 60-second coalesced database reads
- Fail-closed administrative routes
- Upstream request timeouts and structured error responses
- Default IP masking and HTML escaping
- Local secret scanning and a 400-line source-file limit

## Architecture

```text
service/                 Cloud Run HTTP server, native drivers and scheduler handler
bridge/db.py             Shared Db2 driver (legacy bridge server is not deployed)
bridge/mysql_db.py       Shared MySQL driver over CFD TCP
src/
├── index.js              Legacy Worker entry point for rollback
├── router.js             HTTP routing and validation
├── scheduled.js          Legacy Worker cron implementation
├── service-registry.js   Service dispatch and aggregation
├── services/             Supabase, Oracle, and Db2 adapters
└── ui/                   Dashboard markup, styles, and browser script
```

Shared authentication, configuration, environment validation, HTTP helpers,
geolocation, privacy handling, and administrative operations live in focused
modules directly under `src/`.

## Requirements

- Node.js 26.10.0 and npm 11.19.1 (pinned in `.tool-versions` and `package.json`)
- GCP Cloud Run and Cloud Scheduler; Cloudflare Tunnel/Access for Japan MySQL
- Python, Java and cloudflared supplied by the service Dockerfile
- Credentials for only the services you intend to use

The repository has no runtime npm dependencies.

## Legacy Worker development (rollback only)

```sh
npm ci
cp .env.example .dev.vars
# Replace placeholder values in .dev.vars.
npm run dev:worker
```

Never commit `.dev.vars` or `.env`; both are ignored.

Run all local checks:

```sh
npm run check
npm test
npm run build
```

`npm run build` checks application sources. `npm run build:worker` validates the
legacy Worker bundle only. Normal `npm run deploy -- /private/vendor-directory`
deploys Cloud Run and preserves its existing environment variables and IAM policy.

Tests replace outbound `fetch` calls with local mocks and do not contact real
Supabase, Oracle, IBM, or Cloudflare endpoints.

## Legacy Worker configuration

| Variable | Required for | Description |
| --- | --- | --- |
| `TRIGGER_SECRET` | Administrative routes | Long random Bearer token |
| `SUPABASE_URL` | Supabase | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Supabase | Server-side Supabase key |
| `OCI_ADB_US_URL` | US Oracle adapter | ORDS base URL |
| `OCI_ADB_US_USER` | US Oracle adapter | ORDS username |
| `OCI_ADB_US_PASS` | US Oracle adapter | ORDS password |
| `OCI_ADB_JP_URL` | Japan Oracle adapter | ORDS base URL |
| `OCI_ADB_JP_USER` | Japan Oracle adapter | ORDS username |
| `OCI_ADB_JP_PASS` | Japan Oracle adapter | ORDS password |
| `DB2_BRIDGE_URL` | Db2 reads and writes | HTTPS URL of the JDBC bridge |
| `DB2_BRIDGE_TOKEN` | Db2 reads and writes | Shared secret for the JDBC bridge |
| `MYSQL_JP_BRIDGE_URL` | Japan MySQL | HTTPS base URL of the Japan bridge |
| `MYSQL_JP_BRIDGE_TOKEN` | Japan MySQL | Separate MySQL bridge authentication token |
| `SHOW_FULL_IP` | Optional | Set to `true` only when full public IP output is intentional |
| `USE_REAL_TRACE` | Optional | Use the Worker trace location for scheduled runs |

Db2 uses a TLS-verified JDBC bridge on a Java-capable host. It inserts into Db2,
commits, then verifies the record on a separate connection. Deployment-health
API responses and Supabase logs are not used to determine Db2 success.
See [bridge setup](bridge/README.md).

Japan MySQL uses `/v1/mysql/checkins` on a TLS-verifying Python bridge in its
private network, without Java. US MySQL already has business traffic and is
excluded from keepalive. See [MySQL rollout](bridge/MYSQL.md).
Configure the Japan bridge and both `MYSQL_JP_*` Worker settings before deploying:
scheduled runs require configuration for every registered service.

### Public endpoint protection

Successful `GET /` and `GET /api/data` responses are cached for 60 seconds in
the Cloudflare data center that handled the request. Cache keys discard unknown
query parameters, normalize page aliases, and keep masked and full-IP output in
separate variants. Error responses and all administrative routes remain
uncached.

The `PUBLIC_RATE_LIMITER` binding allows 120 requests per minute for each
client and public route in a Cloudflare location. Client addresses are hashed
before they are used as limiter keys and are not written to application logs.
The binding returns 503 before database access if protection is missing or
Cloudflare's limiter is unavailable. The `namespace_id` in `wrangler.jsonc` must
be unique within the deploying Cloudflare account; change it before deployment
if `7893001` is already used by another Worker rate-limit binding.

## Database initialization

These migrations are bootstrap files for new self-hosted installations. An
existing deployment with working tables does not need to run them again. Review
the SQL against your current schema and permission model before applying it to
an existing database.

Apply the versioned SQL files before the first keepalive run:

- `migrations/supabase/001_create_keepalive_tables.sql` once in Supabase;
- `migrations/oracle/001_create_keepalive_log.sql` in each Oracle database.

Db2 requires `migrations/db2/001_create_keepalive_logs.sql` and
`migrations/db2/002_create_keepalive_requests.sql`. Existing migrated log tables
need only migration 002. The old Supabase Db2 log is retained as an archive;
new Db2 reads and writes use Db2 itself. See [migrations](migrations/README.md).

For legacy Worker rollback only, store secrets with Wrangler rather than adding values to
`wrangler.jsonc`, for example:

```sh
npx wrangler secret put TRIGGER_SECRET
npx wrangler secret put SUPABASE_SECRET_KEY
```

## HTTP routes

| Route | Method | Authentication | Purpose |
| --- | --- | --- | --- |
| `/` | `GET`, `HEAD` | None | Public dashboard |
| `/api/data?service=...` | `GET` | None | Paginated service data |
| `/debug` | `GET` | Bearer token | Full service diagnostics |
| `/trigger` | `POST` | Bearer token | Manual keepalive run |
| `/admin/clean?action=repair` | `POST` | Bearer token | Repair known bad rows |
| `/admin/clean?action=delete` | `DELETE` | Bearer token | Delete known bad rows |

Supported service names are `supabase`, `adb_us`, `adb_jp`, and `db2`.
Japan MySQL uses `mysql_jp` for targeted manual triggers and paginated public reads. Cleanup routes operate only on the existing
Supabase and Oracle records.
Administrative requests use `Authorization: Bearer <TRIGGER_SECRET>`.

## Deployment

Deploy the unified container using [service/README.md](service/README.md).
All runtime credentials are Cloud Run environment variables, supplied from a
private file outside Git and the allowlisted image build context. GitHub CI runs
mocked checks without production credentials. Secret scanning and push protection
are enabled on the public repository.

The original Worker and Job sources remain as rollback history; do not redeploy
them alongside the unified scheduled service. The three UTC schedules remain
`23 1 * * *`, `47 9 * * *`, and `11 17 * * *`.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for development rules. Report security
issues privately as described in [SECURITY.md](SECURITY.md).

## License

Licensed under the [MIT License](LICENSE).

The legacy Worker implementation requires the `PUBLIC_RATE_LIMITER` binding. Missing configuration or
limiter failures return 503 before database access; this intentionally prioritizes
resource protection over availability. Cloudflare limits are per location, not a
global spending cap. Administrative authentication is independent of this limiter.
