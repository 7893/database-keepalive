# Database initialization

> These migrations are for new self-hosted installations. Do not run them on an
> existing production database unless you have reviewed the schema and grants
> and intentionally want to reconcile that deployment.

The service stores Supabase events in Supabase, Db2 events in Db2 through the
native JDBC driver, and Oracle events in each Oracle database through ORDS.

## Supabase

Run `supabase/001_create_keepalive_tables.sql` once in the Supabase SQL editor.
It creates:

- `public.my_keepalive_logs` for Supabase keepalive events;
- `public.db2_keepalive_logs`, retained for legacy IBM Db2 monitoring history;
- descending timestamp indexes used by dashboard queries.

Row-level security is enabled without public policies. The migration revokes
table access from `anon` and `authenticated` and grants the required operations
to `service_role`. Configure the service with a server-side Supabase secret; do
not use an anonymous browser key.

The sequence grant uses `all sequences in schema public` so both identity
columns work. If the schema contains unrelated sequences and your policy
requires narrower grants, replace it with grants for the two generated identity
sequences shown by the Supabase SQL editor after table creation.

## Oracle Autonomous Database

Run `oracle/001_create_keepalive_log.sql` separately in both the US and Japan
databases. Use the same schema account that the corresponding ORDS credentials
expose. The script is idempotent: existing-table and existing-index errors are
ignored while other Oracle errors are raised.

The service requires ORDS access to:

- read database status;
- insert and select `keepalive_log` rows;
- update or delete known bad rows through authenticated maintenance routes.

If a DBA owns the table in another schema, create a synonym and grant only
`select`, `insert`, `update`, and `delete` on `keepalive_log` to the ORDS user.

## IBM Db2

For a new database, apply `db2/001_create_keepalive_logs.sql` and then
`db2/002_create_keepalive_requests.sql` once, using the database account schema.
For an existing migrated `DB2_KEEPALIVE_LOGS`, apply only migration 002.

The native driver inserts database UTC time, commits the log and request ID atomically,
and verifies the committed row using a separate connection. All SQL uses bound
parameters. The request table provides durable duplicate-request protection.
The database account needs SELECT and INSERT on both tables.

Historical imports preserve the original eight fields, IDs and UTC microseconds.
Restart the log identity above the imported maximum ID. Imported SUCCESS rows
are historical monitoring results, not proof of historical Db2 writes.
Retain the source archive until cutover has been validated.

## Verification

For Japan MySQL, review and apply `mysql/001_create_keepalive_logs.sql` on the
Japan instance only. US MySQL has business traffic and is excluded. It creates `keepalive.keepalive_logs` with a unique request ID
and a timestamp index. The MySQL user needs only SELECT and INSERT on this
table, with TLS required. Provision users separately using the actual VM source
addresses. See [runtime configuration](../docs/deployment.md).

After applying migrations, configure local placeholder-derived credentials outside Git, start the configured Cloud Run service, and invoke `/trigger` with a valid Bearer
token. Do not use production credentials in committed files or test fixtures.

## Request IDs for HTTP database adapters

Apply `supabase/002_request_id.sql` to Supabase and `oracle/002_request_id.sql`
to **both** ADB schemas before deploying the updated writers. These additive,
repeatable migrations leave historical rows intact. Supabase reloads its REST
schema cache. The unique request IDs make retries safe after ambiguous responses;
the application independently reads back each receipt and checks its payload.
