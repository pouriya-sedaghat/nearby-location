# Nearby Location

A TypeScript and Express service for storing users' latest locations and finding nearby users with PostgreSQL and PostGIS.

**Application version:** `1.0.0`

**Documentation language:** English. The API supports English and Persian human-readable responses through `Accept-Language`; English is the default. Parameter names, numeric values and ISO timestamps stay unchanged. See [Response language](docs/API.md#response-language).

## Service behavior

The service stores one current location per `userId`. Nearby searches return locations that meet the configured freshness window and radius. Results are ranked by distance and update time, and include the stored coordinates, distance in meters, and last update timestamp.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/location/upsert` | Create or update a location |
| POST | `/location/nearby` | Search with radius and pagination |
| GET | `/health/live` | Check process liveness |
| GET | `/health/ready` | Check database query availability |

When enabled, Swagger is available at `/api-docs/` with interactive Execute, editable named examples, request snippets, response timing and schema exploration. See the [Swagger guide](docs/SWAGGER.md) for a complete execution workflow. Swagger authentication protects documentation only. Location API access must be controlled by the deployment's access layer.

## Quick start

With Git, Docker and Compose installed, clone the repository and start from its root:

```bash
git clone https://github.com/pouriya-sedaghat/nearby-location.git
cd nearby-location
./scripts/init-env.sh
sudo docker compose config --quiet
sudo docker compose up -d --build --wait --wait-timeout 180
sudo docker compose ps
curl -fsS http://127.0.0.1:8080/health/ready
```

The default deployment is Docker on Ubuntu Server 26.04 with PostGIS on the same VM. One template, `.env.example`, produces one private configuration file, `.env`. Compose reads it automatically from the project root; no profile or environment-file flags are needed. The initializer is only for the first setup. Preserve `.env` for restarts and upgrades.

HTTP is bound to VM loopback; PostGIS has no published host port. Swagger is enabled with generated credentials. Follow [Ubuntu VM deployment](docs/VM_UBUNTU.md) for Docker installation, SSH access and upgrading an earlier VM package. See [Getting started](docs/GETTING_STARTED.md) for the first API requests.

## API example

Create a test location, then search from the same center:

```bash
curl -fsS http://127.0.0.1:8080/location/upsert \
  -H 'Content-Type: application/json' \
  --data '{"userId":"demo-user","coordinate":{"lat":35.6892,"lng":51.389}}'

curl -fsS http://127.0.0.1:8080/location/nearby \
  -H 'Content-Type: application/json' \
  -H 'Accept-Language: en' \
  --data '{"coordinate":{"lat":35.6892,"lng":51.389},"maxDistance":1000}'
```

Set `Accept-Language: fa` for Persian messages and display ages. `updatedAt` is the stored ISO timestamp; `updateStatus` is recalculated at each request's start. See [API semantics](docs/API.md) for ranking, pagination, time units and validation rules.

## Development checks

With Node.js 24, npm and Python 3 installed:

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run openapi:check
```

The default tests use isolated fake persistence. Real spatial-query tests require a dedicated disposable PostGIS database and are skipped without `INTEGRATION_DATABASE_URL`. See [Testing](docs/TESTING.md) for integration and optional Swagger DOM checks.

## Documentation

| Guide | Coverage |
| --- | --- |
| [Getting started](docs/GETTING_STARTED.md) | Single-path setup and first requests |
| [API reference](docs/API.md) | Contracts, validation, responses, and errors |
| [Interactive Swagger](docs/SWAGGER.md) | Execute requests, examples, console controls, authentication and troubleshooting |
| [Configuration](docs/CONFIGURATION.md) | Variables, defaults, and precedence |
| [Architecture](docs/ARCHITECTURE.md) | Components and request processing |
| [Database](docs/DATABASE.md) | Schema, indexes, migrations, and TTL |
| [Deployment](docs/DEPLOYMENT.md) | Docker lifecycle, optional direct execution, and rollback |
| [Ubuntu VM deployment](docs/VM_UBUNTU.md) | Ubuntu Server 26.04, Docker, local PostGIS, private configuration, access and backups |
| [Operations](docs/OPERATIONS.md) | Health checks, logs, maintenance, and troubleshooting |
| [Testing](docs/TESTING.md) | Database-independent and real PostGIS tests |
| [Development](docs/DEVELOPMENT.md) | Project structure, commands, and contract maintenance |
| [Performance](docs/PERFORMANCE.md) | SQL, benchmarks, and result interpretation |
| [Security](docs/SECURITY.md) | Access boundaries, TLS, and dependency findings |
| [Package validation](docs/VALIDATION.md) | Executed checks and limitations |
| [OpenAPI](docs/openapi.json) | Importable machine-readable contract |
| [Contributing](CONTRIBUTING.md) | Development workflow and pull request checks |
| [Changelog](CHANGELOG.md) | Published version history |

## Runtime defaults

The default port is `8080`, default search radius is `10000` meters, default maximum radius is `100000` meters, and default location TTL is `7` days. See [Configuration](docs/CONFIGURATION.md) for overrides.

The application image uses Node.js 24 Alpine and installs only production dependencies in its final stage. The Compose database uses PostgreSQL 16 and PostGIS 3.6 on amd64/x86-64. For direct execution, use Node.js 24 and a separately reachable database with PostGIS. The VM does not need Node.js or PostgreSQL installed on the host.

The project uses the [ISC license](LICENSE). Consult [Package validation](docs/VALIDATION.md) for executed checks and the scope of deployment verification.
