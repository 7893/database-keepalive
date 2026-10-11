# Database Keepalive

A lightweight Go service for scheduled database check-ins and a simple activity
dashboard. Run it in one Docker container on Google Cloud Run, with Cloud
Scheduler handling scheduled requests.

[Live dashboard](https://database-keepalive-691496895143.us-west1.run.app/) ·
[Deployment guide](docs/deployment.md)

## Supported databases

- **Supabase Database**
- **IBM Cloud Db2**
- **Oracle Cloud ADB**
- **Oracle Cloud MySQL**

Enable at least one database type and configure one or more instances for each
enabled type. Multiple instances of the same type are supported, in any region
reachable from the service. Each instance has its own connection credentials and
optional display name and region label.

The five instances in the default configuration are examples. Replace them with
your own; neither their number nor their regions are required.

## Features

- Randomized daily check-in counts and times: **1–3 per instance** by default.
- Separate schedules for each instance, with distinct planned minutes.
- Retries and duplicate protection for scheduled check-ins.
- A responsive activity dashboard with timestamps, results and pagination.
- Configurable page size, automatic refresh and online font preferences;
  **Ubuntu** is the default font.
- One commented YAML file for database selection, scheduling, display, runtime
  and deployment settings. Credentials stay in environment variables.

## Quick start

1. Fork or clone this repository.
2. Edit [`config.yaml`](config.yaml): select database types, define your instances
   and set your Google Cloud project, deployment region and service name.
3. Initialize each database using the matching
   [SQL script](migrations/README.md).
4. Prepare the required environment variables using
   [`.env.example`](.env.example) as a reference. Match each instance's
   `env_prefix` and keep real credentials outside Git.
5. Follow the [deployment guide](docs/deployment.md) to build the Linux amd64
   image, configure Cloud Run and create the Cloud Scheduler job.

After deployment, verify the dashboard and database reads:

```sh
go run ./cmd/smoke https://YOUR-SERVICE-URL
```

## How it works

Cloud Scheduler calls the service every minute. The service checks its daily
plan and writes a check-in only when an instance is due. Empty ticks return
without contacting databases. Daily counts and planned times follow the
configured range and timezone.

The dashboard reads committed records from the configured databases. MySQL can
connect directly or optionally use **Cloudflare Tunnel** for a private endpoint;
the tunnel connector must already have access to that database.

Check-ins generate database activity, but do not guarantee that a provider will
keep a database running or prevent suspension or resource reclamation. They do
not replace backups or monitoring.

## Documentation

- [Configuration and defaults](config.yaml)
- [Deployment, credentials and GitHub releases](docs/deployment.md)
- [Database initialization](migrations/README.md)
- [Contributing and project structure](CONTRIBUTING.md)
