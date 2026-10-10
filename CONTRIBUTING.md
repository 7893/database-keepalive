# Contributing

Create a focused branch from `main`. Keep the Cloud Run service as the single
entry point and the root Dockerfile as the single image definition. Shared HTTPS
adapters live under `src/services/`; native database drivers live under `native/`.

Keep project-owned source and test files within 400 lines. Validate route inputs
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
