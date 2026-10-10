# Keepalive

A small database keepalive service with a public dashboard, scheduled check-ins,
and authenticated manual check-ins.

Supports **Supabase**, **Oracle Autonomous Database**, **IBM Db2**, and **MySQL**.
The dashboard shows check-in history for each database.

Runs as a single Docker container on **Google Cloud Run**, with **Cloud Scheduler**
for scheduled check-ins and **Cloudflare Tunnel** for private MySQL access.
Releases use GitHub Actions with OIDC; database credentials stay in Cloud Run
environment variables.

[Live dashboard](https://keepalive-jrvcceccza-uc.a.run.app/) ·
[Deployment](service/README.md) ·
[Configuration](.env.example) ·
[Contributing](CONTRIBUTING.md)
