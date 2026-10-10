# Contributing

Create a focused branch from `main`. Keep one Cloud Run service and one root
Dockerfile. Keep every project-owned code file within **300 lines**, including
JavaScript, Python, CSS, SQL and workflow files. `npm run check` enforces this
limit and checks JavaScript and JSON syntax. CI also checks Python syntax.

## Directory guide

| Directory | Responsibility |
| --- | --- |
| `src/config/` | Service definitions, constants and required settings |
| `src/runtime/` | HTTP server startup, configuration and native process lifecycle |
| `src/http/` | Routes, authentication, responses and scheduled HTTP entry point |
| `src/db/` | Database adapters, service operations and shared read cache |
| `src/geo/` | Location data, geographic modes and repeatable scheduled metadata |
| `src/shared/` | Formatting, input parsing, upstream requests and IP privacy |
| `src/ui/` | Page, shared rendering, browser interactions and scoped CSS files |
| `native/` | Python database drivers, shared row fields and stdio RPC |
| `test/` | Tests grouped by responsibility, including native driver tests |
| `scripts/` | Checks, public build dependencies, release verification and recovery |
| `docs/` | Deployment details; README stays a short introduction |
| `migrations/` | Historical and bootstrap SQL |

Keep database details out of routes and presentation. Reuse the same rendering
functions for the first page and browser pagination. Share small capabilities
such as validation and caching; keep database-specific transaction logic in its
own driver. Preserve public API identifiers when changing display names.

Validate untrusted route inputs
before upstream calls. Never log credentials, authorization headers, or complete
client IPs. Do not commit populated environment files, generated GitHub OIDC
credential files, or provider responses containing private data.

Run these checks before publishing:

```sh
npm run check
npm test
npm run test:native
```

Unit tests mock outbound requests and database connections. The release workflow
separately performs read-only live health checks after deployment. Describe the
behavior change, validation, and any configuration or migration requirements in
the pull request. Secret scanning does not replace reviewing the diff.
