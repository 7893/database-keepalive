# Cloud Run deployment

Project `complete-silo`, region `us-central1`, service `keepalive`.
[Live dashboard](https://keepalive-jrvcceccza-uc.a.run.app/).

The old Worker and Cloud Run Job have been deleted. Both HTTP bridges and the US
bridge tunnel service are disabled. Japan retains its cloudflared TCP connector.
The existing Scheduler job `keepalive-0123` calls `/internal/tick` every minute
(`* * * * *`, UTC). The other two fixed-time jobs have been removed. Empty ticks
return immediately without database queries or writes.

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
history but predates this release workflow. Local recovery via `npm run deploy`
uses the same Dockerfile and preserves deployed environment variables and IAM.

## Runtime configuration

[.env.example](../.env.example) lists variable names and placeholders. Keep the real
JSON environment file mode 600 outside the repository and image context. Updates
to that file are separate from code releases; the release workflow never receives
it. The Docker and gcloud build contexts explicitly allow only build/runtime files.
Public JDBC and CA downloads are verified against pinned SHA-256 hashes.

- `TRIGGER_SECRET`: manual administration and diagnostics.
- `SCHEDULER_TOKEN`: scheduled writes via `X-Keepalive-Scheduler`, separate from
  Google IAM authorization headers.
- `PUBLIC_ORIGIN`: canonical page URL used for redirects.
- Supabase/ADB settings: HTTPS endpoint and server-side credentials.
- `DB2_*`: native JDBC credentials, JAR and trusted CA paths.
- `MYSQL_*`: native credentials and pinned TLS CA. `MYSQL_CA_PEM` is written to
  `MYSQL_SSL_CA` at startup. The tunnel listener uses the same `MYSQL_HOST` and
  `MYSQL_PORT` as the driver (currently `127.0.0.1:13306`).
- `TUNNEL_SERVICE_*`: Cloudflare Access hostname and service token. The currently
  deployed token expires on 2027-10-10; rotate it before expiry.

When intentionally rotating configuration, use `gcloud run services update` with
`--env-vars-file` pointing at the complete private JSON file. This replaces the
literal environment configuration, so keep all required values. Never echo them
or put them in shell arguments, Git, logs, or the image.

Startup checks every required database and tunnel setting before accepting
requests. Missing settings are reported by name, without credential values.

CPU, memory, scaling and runtime identity use platform defaults; no custom labels.
The page and masked read API are public; administrative and scheduled endpoints
require their application credentials.

## Runtime behavior

Each database receives three planned check-ins per UTC+8 calendar day, one in
each eight-hour window (00:00–07:59, 08:00–15:59, 16:00–23:59). Each day's plan
assigns distinct random minutes to the five services in each window. Dates seed
the plan, so replicas, restarts and retries agree without storing schedule state.
The original `X-CloudScheduler-ScheduleTime` selects the task, not arrival time;
late delivery retries the original task. Only the due database is contacted.
Network delays or retries may move actual completion past the planned minute.

Manual and scheduled operations share the same database adapters. Scheduler
requests retry failed databases up to three times without repeating successes.
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

`src/runtime/server.js` starts the service; `native.rpc` runs the database
drivers inside the container over bounded stdio RPC, without an HTTP
listener. One JVM serves Db2. Japan MySQL uses PyMySQL with its pinned CA through
Cloudflare Access TCP. Reads coalesce and cache for 60 seconds per service/page,
with a 100-entry cap; writes invalidate related entries. An instance accepts at
most 16 concurrent handlers. This bounds per-instance work, not global traffic
or spending. Cold starts can delay initial requests. Raw native/tunnel logs are
suppressed to avoid credential leakage.
