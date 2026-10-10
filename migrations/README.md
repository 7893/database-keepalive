# Database initialization

Apply the scripts for each enabled instance, in order, regardless of its region.
Use an administrative account for initialization and a separate account for the
running service. Review scripts before applying them to an existing database.

| Database | Scripts |
| --- | --- |
| Supabase Database | `supabase/001_create_keepalive_tables.sql`, then `supabase/002_request_id.sql` |
| IBM Cloud Db2 | `db2/001_create_keepalive_logs.sql`, then `db2/002_request_id.sql` |
| Oracle Cloud ADB | `oracle/001_create_keepalive_log.sql`, then `oracle/002_request_id.sql` |
| Oracle Cloud MySQL | `mysql/001_create_keepalive_logs.sql` |

## Supabase Database

Run the scripts in the Supabase SQL editor. They create `public.my_keepalive_logs`,
its timestamp and unique request-ID indexes, and the required access grants.
Row-level security is enabled without public policies; `anon` and `authenticated`
have no table access. The service uses a server-side secret key.

The sequence grant names the identity sequence created by script 001. If an
existing installation renamed that sequence, adapt the grant to its actual name.
Script 002 preserves existing rows and reloads the REST schema cache.

## IBM Cloud Db2

For a new installation, run scripts 001 and 002 in the service account's schema.
They create `DB2_KEEPALIVE_LOGS` and its unique request-ID index. The service needs
SELECT and INSERT on that table. Historical NULL request IDs are excluded from
the index; current writes always provide a request ID.

Existing installations with `DB2_KEEPALIVE_REQUESTS` must follow the two-phase
`db2/003_unify_logs.sql` migration instead of script 002: pause writers, export
both tables, add and backfill the log's request IDs, then verify every mapping.
Deploy the new writer before dropping the old request table and geographic
columns. Do not run the full migration as one unattended script.

Db2 uses the IBM CLI through Go's native driver. The adapter commits a log row,
then independently reads its request ID and status to verify the receipt.

## Oracle Cloud ADB

Apply both scripts to every configured ADB schema. The service connects through
ORDS using the account that exposes `keepalive_log`. If another account owns the
table, create a synonym and grant SELECT and INSERT to the ORDS account.

Script 001 tolerates existing tables and indexes. Script 002 adds request IDs
and their unique index while preserving existing rows.

## Oracle Cloud MySQL

The script uses `keepalive` as the database name; change it to match the instance's
configured `_DATABASE` value if necessary. It creates `keepalive_logs` with a
unique request ID and a timestamp index.

Provision a TLS-required service account separately. Grant only SELECT and INSERT
on the log table, and allow the actual connection source, including a connector
when one is used. The service account does not need database creation privileges.

## Verification

Configure connection credentials as described in [deployment](../docs/deployment.md),
start the service, and verify that each enabled instance loads on the dashboard.
An authenticated POST to `/trigger` with `Authorization: Bearer <TRIGGER_SECRET>`
performs manual check-ins. Request IDs make retries safe; each adapter verifies
its committed receipt.

## Existing installations with geographic columns

Deploy the current service before applying the optional `003_remove_geography.sql`
script for Supabase/ADB, `mysql/002_remove_geography.sql` for MySQL, or the
two-phase `db2/003_unify_logs.sql` migration for Db2. New installs
already use the reduced schema and must skip these scripts. The service works
with either schema; it only reads and writes record IDs, times, status and request
IDs. All four database types use these four logical fields in one log table.

These one-time scripts permanently delete `colo`, `country`, `city`, `region` and
`ip` values. Export them first if needed; check that all five columns exist and
that no external view, trigger or application depends on them. No `CASCADE` is
used. Record IDs, timestamps, statuses and request-ID constraints are retained.
Use a migration administrator and a maintenance window; Db2 requires a table
reorganization after dropping columns. Verify row counts and all enabled instances
afterward. Reverting to an old geographic writer requires restoring the columns.
