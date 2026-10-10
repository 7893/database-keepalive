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

- Configure `TRIGGER_SECRET` as a long, random secret.
- Store provider credentials in Cloud Run environment variables, never in source,
  image layers, or GitHub. Use a separate `SCHEDULER_TOKEN` for scheduled writes.
- Authenticate GitHub releases using OIDC, without service-account private keys.
- Keep `display.show_full_ip` false in `config.yaml` unless publishing full
  addresses is deliberate.
- Restrict Oracle, Supabase, IBM and MySQL credentials to the minimum permissions
  required by their adapters.
- Review observability retention and access before enabling production logs.
- Rotate a credential immediately if it may have entered a commit, log, issue,
  build artifact, or shared terminal output.

The repository's secret scanner detects several common token formats, but it
cannot prove that a repository is free of secrets. Always review the complete
history before making an existing repository public.
