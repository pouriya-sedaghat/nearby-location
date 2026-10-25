# Deployment and version management

[Documentation index](../README.md)

## Default deployment

Use Docker Engine and Compose on the Ubuntu Server 26.04 VM, with PostGIS on the same host. There is one Compose file (`docker-compose.yaml`), one template (`.env.example`) and one real configuration (`.env`). See [Ubuntu VM deployment](VM_UBUNTU.md) for Docker installation and complete setup.

For the first deployment only:

```bash
./scripts/init-env.sh
sudo docker compose config --quiet
sudo docker compose up -d --build --wait --wait-timeout 180
sudo docker compose ps
```

The production build target, UTC, database identity and internal connection address are fixed by Compose. It requires generated credentials, waits for PostGIS health, applies migrations through the entrypoint, and checks HTTP readiness. HTTP is bound to loopback, PostGIS is not published, logs rotate, and the application runs as a non-root container user. The production dependency stage installs with `npm ci --ignore-scripts --omit=dev`. The migration CLI is a declared runtime dependency; TypeScript, tsx and contract-validation tools are excluded from the final image. The final stage uses the image's built-in non-root `node` user and contains only compiled application code, migrations, the migration wrapper, dependency manifests and the entrypoint. No compiler toolchain or PostgreSQL client is installed.

Neither `.env` nor any real credential file is copied into the image. Compose maps only the declared variables into each service. See [Configuration](CONFIGURATION.md) for precedence and [Security](SECURITY.md) for API access boundaries.

## Configuration changes and restarts

Edit `.env` locally. Keep database credentials consistent with the initialized PostgreSQL role. Recreate containers to apply changed configuration:

```bash
sudo docker compose config --quiet
sudo docker compose up -d --wait --wait-timeout 180
```

For an unchanged configuration, use `sudo docker compose restart`. Changing `PORT` updates both the host and container listener; update the tunnel and any gateway upstream. `NODE_ENV` in the shell does not change the Compose build target or runtime mode.

## Source updates and rollback

Back up before maintenance. Extract a release into a clean directory, verify `SHA256SUMS`, then carry forward the same private `.env` with mode `0600`. Keep the same Compose project name (`nearby-vm` by default), volume and database identity. For packages that used `.env.vm`, follow [the one-time upgrade procedure](VM_UBUNTU.md#upgrade-from-the-previous-vm-package).

```bash
sudo docker compose config --quiet
sudo docker compose up -d --build --wait --wait-timeout 180
```

Retain the previous source/image and configuration for rollback, and repeat acceptance checks after every update. This application version has the existing schema and no new migration. Do not use `migrate:down` for package rollback: it deletes data. PostgreSQL major-version changes require a separate data migration plan. See [Operations](OPERATIONS.md) for backups.

## Optional direct Node execution

The VM Compose workflow needs no host Node.js. For development or a separately managed runtime, use Node.js 24, npm and a separately reachable PostGIS database. This uses the same `.env` filename; there are no additional environment templates.

```bash
npm ci --ignore-scripts
./scripts/init-env.sh
```

Skip initialization if `.env` already exists. Configure `DATABASE_URL` in `.env` using the real connection for this execution mode, with URL-encoded credentials, or export it in the process environment. `DATABASE_URL` is required for direct execution; there is no fallback credential. The internal Compose hostname `postgres` is not generally resolvable from the host, and the supplied Compose profile does not publish port 5432.

```bash
npm run typecheck
npm run build
NODE_ENV=production npm run migrate:up
npm start
```

For development, apply migrations to the development database and run `npm run dev` (tsx watch mode). Both the application and migration wrapper read only `.env` from the working directory, regardless of `NODE_ENV`; process variables take precedence. The generated Swagger credentials remain required for documentation login in either mode. `npm start` runs compiled JavaScript directly; `NODE_ENV` defaults to production through configuration and can be set explicitly by the process manager. Build tools are development dependencies, while migrations remain available after a production-only install. Use your process manager for restart, log collection and graceful shutdown.

## Swagger and deployment acceptance

Swagger and Execute are enabled in the template with separate generated login credentials. Use HTTPS or the documented SSH tunnel. Setting `SWAGGER_TRY_IT_OUT_ENABLED=false` makes the UI read-only; it does not secure the location endpoints. `BASE_URL` changes the OpenAPI server URL only; a gateway path prefix also requires routing configuration.

Check liveness and readiness, then perform one upsert and nearby search with an authorized test identifier. Verify coordinates and documentation login for the UI, assets and live OpenAPI. Readiness checks only database query availability. It does not prove that the schema, PostGIS, data permissions or gateway authorization are correct. The executed verification and remaining deployment checks are recorded in [Release validation](VALIDATION.md).
