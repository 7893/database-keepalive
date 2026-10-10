# Unified Cloud Run service

Live page: https://keepalive-jrvcceccza-uc.a.run.app/

Cutover completed on 2026-10-10: revision `keepalive-00003-qhj`. The old Worker
and Cloud Run Job were deleted; both HTTP bridges and the US tunnel service
were disabled. Japan retains only the existing cloudflared TCP connector.
Scheduler jobs `keepalive-0123`, `keepalive-0947`, and `keepalive-1711` retain
their original UTC schedules and now call this service.

Cloud Run directly serves the public page and read API, plus authenticated manual
and scheduled operations. No Worker is needed. All operations share one set of
database adapters. Scheduler invokes `POST /internal/checkin` using a dedicated
token; manual administration uses a separate token.

Supabase and both ADBs use HTTPS. Db2 uses the JDBC driver directly. Japan MySQL
uses PyMySQL with its pinned CA over `cloudflared access tcp`, through an Access
Service Auth policy and the existing Japan tunnel. Japan needs only cloudflared;
the old Japan MySQL and US Db2 HTTP bridges can stop after cutover.

## Runtime configuration

Use a mode-600 JSON environment file outside the repository and build directory.
Retain the Job's Supabase, ADB and native Db2 variables. Remove the MySQL bridge
URL/token and supply the MySQL variables documented in `bridge/mysql.env.example`:
`MYSQL_HOST=127.0.0.1`, `MYSQL_PORT=13306`, and the existing database credentials
and TLS verification settings. `MYSQL_CA_PEM` contains the pinned certificate;
startup writes it to the path in `MYSQL_SSL_CA` (normally `/tmp/mysql-ca.pem`).

`TUNNEL_SERVICE_HOSTNAME`, `TUNNEL_SERVICE_TOKEN_ID`, and
`TUNNEL_SERVICE_TOKEN_SECRET` configure the private TCP connection. The deployed
Access token has the provider's default expiry, 2027-10-10; rotate it before then.
`TRIGGER_SECRET` authenticates manual writes, cleanup and diagnostics.
`SCHEDULER_TOKEN` authenticates the internal scheduled check-in route through
the `X-Keepalive-Scheduler` header, separately from Google IAM/OIDC headers.
`PUBLIC_ORIGIN` is the canonical Cloud Run page URL, used for HTML redirects.
None of these belong in GitHub or the image.

```sh
python3 service/prepare.py /private/vendor-directory /private/new-build-directory
gcloud run deploy keepalive --source=/private/new-build-directory \
  --project=complete-silo --region=us-central1 \
  --env-vars-file=/private/service-config.json --allow-unauthenticated
```

The page and masked read API are public. Every write, cleanup, diagnostic and
scheduled endpoint requires its application credential; anonymous requests cannot
trigger database writes. No service-account private key is needed.
CPU, memory, scaling and runtime identity use platform defaults; no custom labels.

For subsequent deployments, run `npm run deploy -- /private/vendor-directory`;
it stages only allowlisted sources and preserves deployed environment variables
and IAM policy. The normal deploy command never deploys a Worker.

## Behavior

Manual and scheduled writes use the same adapters. Each scheduled request tries
failed databases up to three times; successful databases are not repeated.
Db2/MySQL reuse deterministic request IDs on retries. Supabase/ADB can still gain
an extra heartbeat after an ambiguous network failure. Scheduler receives a 502
if any database remains unsuccessful. Geographical display values remain simulated.

Native drivers run inside the same container over bounded stdio RPC, without an
HTTP listener. A single JVM serves Db2 requests. Reads coalesce and cache for
60 seconds per service/page, with a 100-entry cap; writes invalidate the relevant
entries. An instance accepts at most 16 concurrent handlers. This replaces the
old Worker protection with bounded in-process work; it is not a global rate limit
or spending cap. Cold starts can delay initial requests. Raw driver and tunnel logs are suppressed to avoid credential leakage.

Before removing old components, verify all five reads, manual writes, scheduled
writes, rejected anonymous/unauthorized requests, the public page, and paging.
Preserve old Cloudflare tunnel configuration and the previous Worker deployment
for rollback. Never enable old and new scheduled writers indefinitely.
