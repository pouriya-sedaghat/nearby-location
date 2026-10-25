# Upgrade to 2.14.0

[Documentation index](README.md) · [Release review](RELEASE_REVIEW.md)

Version 2.14.0 consolidates the supplied 2.13.5 source and its pending corrections with the published 1.0.0 service. The minor version identifies bilingual responses and the previously unreleased corrections relative to the supplied source. Compared with the published 1.0.0, the 2.x line adds cursor/ranking/privacy/observability controls. The initial database migration is byte-identical to the published migration; no schema change, password regeneration or data conversion is required for the existing VM.

## Existing 1.0.0 VM

1. Record the running commit/image and take a verified database backup using the existing deployment credentials. Keep rollback source/image available.
2. Preserve the current `.env`, Compose project `nearby-vm`, database role/database `nearby` and volume `nearby-vm_pgdata`. Update only tracked source files. Do not run `init-env.sh` again and do not remove volumes or run `migrate:down`.
3. Review new optional controls in [Configuration](CONFIGURATION.md). Existing values remain supported. Cursor signing, service bearer authentication, privacy erasure and adaptive admission are explicit operator choices; enabling authentication requires coordinating callers.
4. Rebuild and recreate the application with the same configuration and project:

```bash
sudo docker compose config --quiet
sudo docker compose up -d --build --wait --wait-timeout 180
sudo docker compose ps
curl -fsS http://127.0.0.1:8080/health/live
curl -fsS http://127.0.0.1:8080/health/ready
```

Do not publish the output of an unredacted `docker compose config`: it contains credentials. Verify existing locations, an authorized synthetic upsert/search, both response languages, Swagger login and restart persistence. The API still binds to loopback and PostgreSQL is not published. Root Compose forwards advanced settings from the same `.env`; it does not generate service tokens automatically. Use bearer protection or an equivalent authenticated gateway before exposing location data outside this private boundary.

Offset results retain existing fields and add ranking/pagination metadata and an optional continuation cursor. Readiness can add a circuit-state field. Clients should tolerate additive fields and use HTTP status, machine codes and validation paths rather than parsing human text.

## Supplied 2.13.5 installations

The default root Compose now follows the existing private VM profile. The supplied disposable root profile is retained as `deploy/compose.development.yaml`. It keeps its explicit `postgres-data` volume name and example database identity; it is a separate development path, not an automatic migration into `nearby-vm_pgdata`. Stop any old containers with their original configuration before switching profiles, and verify the selected volume/database. Do not attach an existing PostgreSQL volume to newly generated credentials or another role/database identity.

All server, migration and database-tool entrypoints now read **only `.env`**, with exported variables taking precedence. If the previous setup relied on `.env.production` or `.env.development`, review and merge the intended values into a private `.env` or explicitly export them before restart. Production requires an explicit valid PostgreSQL URI; the test/development fallback is not a production configuration.

Only `production`, `development` and `test` are supported for `NODE_ENV`; misspellings fail instead of enabling diagnostic error detail. Empty numeric values fail startup. Booleans must be `true` or `false`, except the documented optional Swagger switches. Preserve the configured TLS owner: with `PG_SSL=true`, remove conflicting URL TLS parameters and keep certificate verification enabled.

Zod 4 changes some default validation wording; the formatted `_errors` hierarchy and custom English rules are retained. Identifier limits remain 255 UTF-16 code units. Human text uses `Accept-Language`; English is the default. Display ages use completed UTC calendar months/years and zero age for future timestamps, preserving the published 1.0.0 policy. Age text is not a duration for arithmetic.

The isolated evaluation helper now uses project `nearby-evaluation` and defaults to host port 8081, separating it from the production `nearby-vm` stack. Existing `.env.vm` files are preserved, including an old port value; change that evaluation port before running beside production. Old laboratory volumes are not deleted or automatically reattached to a different database identity.

## Privacy and cursors

Stop upstream publishing before erasure. Normalized deletion follows the write identity; exact deletion is a separate byte-for-byte endpoint for stored identifiers. A missing exact endpoint returns 404 and deletes nothing. Treat that as not performed and retry on a supporting version; never fall back to normalized erasure. Signing keys, rotation windows and ranking settings must be coordinated across replicas. Language selection does not change query hashes or cursor validity.

## Kubernetes examples

The examples now reference 2.14.0, while release automation continues to require an immutable image digest. The stable Deployment selector includes `app.kubernetes.io/component: api` to keep maintenance pods out of its pod/HPA selection. A Deployment's selector is immutable: do not blindly apply this change to an existing selector. Plan a parallel replacement or a maintenance-window recreation with your routing/PDB/capacity policy. Review the rendered manifests before cluster changes. No cluster action is performed by updating this repository.

## Rollback

The database schema is unchanged. Restore the previous application image/source and its configuration after reviewing any callers that enabled new features. Keep the same database volume and credentials. Do not roll back the initial migration. If privacy erasure was used, preserve its external audit/replay obligations across any database restore; an application rollback must not restore erased location data.
