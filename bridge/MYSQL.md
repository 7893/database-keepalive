# MySQL bridge rollout

The Worker schedules five services, including Japan MySQL only. US MySQL has
business traffic and is excluded from all keepalive reads and writes. MySQL does
not need an additional VM cron.
Each bridge connects to a MySQL instance in its own private network. Both HTTP
operations require the backend-specific Bearer token:

- `POST /v1/mysql/checkins`: UUID `request_id` and the optional location fields
  supported by the Db2 bridge. Insert with database UTC time, commit, then verify
  on another connection. Repeating the same request returns the same row;
  changing its values returns 409.
- `GET /v1/mysql/checkins?page=1&limit=10`: database rows and count from one
  consistent read-only transaction.

## 1. Verify the database and prepare its schema

From the Japan VM, verify MySQL login, database version, TLS certificate chain and
existing keepalive schemas. Review `migrations/mysql/001_create_keepalive_logs.sql`
before applying it; `IF NOT EXISTS` does not validate a pre-existing table.
Use the administrator only for provisioning. Create a dedicated user restricted
to the bridge VM's source address, require TLS, and grant SELECT and INSERT on
`keepalive.keepalive_logs`. Do not put administrative credentials in the bridge.

Use a trusted CA file in `MYSQL_SSL_CA`; an empty value uses the system trust
store. Certificate verification is mandatory. Prefer a database hostname that
matches the certificate with `MYSQL_SSL_VERIFY_IDENTITY=true` (the default).
For an explicitly reviewed private-IP endpoint, `false` permits CA-only
verification; it never disables certificate-chain verification. The bridge
also verifies the negotiated cipher to reject plaintext protocol fallback.

For OCI service-defined CAs missing the KeyUsage extension, explicitly pin the
reviewed CA in `MYSQL_SSL_CA` and set `MYSQL_SSL_STRICT=false`. This enables
legacy X.509 compatibility while retaining mandatory certificate-chain
verification. It is rejected without an explicit CA file. Record the CA
fingerprint and review replacements when OCI rotates the certificate.

## 2. Run the Japan instance

Use `/home/ubuntu/keepalive-mysql` for `server.py`, `db.py`, `mysql_db.py` and its
virtual environment. Install only `requirements-mysql.txt`; Java and JPype are
not needed for `BRIDGE_SERVICES=mysql`.

Store the settings in `/home/ubuntu/.config/keepalive-mysql/bridge.env` (0600).
Set `BRIDGE_SERVICES=mysql`, `BRIDGE_PORT=8173` and the local MySQL endpoint.
Install the `keepalive-mysql.service` template after reviewing its paths.
Use a dedicated cloudflared Tunnel and hostname pointing to
`http://127.0.0.1:8173`, or reuse an existing connector after reviewing its routes.
For a dedicated connector, install `keepalive-mysql-tunnel.service` after checking
the cloudflared binary path. Store its token at
`/home/ubuntu/.config/keepalive-mysql/tunnel-token` (0600). Keep MySQL private.

## 3. Configure and deploy the Worker

Set the two Worker secrets from `.env.example`: `MYSQL_JP_BRIDGE_URL` and
`MYSQL_JP_BRIDGE_TOKEN`.
URLs are HTTPS base URLs, not the full `/v1/mysql/checkins` paths. MySQL database
passwords and CA files stay on the VMs.

Run `npm run check`, `npm test`, `npm run test:bridge`, and `npm run build`.
Bridge tests mock databases; the HTTP integration cases need loopback sockets.
Deploy only after the Japan bridge and both secrets are ready. The scheduler retains
its fail-closed validation: any missing service configuration stops the run.

## 4. Acceptance and rollback

1. Record the current Worker version, Db2 count, and the Japan MySQL count.
2. Call authenticated `POST /trigger?target=mysql_jp` only.
   Each call makes a real database write. Independently query the Japan database and
   check its new UUID, UTC timestamp and committed row against the dashboard.
3. Repeat an identical bridge request ID: count must not increase. A different
   payload with that ID must return 409.
4. Confirm MySQL public reads mask IPs, the Japan panel paginates independently,
   Db2 reads still work, and the next scheduled run writes to Japan MySQL.

If rollout fails, restore the prior Worker version first. Disable the new Japan bridge and
remove only its newly added Tunnel route. Retain MySQL tables, records and the
Db2 history; rollback does not require deleting data.

## Deployment record — 2026-10-10

- Japan database: OCI profile `f78`, `ap-osaka-1`; bridge host: SSH alias `jpa`.
- Dedicated database account: `keepalive` restricted to source `10.0.0.206`,
  with TLS required and SELECT/INSERT on `keepalive.keepalive_logs` only.
- HTTPS bridge: `https://keepalive-mysql-jp.8n8m.cfd`; Tunnel
  `b717a08f-1416-4060-8471-429776672b69`. Only `/v1/mysql/checkins` is routed.
- Both systemd units are enabled and active; the bridge binds to loopback only.
- CA SHA-256: `214043273675a59ffc29854912826ad4947b684f51d5cad6d3c3a27a9a2f5535`.
  This service-defined certificate has a generic CN and its CA lacks KeyUsage;
  the deployment uses an explicit CA file, CA-only verification, and legacy
  X.509 compatibility. Certificate-chain verification remains required.
- Worker version: `a75d4a12-6d61-42aa-bc91-dd88e27d4bda`.
  Previous version: `c24feab0-fc14-4e07-9f1e-b3a8ee0c4515`.
- Daily UTC schedules remain `01:23`, `09:47`, `17:11`; local UTC+8 times are
  `09:23`, `17:47`, `01:11`. These cover all five registered services.
- Validation: 31 Worker tests and 27 bridge tests passed, as did checks/build.
  Two actual Japan records were committed and independently read back by UUID.
  Duplicate replay returned the same row; conflicting replay returned 409.
  Production reads succeeded for all five services; `mysql_us` returned 400.
  Existing service counts were unchanged during this validation.
- The existing administrative trigger token was unavailable during rollout;
  writes were verified through the actual adapter/HTTPS bridge. The first
  natural production cron execution has not yet been observed.
- Rollback artifacts and the pre-existing local work are saved outside the repo
  at `/home/ubuntu/.local/state/keepalive/rollouts/20261010-japan-mysql`.
  This directory contains secrets; keep it private and never commit it.
