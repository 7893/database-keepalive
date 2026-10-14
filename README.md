# Database Keepalive

A small Cloudflare Worker that writes periodic check-in records to your databases
and displays their recent history. TypeScript backend, plain HTML dashboard,
one Cron Trigger. No application server, KV, D1, or frontend framework.

Supported databases:

| Database | Connection |
| --- | --- |
| Supabase | HTTPS / PostgREST |
| Oracle Autonomous Database | HTTPS / ORDS REST SQL |
| MySQL | Hyperdrive; private databases can use an existing Cloudflare Tunnel |

Db2 is no longer supported. The previous Go daemon has been replaced.
Existing tables and historical check-in records are retained.

## Quick start

Requires Node.js 24+, npm, and a Cloudflare account.

```sh
git clone https://github.com/7893/database-keepalive.git
cd database-keepalive
npm ci
cp config.example.json config.local.json
```

Edit `config.local.json`: remove database examples you do not use, fill in the
remaining credentials, and give every instance a stable, unique ID. Duplicate
an entry to add another region.

For a **new database**, run its SQL script in [migrations](migrations/README.md)
once. The runtime only needs to read and insert records; it does not create tables.
For an existing installation, confirm the unique `request_id` index exists.

```sh
npm run configure
npm run dev
```

Open the local URL printed by Wrangler. Loading the dashboard only reads records.
The dashboard is read-only; all check-ins run automatically through Cron.

`configure` generates ignored `.dev.vars` and `.secrets.local.json` files.
These contain credentials. Never commit or share them. It does not contact any cloud.

## Deploy with GitHub Actions

For Supabase and Oracle, no extra Cloudflare storage resource is required.
For MySQL, complete the Hyperdrive setup below first.

Run this one-time setup to create the Worker with its database secrets:

```sh
npx wrangler login
npm run bootstrap
```

Deployment uploads the Worker, static dashboard and secrets together, and installs
one `*/5 * * * *` Cron Trigger. Its URL appears in the command output. Cloudflare
may take several minutes to propagate a new trigger. Deploying does not itself
insert a check-in. To deploy to a different account, set `CLOUDFLARE_ACCOUNT_ID`.
Do not run this command against a production name until you intend to deploy.

If you change `wrangler.jsonc`, regenerate types with `npm run types`.

### GitHub Actions

After the first deployment above, configure these repository settings under
**Settings → Secrets and variables → Actions**:

- Secret `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with Workers deployment
  permissions for your account (the Edit Cloudflare Workers template is a starting point).
- Variable `CLOUDFLARE_ACCOUNT_ID`: the account containing your Worker and Hyperdrive.

The workflow checks types, runs tests and validates the bundle on pushes and pull
requests. Successful pushes to `main` deploy automatically; you can also run
**CI and Deploy** manually on `main`. Checks and deployment share one dependency
installation. Without the account variable, the deployment step is skipped.

CI reuses the existing Worker secrets, so database credentials do not need to be
copied into GitHub. For routine releases, push to `main`; no local deployment is
needed. To change database credentials, edit `config.local.json` and run
`npm run secrets:update`. Set your own Hyperdrive ID in `wrangler.jsonc` before
deploying a fork.

### MySQL / Hyperdrive

1. Create a Hyperdrive configuration in the Cloudflare dashboard using your
   MySQL credentials. **Disable query caching** so receipt verification and the
   dashboard read the database rather than a cached response.
2. For a private database, select its existing Tunnel hostname and Access service
   token. Keep the Tunnel connector running within the database's network.
3. Enable TLS certificate verification. For a private CA, upload its CA certificate
   and choose `VERIFY_CA` (or `VERIFY_IDENTITY` when the hostname matches).
4. Add the Hyperdrive binding to `wrangler.jsonc`:

   ```json
   "hyperdrive": [{ "binding": "MYSQL_JP", "id": "your-hyperdrive-id" }]
   ```

5. Use the same `binding` name in that database's `config.local.json` entry.
   Credentials remain in Hyperdrive; they are not repeated in Worker configuration.
   Run `npm run types` after adding the binding.

For local MySQL development, configure a local connection string through
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_MYSQL_JP`, or use
`npx wrangler dev --remote` to test the actual Hyperdrive binding. Remote development
reads real database records when viewing the dashboard.

See Cloudflare's [private database guide](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/)
and [TLS guide](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/).
A private MySQL deployment still depends on the database and Tunnel host remaining
available. Access service tokens must be renewed before they expire.

## Scheduling and retries

- Defaults: **1–3 check-ins per database per UTC day**, spread across the day.
  Set `DAILY_MIN` and `DAILY_MAX` in `wrangler.jsonc`; make them equal for a fixed count.
  Supported range: 1–12 per day.
- Times are deterministic from the UTC date and instance ID, rounded to five-minute
  boundaries. Restarts do not reshuffle the plan. `DISPLAY_TIMEZONE` controls only
  the dashboard's display timezone, not the schedule's UTC day boundary.
- Cron checks for events due in the last 15 minutes. The following two ticks can
  retry a failed event. Longer outages are **not** backfilled indefinitely.
- Scheduled retries use the same request ID. A unique index in each database
  prevents duplicate records, including concurrent deliveries. A write is successful
  only after its committed receipt is read back.
- The dashboard derives history from the databases. It reports current read failures
  and the next planned time; it is not a persistent failure/audit database. Scheduled
  failures appear in Workers Logs as `scheduled_checkin` events.

No timer runs inside a persistent process. There is no startup write or public
HTTP endpoint for invoking the scheduler. Keep database IDs stable to preserve
idempotency and scheduling. The dashboard is public and reveals configured names,
regions, and recent check-in times; database credentials stay on the server.

## Development

```sh
npm run check   # generated binding types and TypeScript
npm test        # scheduling, retries, adapters, read-only HTTP and error handling
npm run build  # bundle validation, without deployment
```

Tests use fake database connections and HTTP responses, never production writes.
To exercise a local scheduled handler deliberately, run
`npx wrangler dev --test-scheduled` and request `/__scheduled`. It can write to the
configured databases when a planned event is due.

Before switching an existing installation, validate reads, one controlled write
and its retry, then stop the old scheduler and enable the new one. Never leave both
schedulers active unintentionally; their schedule IDs are not shared across versions.
The repository's CI deploys successful `main` builds when GitHub deployment settings
are configured as described above.

Keepalive activity does not guarantee that a provider will preserve a free database.
Platform quotas, outages and provider policies still apply.

## License

[MIT](LICENSE)
