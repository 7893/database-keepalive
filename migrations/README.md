# Database initialization

Apply the scripts for each enabled instance, in order, regardless of its region.
Use an administrative account for initialization and a separate account for the
running service. Review scripts before applying them to an existing database.

| Database | Scripts |
| --- | --- |
| Supabase Database | `supabase/001_create_keepalive_tables.sql`, then `supabase/002_request_id.sql` |
| IBM Cloud Db2 | `db2/001_create_keepalive_logs.sql`, then `db2/002_create_keepalive_requests.sql` |
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

Run both scripts in the service account's database schema. They create
`DB2_KEEPALIVE_LOGS` and `DB2_KEEPALIVE_REQUESTS`; the service account needs SELECT
and INSERT on both tables. For an existing installation with the log table already
initialized, apply only the missing request-table script.

The service uses the IBM CLI through Go's native driver. Log and request rows
commit in one transaction, followed by a separate read to verify the receipt.

## Oracle Cloud ADB

Apply both scripts to every configured ADB schema. The service connects through
ORDS using the account that exposes `keepalive_log`. If another account owns the
table, create a synonym and grant SELECT, INSERT, UPDATE and DELETE to the ORDS
account. UPDATE and DELETE support authenticated maintenance operations.

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
