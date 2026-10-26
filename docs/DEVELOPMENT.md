# Development and contribution guide

[Documentation index](README.md) · [Architecture](ARCHITECTURE.md) · [Testing](TESTING.md)

## Prerequisites

- Node.js **24.x**, matching `.nvmrc`, package engines, Docker, and CI.
- npm and the committed `package-lock.json` for reproducible installation.
- PostgreSQL with PostGIS. CI uses PostgreSQL 16 / PostGIS 3.4; validate other versions before relying on them.
- Bash and Python 3 for the repository's operational/source-packaging tests.
- Docker and the Compose plugin for container development, VM evaluation, and monitoring checks via Docker.

## Option A: local Compose

```bash
git clone https://github.com/pouriya-sedaghat/nearby-location.git
cd nearby-location
NODE_ENV=development docker compose --project-directory . -f deploy/compose.development.yaml up --build -d --wait
curl --fail http://localhost:8080/health/ready
```

The API is at `http://localhost:8080`; Swagger is at `/api/docs/`. The database is internal to the Compose network and is not published to the host. The development Compose profile replaces `DATABASE_URL` with its internal database URL. Source is copied into the development image rather than bind-mounted, so host changes require rebuilding/recreating the container.

Use `docker compose --project-directory . -f deploy/compose.development.yaml logs --tail 100 nearby` for diagnostics and `docker compose --project-directory . -f deploy/compose.development.yaml down` to stop while retaining data. A pre-existing PostgreSQL volume preserves its original initialization and credentials.

## Option B: run Node on the host

Use a development PostGIS database reachable from the host. A disposable local database can be started with:

```bash
docker run -d --name nearby-dev-db \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=nearby_dev \
  -p 127.0.0.1:5432:5432 postgis/postgis:16-3.4
docker exec nearby-dev-db pg_isready -U postgres -d nearby_dev
```

Wait for the database to become ready, then install and configure:

```bash
npm ci --ignore-scripts
cp .env.example .env
```

Edit `.env` to use `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nearby_dev`. Then:

```bash
NODE_ENV=development npm run migrate:up
npm run dev
```

`npm run dev` explicitly uses `NODE_ENV=development` and watches TypeScript through tsx. Direct Node runs never invoke startup migrations. To run compiled code:

```bash
npm run build
NODE_ENV=development npm start
```

The server loads environment files from its working directory. Exported variables win over files. See [configuration precedence](CONFIGURATION.md#loading-and-precedence).

## Source organization

| Path | Change here when… |
|---|---|
| `src/routes/` | Adding or mounting endpoints |
| `src/schemas/` | Changing input validation |
| `src/controllers/` | Changing orchestration, response fields, or error handling |
| `src/models/location.model.ts` | Changing SQL, candidate selection, counts, or data mapping |
| `src/config/env.ts` | Adding settings or cross-setting validation |
| `src/config/openapi.definition.ts` and `openapi.ts` | Changing the explicit contract and runtime projection |
| `src/config/swagger.ts` | Changing authenticated UI behavior |
| `src/utils/cursor.ts` | Changing cursor encoding, compatibility, query binding, or age checks |
| `src/utils/admission-core.ts` | Changing pure admission/circuit/adaptive/rate algorithms |
| `src/utils/admission.ts` | Connecting those algorithms to pool, logging, and metrics |
| `src/jobs/cleanup.job.ts` | Changing retention scheduling or batch orchestration |
| `migrations/` | Adding versioned database changes |
| `scripts/` and `scripts/lib/` | Changing operational commands and reusable tooling logic |
| `tests/` | Adding behavioral regressions and real database coverage |
| `deploy/` | Changing container/cluster procedures and platform defaults |

The [architecture source map](ARCHITECTURE.md#source-responsibilities) explains interactions.

## Make a change

1. Branch from the current `main` and identify the behavior to change.
2. Update the relevant code and add a regression test for material behavior changes.
3. Keep HTTP contract, validation, SQL, and generated OpenAPI consistent.
4. Run relevant checks from [testing](TESTING.md); use an isolated database for integration coverage.
5. Update affected English guides and changelog for application behavior changes.
6. Open a pull request describing the trigger, resulting behavior, validation, and deployment impact.

Express 4 needs rejected asynchronous handlers forwarded explicitly. Preserve the middleware ordering and `finally`-based release of admitted work. Keep SQL parameterized, preserve longitude/latitude order, and avoid logging coordinates, IDs, tokens, cursors, or raw production database messages.

## Database migrations

```bash
npm run migrate:create -- add_example_field
npm run migrations:check
```

Review the generated file and implement `exports.up`/`exports.down`. Test it against a disposable database and rehearse an upgrade from the existing schema. Do not modify already-applied migrations for a normal release.

Use expand/contract changes so old and new images can coexist. The migration policy tool analyzes `exports.up` for common destructive/breaking operations; it is a guardrail rather than a proof of compatibility. `migrate:down` can delete data: the initial down migration drops `locations` and PostGIS. Application rollback must not assume automatic database rollback.

## Maintain the documentation

| Source change | Documentation to update |
|---|---|
| Route, request, response, status, or pagination | [API](API.md), explicit contract definition/shared schemas, generated `openapi.json` |
| Environment variable/default/constraint | [Configuration](CONFIGURATION.md), affected deployment profiles and procedures |
| SQL, ranking, cursor, cleanup, or lifecycle | [Architecture](ARCHITECTURE.md), API consistency notes, affected runbooks |
| Deployment or release script | [Deployment](DEPLOYMENT.md), [VM guide](VM_TESTING.md), [release guide](../deploy/kubernetes/release/README.md) |
| Operational command or evidence | [Testing](TESTING.md), [Operations](OPERATIONS.md), [readiness](PRODUCTION_READINESS.md) |
| Product capability | [Overview](OVERVIEW.md), [presentation](PRESENTATION.md), short root README summary |

Generate OpenAPI without local production secrets or custom radius settings:

```bash
NODE_ENV=test npm run docs:api
git diff -- docs/openapi.json
```

Use a clean checkout/environment for the committed contract. CI uses `NODE_ENV=test` and compares the generated file. Keep each guide focused, add source links for technical behavior, and maintain the index and Mermaid diagram catalogue. Check relative links, heading anchors, shell examples, and diagram syntax before review. Dated benchmark numbers belong in release evidence tied to a commit/image and dataset rather than in generic setup instructions.

## Package a source release

```bash
npm run release:source
```

Python 3 produces `nearby-location-postgis-v2.14.1.zip` with deterministic timestamps, LF text, and executable shell metadata. The packager excludes local environment files except `.env.example`, build/dependency directories, VM reports, ZIP files, and the known real Kubernetes Secret path. An explicit path allowlist is used in both Git checkouts and extracted archives; unrelated exports and supported-path symbolic links are rejected or excluded. A SHA256SUMS manifest covers all distributed source files except itself. The application production image does not contain Python or development tooling.
