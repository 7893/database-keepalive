> Legacy Job deployment retained for rollback. The current target is the unified
> [Cloud Run service](../service/README.md); do not run both schedulers.

# Cloud Run scheduled check-ins

Cloud Scheduler invokes the `keepalive` Cloud Run Job in project `complete-silo`,
region `us-central1`. The Worker continues serving the existing dashboard and
authenticated manual actions. Its cron triggers must be empty after cutover.

The job calls Supabase REST and both Oracle ORDS endpoints directly, connects to
Db2 with the existing TLS-validated JDBC implementation, and calls the existing
Japan MySQL bridge through Cloudflare Tunnel. US business MySQL is excluded.
The Db2 bridge remains required for dashboard reads/manual actions; the Japan
MySQL bridge and tunnel remain required for all Japan MySQL access.

## Build and deploy

Run `npm test`, `npm run check`, and `npm run test:bridge` before deployment.
`job/prepare.py` stages only source and checksum-verified public dependencies.
Supply the existing IBM JCC 12.1.2.0 driver as `db2jcc4.jar` and DigiCert Global
Root CA as `db2-ca.pem` in a directory outside this repository.

```sh
python3 job/prepare.py /private/vendor-directory /private/new-build-directory
gcloud run jobs deploy keepalive --source=/private/new-build-directory \
  --project=complete-silo --region=us-central1 \
  --env-vars-file=/private/config.json
```

CPU, memory, task count, timeout, retry policy and runtime service account use
platform defaults. No custom labels are supplied. The region is required.
The private environment JSON file contains a string-valued object with Supabase and ADB settings
from the main README, `MYSQL_JP_BRIDGE_URL`, `MYSQL_JP_BRIDGE_TOKEN`, plus
`DB2_HOST`, `DB2_PORT`, `DB2_DATABASE`, `DB2_USER`, `DB2_PASSWORD`,
`DB2_JDBC_JAR=/app/vendor/db2jcc4.jar`, and
`DB2_CA_FILE=/app/vendor/db2-ca.pem`. Never upload that file as build source.
Cloud Run stores these values in Job configuration; identities with permission to
read Job configuration can read them. Secret Manager is not used. Keep the local
file outside Git with mode 600. Do not put credentials in shell arguments or logs.
GitHub Actions does not need database secrets for the existing test-only workflow.
The public GitHub repository has secret scanning and push protection enabled.
Keep private environment files outside both the repository and build directory.
Deploying an updated image preserves existing environment variables unless
explicitly replaced; never export a live Job configuration into Git.

## Execution and failure handling

All five services run independently. A failure produces a nonzero job exit,
allowing Cloud Run's default retry policy to apply. Logs contain service names,
success booleans and execution IDs, not credentials or raw driver exceptions.
ORDS success requires a successful DML result affecting one row, not HTTP 200
alone. Db2 commits and verifies via a separate connection.

Db2/MySQL request IDs and simulated display geography are deterministic per
execution, so retries reuse the same row. Supabase and ADB writes are at-least-once:
a retry after partial success may add another heartbeat. Geography remains
simulated display data, not the Google execution location or source IP.

## Cutover and rollback

1. Execute the deployed job and independently read all five databases' records.
2. Create Scheduler jobs using OAuth to call the Cloud Run `:run` API. Grant its
   calling service account `roles/run.invoker` on this job, not the whole project.
3. Preserve the existing UTC schedules: `23 1 * * *`, `47 9 * * *`, `11 17 * * *`.
4. Remove Worker cron schedules only after cloud execution succeeds.
5. Verify Scheduler authentication with one manually dispatched scheduled job.

To roll back, pause all three Google schedules before restoring those cron
expressions in `wrangler.jsonc` and deploying the Worker. Do not run both schedules
indefinitely. Keep all existing records and bridge services.

Compute is expected to fit the monthly free tier; build, image storage, logs,
and cross-cloud egress are separate metered services.
