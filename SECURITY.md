# Security Policy

## Supported version

Security fixes are applied to the latest revision of the main development
branch. Older snapshots are not maintained separately.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities in a public issue or discussion.
Contact the maintainers through a private channel provided by the repository
host. If this project is hosted on GitHub, enable and use private vulnerability
reporting under the repository's Security tab.

Include only the information needed to reproduce and assess the issue:

- affected route or module;
- expected and observed behavior;
- minimal reproduction steps;
- potential impact;
- suggested mitigation, if known.

Remove credentials, access tokens, complete IP addresses, and customer data from
the report. Maintainers should acknowledge receipt privately and coordinate a
fix and disclosure timeline based on severity.

## Deployment guidance

- Keep `config.local.toml` (and any legacy `config.local.json`), `.dev.vars` and `.secrets.local.json` out of Git.
- Store deployed database credentials as Worker secrets.
- HTTP endpoints are read-only. Only the scheduler Durable Object alarm writes check-ins; Cron only wakes the scheduler.
- The dashboard is public. Use Cloudflare Access if you need private dashboard access.
- Use separate runtime database accounts with SELECT and INSERT permissions.
  Grant DELETE on the log table only when enabling optional retention; Supabase
  also requires the restricted retention RPC described in `migrations/README.md`.
- Disable Hyperdrive query caching and verify origin TLS certificates.
- Review Workers Logs retention and rotate any exposed credentials immediately.
- GitHub Actions deploys successful `main` builds when configured. Pull requests
  only run checks; the deployment token is available only to the deployment step.
