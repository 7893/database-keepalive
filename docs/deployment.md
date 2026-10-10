# Cloud Run deployment

Deployed: project `complete-silo`, region `us-west1`, service `database-keepalive`.
[Live dashboard](https://database-keepalive-jrvcceccza-uw.a.run.app/).

The old Worker and Cloud Run Job have been deleted. Both HTTP bridges and the US
bridge tunnel service are disabled. Japan retains its cloudflared TCP connector.
Scheduler job `database-keepalive` in `us-west1` calls `/internal/tick` every minute
(`* * * * *`, UTC). Empty ticks return immediately without database queries or writes.
The previous Cloud Run service `keepalive` in `us-central1` has been removed.
Its Scheduler job `keepalive-0123` is paused and retained, and the previous
Artifact Registry repository is retained. Existing deployment identity IDs remain
unchanged; their display names use Database Keepalive.

## Release path

GitHub **Check and release** runs mocked checks on pushes and pull requests.
Only a manual run from `main` can deploy; its `ref` must already be contained in
`main`. One root Dockerfile builds an image tagged with the selected commit SHA.
The workflow pushes to Artifact Registry, deploys that image, preserves existing
environment variables and IAM, and performs read-only health checks.

Two non-secret repository variables configure GitHub OIDC:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`: `projects/691496895143/locations/global/workloadIdentityPools/keepalive-github/providers/github`
- `GCP_DEPLOY_SERVICE_ACCOUNT`: `keepalive-deploy@complete-silo.iam.gserviceaccount.com`

The federation condition pins the numeric repository and owner IDs, the `main`
branch, manual dispatch, and this repository's `ci.yml` workflow. Deployment IAM
is scoped to the service, image repository, and existing runtime identity.
No GCP private key or database credential belongs in GitHub. The public repository
has secret scanning and push protection enabled.

For a rollback, manually release a previously working commit that uses the current
Dockerfile layout. The earlier `cloudrun-migration-baseline` tag preserves source
history but predates this release workflow. Local recovery from the repository
uses `gcloud run deploy <service> --source=. --project=<project> --region=<region>`
with values from `config.json`
with the same Dockerfile, preserving deployed environment variables and IAM.

## Configuration

Edit only root [`config.json`](../config.json). The app embeds it during the image
build, and GitHub releases read its `deployment` section. An optional
`DATABASE_KEEPALIVE_CONFIG` environment variable selects a mounted replacement of the same
file. Do not create separate database, font or deployment settings files.

| Section | Settings |
| --- | --- |
| `database_types` | Enable `supabase`, `db2`, `adb`, `mysql`; at least one must be selected |
| `instances` | Stable ID, type, optional name and free-form region, environment prefix, display order |
| `schedule` | Random daily count range (default 1–3), IANA timezone (default `Asia/Singapore`), total attempts (default 3) |
| `display` | Page size (default 10, range 1–100), ordered font and monospace font lists, refresh interval, IP visibility |
| `runtime` | Cache lifetime (default 60 seconds; 0 disables caching), request concurrency (default 16) |
| `deployment` | Cloud Run project, region, service name, optional image repository (defaults to service name) |

Every enabled type needs an instance. Instances may use any database region and
multiple instances of the same type. Omit `name` to generate a title from the
official service name and optional region. Region is a display label; the
connection endpoint determines the destination. Cloud Run's deployment region
is independent of database regions. The checked-in configuration enables all
four types and our five instances.

Omitted settings use defaults. Fonts load in configured order from Google Fonts,
trying the next family on failure and ending at system fonts. Defaults are Ubuntu
and Ubuntu Mono. Font names must exist in Google Fonts; no local font files or
font build step are needed. Refresh is disabled by default; when enabled its
interval must be at least 30 seconds. `show_full_ip` defaults to false.

[.env.example](../.env.example) is a credential/connection reference, not another
application settings file. Each instance's `env_prefix` selects its variables:

| Type | Required suffixes |
| --- | --- |
| `supabase` | `_URL`, `_SECRET_KEY` |
| `adb` | `_URL`, `_USER`, `_PASS` |
| `db2` | `_HOST`, `_PORT`, `_DATABASE`, `_USER`, `_PASSWORD`, `_CA_FILE` |
| `mysql` | `_HOST`, `_PORT`, `_DATABASE`, `_USER`, `_PASSWORD`, `_SSL_CA` |

Only enabled instances need credentials or create connections. Global environment
variables are `TRIGGER_SECRET`, `SCHEDULER_TOKEN`, `PUBLIC_ORIGIN`, and the
platform-provided `PORT` (default 8080). Optional MySQL `_CA_PEM` is written to
`_SSL_CA` at startup. `_SSL_VERIFY_IDENTITY` defaults to true; our loopback tunnel
uses false while still verifying the pinned certificate chain.

Set a MySQL instance's optional `tunnel_prefix` to use Cloudflare Access TCP.
That prefix selects `_HOSTNAME`, `_TOKEN_ID`, `_TOKEN_SECRET`. The MySQL host
must then be loopback, and its port must be distinct from other listeners.
Without `tunnel_prefix`, the driver connects directly. Our Japan connector and
credentials remain in use; the currently deployed Access token expires on
2027-10-10. The former `DB2_JDBC_JAR`, `SHOW_FULL_IP` and MySQL `_SSL_STRICT`
variables are obsolete (`_SSL_STRICT` is still accepted for compatibility).

Keep real credentials outside Git and image context. When intentionally rotating
them, use `gcloud run services update` with `--env-vars-file` pointing at the
complete private JSON environment file (mode 600). This replaces the environment
configuration, so preserve every required value. Code releases preserve existing
environment variables and IAM; GitHub never receives database credentials.
Build contexts allow only runtime files; public IBM CLI and CA downloads use
pinned SHA-256 hashes. Startup reports invalid settings by name without values.

CPU, memory, scaling and runtime identity use platform defaults; no custom labels.
The page and masked read API are public; administrative and scheduled endpoints
require their application credentials.

## Runtime behavior

Each configured instance independently draws a uniform daily count within the
configured range. The default is one, two or three check-ins per UTC+8 day. A day
is split into `daily_max` windows, and the instance chooses its count of distinct
windows with one random minute in each. IANA timezone rules account for daylight
saving time; default windows are eight hours each.
All services' planned minutes remain distinct. Counts may coincide by chance.
Default time seeds and request IDs are preserved. Disabling a database type keeps
its configured slots reserved, so enabled instances do not shift their times.
Changing instance IDs/order or scheduling policy changes plans; make those changes
between calendar days to avoid altering an active day’s schedule. Records written before the
release remain intact, so the new daily count applies fully from the next day.
Dates seed the plan, so replicas, restarts and retries agree without storing schedule state.
The original `X-CloudScheduler-ScheduleTime` selects the task, not arrival time;
late delivery retries the original task. Only the due database is contacted.
Network delays or retries may move actual completion past the planned minute.

Manual and scheduled operations share the same database adapters. Scheduler
requests retry failed databases up to the configured total attempts (default three) without repeating successes.
All databases reuse deterministic request IDs for retries and verify committed
rows. Apply the Supabase and both ADB `002_request_id.sql` migrations before
releasing the new writers; they preserve existing rows and allow rollback to
the old code. Remaining failures return 502.
Scheduled and manual simulated rounds choose distinct city nodes, with unbiased
sampling; scheduled retries retain the same locations. These are display values,
not the actual network egress. `real` uses the service trace and fails explicitly
when unavailable. `client` requires trusted runtime geographic metadata, which
Cloud Run does not currently supply; it returns `client_geo_unavailable` without
writing. Neither mode silently substitutes a simulated location.

`cmd/server` runs the Go HTTP service with direct database adapters; no Node,
Python, JVM or driver RPC is used. Db2 uses the IBM CLI through CGO on Linux
amd64. Japan MySQL uses the Go MySQL driver with its pinned CA through
Cloudflare Access TCP. The tunnel client remains a separate child process.
CA-only MySQL verification validates the certificate chain without comparing
the remote identity to the loopback hostname. `MYSQL_SSL_STRICT` remains accepted
for configuration compatibility; Go performs the chain check directly.
Db2 uses CLI connection, receive and query timeouts; a Go context alone cannot
interrupt every native driver operation.
Reads coalesce and cache for the configured lifetime (default 60 seconds) per service/page,
with a 100-entry cap; writes invalidate related entries. An instance accepts at
most the configured concurrent handlers (default 16). This bounds per-instance work, not global traffic
or spending. Cold starts can delay initial requests. Raw native/tunnel logs are
suppressed to avoid credential leakage.
