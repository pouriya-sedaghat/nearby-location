# Nearby Location

Store each user's current location and discover fresh nearby users with PostgreSQL and PostGIS.

**Package version:** 2.14.0 · **Runtime:** Node.js 24, TypeScript, Express · **Database baseline used by CI:** PostgreSQL 16 / PostGIS 3.4

[Documentation](docs/README.md) · [API](docs/API.md) · [Deployment](docs/DEPLOYMENT.md) · [Development](docs/DEVELOPMENT.md) · [Presentation](docs/PRESENTATION.md)

## What the service does

- Creates or replaces one WGS84 location per user.
- Searches an inclusive radius in meters and returns each matched user's stored coordinates, distance, update timestamp, and English or Persian relative age.
- Orders results with configurable distance/freshness ranking and supports offset or cursor pagination.
- Excludes expired rows during reads and deletes them through bounded background cleanup.
- Provides optional service authentication, signed cursors, privacy erasure, overload protection, health probes, and Prometheus metrics.

The calling application owns end-user identity, consent, and authorization to publish or disclose coordinates. See [service scope and operating modes](docs/OVERVIEW.md).

## Start a local environment

Install Docker with the Compose plugin, then run:

```bash
git clone https://github.com/pouriya-sedaghat/nearby-location.git
cd nearby-location
./scripts/init-env.sh
sudo docker compose up --build -d --wait --wait-timeout 180
curl --fail http://localhost:8080/health/ready
```

Open [Swagger UI](http://localhost:8080/api-docs/). The default Compose profile uses generated private credentials, binds HTTP to loopback, runs migrations and preserves the existing `nearby-vm_pgdata` volume. Keep the existing `.env` when upgrading; do not rerun initialization. See [development setup](docs/DEVELOPMENT.md) for running Node directly and [deployment](docs/DEPLOYMENT.md) for production configuration.

Publish a synthetic location and search around it:

```bash
curl --fail-with-body http://localhost:8080/location/upsert \
  -H 'Content-Type: application/json' \
  -d '{"userId":"demo_user","coordinate":{"lat":35.6892,"lng":51.389}}'

curl --fail-with-body http://localhost:8080/location/nearby \
  -H 'Content-Type: application/json' \
  -d '{"coordinate":{"lat":35.6892,"lng":51.389},"maxDistance":5000,"pagination":"cursor","pageSize":10}'
```

These examples assume local authentication is disabled. Protected deployments require the appropriate bearer token; see [API examples](docs/API.md).

Stop the environment with `docker compose down`. This preserves the database volume.

## Choose your next guide

| Goal | Guide |
|---|---|
| Understand capabilities and mode choices | [Overview](docs/OVERVIEW.md) |
| Understand SQL, ranking, pagination, and lifecycle | [Architecture and diagrams](docs/ARCHITECTURE.md) |
| Integrate a caller | [API contract](docs/API.md) and [OpenAPI JSON](docs/openapi.json) |
| Configure an environment | [Configuration reference](docs/CONFIGURATION.md) |
| Develop or contribute | [Development](docs/DEVELOPMENT.md) |
| Deploy a container or Kubernetes environment | [Deployment](docs/DEPLOYMENT.md) |
| Evaluate an isolated VM | [VM procedure](docs/VM_TESTING.md) |
| Monitor, troubleshoot, or release | [Operations](docs/OPERATIONS.md) |
| Validate correctness and capacity | [Testing and tooling](docs/TESTING.md) |
| Review security and retention | [Security](docs/SECURITY.md) and [Privacy](docs/PRIVACY_AND_RETENTION.md) |
| Present the microservice | [Presentation outline and speaker notes](docs/PRESENTATION.md) |

## Production acceptance

The repository contains deployment examples and validation tools. Accept a release against its exact commit/image and target environment using the [production readiness gates](docs/PRODUCTION_READINESS.md). Replica count, pool size, latency targets, recovery objectives, and retention policy require environment-specific evidence.

For historical application changes, read the [changelog](CHANGELOG.md). For this release, read the [review results](docs/RELEASE_REVIEW.md) and [upgrade guide](docs/UPGRADING.md). The supplied documentation review remains a historical record.

The project uses the [ISC license](LICENSE). See [Contributing](CONTRIBUTING.md) for focused development and validation requirements.
