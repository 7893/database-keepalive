# Database Keepalive

A small Go service that keeps databases active and displays their check-in history.

Supports **Supabase Database**, **IBM Cloud Db2**, **Oracle Cloud ADB**, and
**Oracle Cloud MySQL**, with multiple instances in any region.

Runs in one Docker container on **Google Cloud Run**, with **Cloud Scheduler**
for randomized daily check-ins. **Cloudflare Tunnel** is optional for private MySQL.

Configure databases, schedules, pagination, Google Fonts and deployment in
[`config.yaml`](config.yaml). Credentials stay in environment variables.

[Live dashboard](https://database-keepalive-jrvcceccza-uw.a.run.app/) ·
[Deployment](docs/deployment.md) · [Contributing](CONTRIBUTING.md)
