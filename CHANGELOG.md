# Changelog

This file records user-visible changes. Application version numbers are defined in `package.json`.

## 1.0.0 - 2026-10-25

Initial repository publication.

- Store one current WGS84 location per user and search fresh nearby locations with PostGIS geography, radius filtering and pagination.
- Return each matched user's stored coordinates, distance, exact update timestamp and dynamic display age.
- Support English and Persian human-readable API responses through `Accept-Language`, with English as the default and request-local language isolation.
- Calculate display age using one server timestamp captured at request start, elapsed short units and completed UTC calendar months/years.
- Provide process liveness, database readiness and authenticated interactive Swagger documentation with a generated OpenAPI contract.
- Include validated configuration, private credential initialization, a persistent Compose deployment, owned database/cleanup lifecycles and graceful shutdown.
- Disable dependency install scripts in Docker and documented installation commands; project build and runtime commands remain explicit.
- Include unit, HTTP, contract and optional Swagger DOM tests, a dedicated PostGIS integration suite, operational guides and reproducible source packaging.

The schema, ranking formula, TTL semantics and VM deployment identity remain compatible with the reviewed source package. See [Release validation](docs/VALIDATION.md) for executed checks and remaining deployment acceptance work.
