# Contributing

Read the [architecture](docs/ARCHITECTURE.md), [API contract](docs/API.md) and [development guide](docs/DEVELOPMENT.md) before changing behavior. Keep pull requests focused on one concrete problem and describe the resulting behavior, relevant tradeoffs and validation.

## Local setup

Use Node.js 24, npm and Python 3. Configuration-initialization tests also require a POSIX shell, GNU coreutils and OpenSSL. Install the exact dependency graph and run the database-independent checks:

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run openapi:check
```

No real database is needed for the default unit and HTTP checks. The PostGIS suite is skipped unless `INTEGRATION_DATABASE_URL` is configured. It truncates its database: use only a dedicated disposable instance. Follow [Testing](docs/TESTING.md) for integration and optional Swagger DOM commands.

## Change requirements

- Add a focused regression test for a behavior correction. Preserve existing API fields, status codes, coordinate order and default English messages unless the change explicitly updates that contract.
- For an API change, update `src/config/openapi.ts`, regenerate with `npm run openapi:export`, and update the API and Swagger guides. Do not edit generated OpenAPI independently.
- For validation or message changes, verify English and Persian responses and concurrent request isolation. Never change a process-wide locale per request.
- For SQL, schema or persistence changes, run the real PostGIS suite. Describe migration, compatibility and rollback effects; do not use a production database for tests.
- For dependency changes, commit the lockfile, run both `npm audit` and `npm audit --omit=dev`, and review advisories and compatibility before changing major versions.
- Keep documentation in English; localized response examples may contain Persian. Record user-visible changes in the changelog.

Never commit `.env`, credentials, database dumps, private keys, installed dependencies or build output. The source packager uses an explicit allowlist; update its rules and regression coverage when adding a distributable format or directory.

## Pull request description

Explain the trigger or problem, what a caller or operator will observe after the change, and which checks ran. State skipped checks and environment limitations directly. Include examples when behavior changes, and link an existing issue when applicable. Do not describe a skipped database test or an unbuilt image as validated.

For a security concern, avoid posting credentials or exploitable deployment details in a public issue. See the [security guide](docs/SECURITY.md) for deployment boundaries and dependency scope.
