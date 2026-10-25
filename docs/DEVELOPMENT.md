# Development and maintenance

[Documentation index](../README.md)

## Project structure

| Path | Contents |
| --- | --- |
| `src/` | Application TypeScript source |
| `migrations/` | Database schema definitions |
| `tests/` | Node test runner tests |
| `scripts/` | Migration wrapper, OpenAPI export, benchmark, packaging |
| `docs/` | Guides and generated OpenAPI |
| `dist/` | Build output; excluded from the source ZIP |
| `package-lock.json` | Locked versions for reproducible installation |
| `SHA256SUMS` | Packaged file hashes, excluding the checksum file itself |

Compilation uses strict TypeScript, CommonJS output, and ES2020 target. `rootDir` is `src`; `outDir` is `dist`.

## npm commands

| Command | Behavior |
| --- | --- |
| `npm run dev` | Development; tsx watch mode, without type checking |
| `npm run build` | Generate `dist` with TypeScript |
| `npm start` | Execute `dist/server.js`; configuration defaults to production |
| `npm run typecheck` | Type checking without emitted files |
| `npm test` | Build and run all tests |
| `npm run test:integration` | Build and run the database suite |
| `npm run migrate:up` | Apply pending migrations |
| `npm run migrate:down` | Roll back migrations; the current migration deletes data |
| `npm run migrate:create -- name` | Create a migration file through the CLI |
| `npm run openapi:export` | Build and regenerate `docs/openapi.json` |
| `npm run openapi:check` | Build and check contract freshness |
| `npm run benchmark:nearby` | Build and run the SQL comparison |

Development execution transforms TypeScript without type checking and does not replace `npm run typecheck`. The application and migration wrapper read only `.env` from the project root; `NODE_ENV` changes mode, not filenames. Verify `DATABASE_URL` before migrations. For optional host execution, use a separately reachable development database as described in [Deployment](DEPLOYMENT.md).

## Dependency ownership

`server.ts` is the executable composition root. Other modules export factories or types and start no runtime resources on import. `createApp` accepts validated configuration, a location repository, a database health dependency and a logger. Repository and database instances own their dependencies; tests provide independent fakes rather than modifying module singletons. `createService` owns startup/draining, while `runService` installs the executable's signal handling.

## Relative-time formatting

`timeAgo(date, referenceTime, language)` uses cached native `Intl.RelativeTimeFormat` for `en` and `fa`; omitted language defaults to English. Short units are elapsed units; months and years are completed UTC Gregorian calendar anniversaries with end-of-month clamping in both languages. It rejects invalid dates and retains the API's zero-age treatment of future timestamps. Standard Node.js 24 builds with English and Persian ICU data are required; unsupported runtimes fail explicitly instead of silently returning the wrong language. The app's optional internal clock dependency lets tests capture request-start time without replacing global `Date`. Use `updatedAt`, not the display string, for calculations. The unit policy is documented in [API](API.md#relative-display-age).

`request-context.middleware.ts` negotiates the standard `Accept-Language` header and captures one server timestamp before body parsing. `src/i18n/` contains supported languages and typed API messages. Schemas use per-language custom messages and per-parse validator error maps. Do not call global `z.config()` per request; it would let concurrent requests affect one another. Preserve default English text, error paths and machine-readable fields when maintaining translations. See [Response language](API.md#response-language).

Technical reference: [ECMA-402 RelativeTimeFormat](https://tc39.es/ecma402/#relativetimeformat-objects).

## Change workflow

Locate the relevant schema, controller, model, and tests before changing behavior. Contract changes must also be reflected in Swagger definitions and [API reference](API.md). For documentation-only edits, preserve application logic, dependencies, and migrations.

```bash
npm run typecheck
npm test
npm run openapi:check
```

For model or SQL changes, run the real PostGIS suite against a temporary database. For performance changes, compare before/after results with identical inputs and environment; see [Performance](PERFORMANCE.md).

## OpenAPI maintenance

`src/config/openapi.ts` is the single explicit contract definition for paths, operation IDs, schemas and examples. It receives only server URL and radius settings, reads the version from `package.json`, and does not load runtime credentials or scan route files. `src/config/swagger.ts` supplies validated runtime settings and creates instance-specific UI middleware. Compiled distributions do not need route sources or annotation comments. Keep the actual router declarations and contract aligned; tests exercise all four routes and validate the generated contract.

Export passes canonical values for `BASE_URL` and radius directly to the builder and does not read `.env` or unrelated process settings. Use the running process's documentation endpoint to inspect runtime values. Do not edit the generated file independently of its code definitions.

`swagger.test.js` validates OpenAPI structure and examples, checks production documentation authentication/settings, and executes the documented requests through actual controllers with stubbed database/model access. Optional DOM tests exercise the bundled UI itself; see [Testing](TESTING.md). The [Swagger guide](SWAGGER.md) documents the public console workflow.

## Dependency maintenance

Installation commands disable dependency lifecycle hooks with `--ignore-scripts`. The reviewed runtime and development graph works without these hooks, including the TypeScript/tsx tooling. Keep this flag in Docker and documented installation paths to avoid unneeded install-time code and telemetry. Explicit project build/test/start commands still execute normally.

Use `npm ci --ignore-scripts` for installation. Version changes must be recorded in the lockfile and verified with tests. The package contains a scoped `node-pg-migrate -> glob@11.1.0` override to address the CLI advisory affecting 11.0.3. Recheck versions and migration behavior before removing it.

The dependency graph uses Zod 4.6.7 and node-cron 4.6.0 with regression coverage for validation and schedule disposal. Development uses tsx instead of the previous ts-node-dev toolchain. Node types target version 24, and Express types target the actual Express 4 runtime. Contract validation dependencies are explicitly declared for development; swagger-jsdoc and its duplicate annotation parsing are removed. The migration CLI is a runtime dependency so production-only installs can migrate. Preserve compatible fixes in the lockfile and verify changes with the suite and both audit scopes; do not use `npm audit fix --force` without reviewing its effect.

## Source ZIP packaging

After build, tests, and export:

```bash
python3 scripts/package-source.py \
  --output ../nearby-location-postgis-v1.0.0.zip
```

The script regenerates `SHA256SUMS` and places source under `nearby-location/`. It includes an explicit set of root configuration files, TypeScript under `src/`, direct Markdown/JSON files under `docs/`, JavaScript migrations, supported scripts/tests and their known fixture formats. Unrelated root files/directories, database dumps, private key formats, build output, installed dependencies, hidden subdirectories and symbolic links are excluded. Only the root `.env.example` is included; real environment files are excluded.

When intentionally adding another distributable format or directory, update the explicit packaging rules and its regression test. Source files can still contain sensitive text, so review release content before delivery and inspect the ZIP. The entrypoint's executable mode is preserved in the archive.
