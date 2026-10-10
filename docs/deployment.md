# Cloud Run deployment

Run one Linux amd64 container on Cloud Run and use Cloud Scheduler to call
`/internal/tick` every minute. The service selects the due database; empty ticks
return immediately without database queries or writes.

## Configuration

Edit root [`config.yaml`](../config.yaml). Comments explain each option and its
defaults. The app embeds this file during the image build, and GitHub releases
read its `deployment` section. `DATABASE_KEEPALIVE_CONFIG` optionally selects a
mounted replacement with the same YAML schema. Use one application configuration
file; credentials stay in environment variables.

Enable at least one database type and add instances for each enabled type. Use
any database region and multiple instances of the same type. Region is a display
label; the connection endpoint selects the destination. Cloud Run's region is
independent of database regions. Omit `name` to generate the instance's title.

Fonts load in configured order from Google Fonts, then fall back to system fonts.
Refresh defaults to off; an enabled interval must be at least 30 seconds.
`display.show_full_ip` defaults to false.

## Credentials and connections

[.env.example](../.env.example) lists credential placeholders for the checked-in
instances. Change their prefixes to match your configuration. Each instance's
`env_prefix` selects these suffixes:

| Type | Required suffixes |
| --- | --- |
| `supabase` | `_URL`, `_SECRET_KEY` |
| `adb` | `_URL`, `_USER`, `_PASS` |
| `db2` | `_HOST`, `_PORT`, `_DATABASE`, `_USER`, `_PASSWORD`, `_CA_FILE` |
| `mysql` | `_HOST`, `_PORT`, `_DATABASE`, `_USER`, `_PASSWORD`, `_SSL_CA` |

Only enabled instances need credentials. Set `TRIGGER_SECRET`, `SCHEDULER_TOKEN`
and `PUBLIC_ORIGIN` globally; Cloud Run supplies `PORT`. Keep real values in Cloud
Run environment variables and a complete private JSON environment file outside
Git and the build context, with file permissions 600. This file contains deployment
secrets, not application settings. GitHub receives no database credentials or GCP
private keys.

The image includes the IBM CLI and its pinned CA for Db2. For MySQL, optional
`_CA_PEM` writes the certificate to `_SSL_CA` at startup. `_SSL_VERIFY_IDENTITY`
defaults to true. A loopback tunnel uses false while still verifying the pinned
certificate chain.

A MySQL instance can set `tunnel_prefix` to use Cloudflare Access TCP. That prefix
selects `_HOSTNAME`, `_TOKEN_ID` and `_TOKEN_SECRET`. Its MySQL host must be loopback
and its port must be distinct from other listeners. A cloudflared connector must
already provide access to the database. Without `tunnel_prefix`, MySQL connects
directly. Rotate Access credentials before they expire.

## Initial setup

1. Set your deployment and database configuration, then apply the
   [database initialization scripts](../migrations/README.md) to each instance.
2. Build the root Dockerfile for `linux/amd64` and push the image to the Artifact
   Registry repository selected by `deployment.repository` or `deployment.service`.
3. Create the Cloud Run service with that image and your private environment file.
   Allow public access to the dashboard; administrative endpoints authenticate
   inside the application. Use platform defaults for CPU, memory and scaling.
4. Set `PUBLIC_ORIGIN` to the resulting service URL. Update the service using the
   complete environment file, preserving every required credential:

   ```sh
   gcloud run services update <service> --project=<project> --region=<region> \
     --env-vars-file=/absolute/path/to/private-env.json
   ```

5. Create an HTTP Cloud Scheduler job with schedule `* * * * *`, UTC timezone,
   POST target `<service-url>/internal/tick`, and header
   `X-Database-Keepalive-Scheduler` matching `SCHEDULER_TOKEN`. Scheduler supplies
   `X-CloudScheduler-ScheduleTime`; the application uses that original timestamp
   for delayed deliveries and retries.
6. Run `go run ./cmd/smoke <service-url>` for read-only health checks, then verify
   that Scheduler receives HTTP 200.

## GitHub releases

Set two non-secret repository variables for Workload Identity Federation:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`: your GitHub OIDC provider resource name.
- `GCP_DEPLOY_SERVICE_ACCOUNT`: your deployment service-account email.

Restrict federation to your repository and owner IDs, `refs/heads/main`, manual
dispatch, and this repository's `.github/workflows/ci.yml` on `main`. Scope
deployment permissions to the Cloud Run service, image repository and runtime
identity. Enable repository secret scanning and push protection where available.

**Check and release** validates pushes and pull requests. Manually dispatch it
from `main`, selecting a commit or tag already contained in `main`, to publish
and deploy. The image is tagged with that commit SHA. Releases preserve existing
environment variables and IAM and run read-only health checks afterward.
Release a previously working compatible commit to roll back.

For source deployment or recovery, the same root Dockerfile also supports:

```sh
gcloud run deploy <service> --source=. --project=<project> --region=<region>
```

Use the values from `config.yaml`; configure credentials and access separately
when creating a service for the first time.

## Runtime behavior

Each instance draws a uniform daily count in the configured range and chooses
distinct windows, with one random minute per window. Planned minutes are distinct
across instances; counts can coincide. IANA timezone rules account for daylight
saving time. Date-based plans and request IDs agree across replicas and retries.
Disabled types keep their configured slots reserved. Change instance IDs/order or
scheduling policy between calendar days to avoid altering an active day's plan.

Only the due instance is contacted. Failed writes retry up to `schedule.attempts`
without repeating successes. Adapters verify committed receipts; remaining
failures return HTTP 502. Network delays can move completion past the planned time.

Simulated locations are display metadata, independent of actual network egress.
Scheduled retries retain their locations. `real` uses the service trace and fails
when unavailable. `client` requires trusted geographic metadata; Cloud Run does
not supply it, so this mode returns `client_geo_unavailable` without writing.

Db2 uses native CLI timeouts; a Go context cannot interrupt every native call.
Reads coalesce and cache by instance/page, with a 100-entry cap; writes invalidate
related entries. Concurrency limits bound each container's work. Cold starts can
delay requests. Native and tunnel output is suppressed to protect credentials.
