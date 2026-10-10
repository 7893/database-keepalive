# Db2 JDBC bridge

This server also supports a separately authenticated MySQL backend. See
[MySQL rollout](MYSQL.md) to run a MySQL-only instance in Japan. US MySQL is
excluded because it already has business traffic. Default startup remains Db2-only for existing deployments.

The Worker sends authenticated requests to this service through HTTPS (for
example, a dedicated Cloudflare Tunnel). The service binds to 127.0.0.1:8172.
It offers only GET/POST `/v1/checkins`; callers cannot submit arbitrary SQL.

POST accepts a UUID `request_id` and optional colo/country/city/region/ip fields.
It inserts a Db2 log and request mapping in one transaction, commits, and reads
the row on a new connection before returning `committed: true`. Repeating the
same ID and values returns the existing row; different values return 409.
The database timestamp is converted to UTC at insertion. GET reads Db2 directly.

## Setup

1. Use a Java-capable host with Python 3.11+ and a dedicated virtual environment.
   Install `requirements.txt` into that environment. Download IBM JCC 12.1.2.0
   from Maven Central and verify its published checksum. Obtain the trusted
   DigiCert Global Root CA from DigiCert over HTTPS.
2. Apply the Db2 migrations. Do not recreate an existing migrated log table.
3. Store these settings in a mode-0600 file outside the repository:
   `DB2_HOST`, `DB2_PORT`, `DB2_DATABASE`, `DB2_USER`, `DB2_PASSWORD`,
   `DB2_JDBC_JAR`, `DB2_CA_FILE`, and `DB2_BRIDGE_TOKEN` (32+ random characters).
   Both TLS certificate-chain and hostname validation are mandatory.
4. Adapt the included systemd service paths and install the service. Use a
   dedicated Tunnel and HTTPS hostname. Keep the listener on loopback and keep
   the Tunnel token in its own mode-0600 file, passed using `--token-file`.
5. Set Worker secrets `DB2_BRIDGE_URL` and `DB2_BRIDGE_TOKEN`, then deploy the
   Worker. Never put Db2 database credentials into the Worker or public routes.

## Verification and rollback

`npm test` and `npm run test:bridge` use mocked upstreams and databases. The
bridge tests cover authentication, parameter validation, commit failure,
duplicate requests, and verification through a separate connection.

For deployment acceptance, send one authenticated Db2-only Worker trigger,
read the returned log through the Worker, and independently query Db2. Compare
the legacy Supabase count before and after: it must not increase because of
the Db2 trigger. A trigger performs a real database write.

Retain the pre-deployment Worker version for rollback. If rollback is necessary,
restore that version and then stop the two dedicated bridge units. Leave Db2
records and the legacy Supabase archive intact. The former Worker reports
deployment API checks, not native Db2 writes; rollback restores that limitation.
