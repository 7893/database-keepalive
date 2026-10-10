# Contributing

Create a focused branch from `main`. Keep one Cloud Run service and one root
Dockerfile. Keep every project-owned code file within **300 lines**.
`go run ./cmd/check` enforces this limit, Go formatting, JSON syntax and a
basic credential scan. The backend and maintenance tools use Go; the browser
uses a small JavaScript client with embedded HTML and CSS.

## Directory guide

| Directory | Responsibility |
| --- | --- |
| `config.json`, `settings.go` | User settings and their embedded defaults |
| `cmd/server/` | Container entry point |
| `cmd/check/`, `cmd/config/`, `cmd/smoke/` | Source checks, deployment settings and read-only release verification |
| `internal/config/` | Single-file settings, instance definitions and validated credential mappings |
| `internal/runtime/` | HTTP startup, shutdown and tunnel lifecycle |
| `internal/web/` | Routes, authentication and scheduled HTTP entry point |
| `internal/db/` | Database adapters, transactions, receipt verification and cache |
| `internal/scheduler/` | Repeatable daily plans and due-task selection |
| `internal/geo/` | Locations, geographic modes and repeatable metadata |
| `internal/ui/` | Embedded templates, browser interactions and styles |
| `docs/` | Deployment details; README stays a short introduction |
| `migrations/` | Historical and bootstrap SQL |

Keep database details out of routes and presentation. Reuse the same rendering
behavior for the first page and browser pagination. Share small capabilities
such as validation and caching; keep database-specific transaction logic in its
own driver. Preserve public API identifiers when changing display names.

Validate untrusted route inputs
before upstream calls. Never log credentials, authorization headers, or complete
client IPs. Do not commit populated environment files, generated GitHub OIDC
credential files, or provider responses containing private data.

Run these checks before publishing:

```sh
go run ./cmd/check
go test -race ./...
go vet ./...
docker build --platform linux/amd64 -t database-keepalive:check .
```

Tests live next to their packages and mock outbound requests and database
connections. Ordinary Go tests work on ARM without the IBM CLI. Production
builds target Linux amd64 with CGO and the `db2` build tag; the Dockerfile includes
the pinned IBM CLI. An untagged developer build explicitly rejects Db2 setup.
The release workflow
separately performs read-only live health checks after deployment. Describe the
behavior change, validation, and any configuration or migration requirements in
the pull request. Secret scanning does not replace reviewing the diff.
