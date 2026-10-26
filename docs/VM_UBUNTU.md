# Ubuntu Server 26.04 VM deployment

[Documentation index](../README.md)

This guide runs application `1.0.0` and PostGIS on the same Ubuntu Server 26.04 VM using Docker Engine and the Compose plugin. Use the single default `docker-compose.yaml` configuration and the single private `.env` file.

## Deployment contract

| Item | VM profile |
| --- | --- |
| Host architecture | amd64 / x86-64 target; verify registry platform support before choosing another architecture |
| Application image | Built from this source using Node.js 24 Alpine, production target |
| Database image | `postgis/postgis:16-3.6-alpine` |
| Database access | Docker network hostname `postgres`, port 5432; no host port published |
| Application access | VM loopback `127.0.0.1:8080` by default |
| Documentation | `/api/docs/`, dedicated generated Basic Auth credentials, Execute enabled |
| Stored data | Named volume `nearby-vm_pgdata` |
| Database identity | Database/user `nearby`; generated password shared by migration and application connections |
| Service restart | `unless-stopped`; Docker must be enabled at host boot |
| Shutdown | Up to 60 seconds for each service |
| Logs | json-file rotation, 10 MB per file and three files per service |
| Timezone | UTC; default cleanup runs at 03:00 UTC |

The project name and volume match the previous VM package: `nearby-vm` and `nearby-vm_pgdata`. PostgreSQL remains major version 16. A deployment from the older local sample using `postgres-data` is a different stack; moving those data requires a planned backup/restore. Do not change the project name to move data.

## 1. Prepare Docker on the VM

Check the host:

```bash
cat /etc/os-release
dpkg --print-architecture
```

This package targets Ubuntu 26.04 and `amd64`. Verify the selected images' current platform support and the deployment before using another architecture.

If Docker Engine and the Compose plugin are already installed, verify them and skip installation. For a fresh VM, install from Docker's official Ubuntu repository:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl openssl unzip
sudo install -d -m 0755 /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod 0644 /etc/apt/keyrings/docker.asc

ubuntu_suite=$(. /etc/os-release; printf '%s' "$VERSION_CODENAME")
ubuntu_arch=$(dpkg --print-architecture)
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $ubuntu_suite
Components: stable
Architectures: $ubuntu_arch
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
sudo docker run --rm hello-world
```

If the VM already has conflicting container packages or company-managed repositories, follow the [official Docker installation guidance](https://docs.docker.com/engine/install/ubuntu/) instead of replacing packages blindly. Commands here use `sudo`; membership in the Docker group is not required. Ensure `openssl` and `unzip` are installed even if Docker was preinstalled.

The VM needs outbound access to the configured Ubuntu/Docker package repositories, container registry and npm registry during installation/build. A company proxy or registry mirror may be required by local network policy. Native Node.js or PostgreSQL installation on the VM is unnecessary.

## 2. Extract and verify the release

Transfer the supplied ZIP to the VM and extract it into a deployment directory owned by the deployment operator. Enter the resulting `nearby-location` directory. Avoid mixing multiple releases in the same directory before verifying their files.

```bash
cd nearby-location
sha256sum --check SHA256SUMS
```

All entries must report `OK`. The checksum manifest detects changed files; obtain the ZIP through your trusted delivery channel.

## 3. Generate private configuration

From the project root, as the deployment operator:

```bash
./scripts/init-env.sh
chmod 600 .env
```

The initializer generates a 64-character hexadecimal database password and a separate 48-character documentation password. It refuses to overwrite any existing file or symbolic link. It does not print credentials. The shipped `.env.example` is the only template. Its passwords are empty, so an uninitialized copy fails Compose validation. The initializer requires GNU coreutils and OpenSSL; it publishes only a completed file and removes temporary files after failure. It always writes beside the project, even if invoked from another directory.

Retain `.env` for every restart and upgrade. View or edit it locally with your preferred editor to obtain the Swagger password or change supported settings. Do not commit or distribute the generated file. Compose reads `.env` automatically from the project root. Environment variables available to the Compose process take precedence; remove stale overrides, including `COMPOSE_FILE`, `COMPOSE_ENV_FILES` and `COMPOSE_PROJECT_NAME`. With `sudo`, the effective environment may differ from the caller's shell.

The VM profile fixes the internal database hostname, user and database name. It constructs `DATABASE_URL` from `POSTGRES_PASSWORD`; a separate `DATABASE_URL` in your shell is not used. Keep the generated password hexadecimal so URL interpolation remains valid. Database initialization values apply only to an empty volume: changing the file later does not change the stored PostgreSQL password. Coordinate an SQL password rotation and service configuration update when needed.

The bootstrap database role is also used for migrations and runtime queries, matching the existing application deployment model. Companies requiring separate migration and restricted runtime roles should provision and validate that database access model before enabling client traffic; see [Database](DATABASE.md).

## 4. Validate and start

From the project root, Compose automatically selects `docker-compose.yaml` and `.env`:

```bash
sudo docker compose config --quiet
sudo docker compose pull postgres
sudo docker compose \
  up -d --build --wait --wait-timeout 180
sudo docker compose ps
```

`config --quiet` validates without printing resolved credentials. Database health gates application startup. The application entrypoint applies migrations before starting HTTP. `--wait` checks service health after startup; the first image build can take longer than subsequent starts. Inspect logs if startup fails:

```bash
sudo docker compose \
  logs --tail=100 nearby postgres
```

There is no second Compose profile to select. Keep all lifecycle commands in this deployment directory.

## 5. Verify HTTP and Swagger

On the VM:

```bash
curl -fsS http://127.0.0.1:8080/health/live
curl -fsS http://127.0.0.1:8080/health/ready

curl -fsS http://127.0.0.1:8080/location/upsert \
  -H 'Content-Type: application/json' \
  --data '{"userId":"vm-smoke-test","coordinate":{"lat":35.6892,"lng":51.389}}'

curl -fsS http://127.0.0.1:8080/location/nearby \
  -H 'Content-Type: application/json' \
  --data '{"coordinate":{"lat":35.6892,"lng":51.389},"maxDistance":1000,"page":1,"pageSize":10}'
```

Expect both health requests to succeed, the upsert success message, and the smoke-test identifier among fresh nearby results. The write is real. There is no delete endpoint; the record follows the existing TTL/cleanup policy. If you changed `PORT`, use that port in every request and tunnel.

For browser access from your workstation, open a tunnel in a separate terminal, substituting the VM's SSH login and address:

```bash
ssh -N -L 8080:127.0.0.1:8080 vm-user@VM_IP
```

Open `http://127.0.0.1:8080/api/docs/` on the workstation. Use `docs_operator` and the generated `SWAGGER_AUTH_PASSWORD` from the VM's `.env`. The HTTP connection is carried through SSH. Follow the [Swagger guide](SWAGGER.md) to execute all four operations.

## 6. Connect company clients

The default loopback mapping deliberately accepts host-local access and SSH tunnels. No VM firewall opening for 8080 or 5432 is needed for this workflow.

The location API has no built-in authentication or identifier ownership checks. Before company clients can access it, connect the company's authenticated HTTPS gateway or reverse proxy to `127.0.0.1:8080`. Configure identity checks and network access there; Swagger Basic Auth protects documentation only. The gateway must reach the VM's loopback address, so a proxy running on another host needs a separately designed private connection.

For a proxy on this VM, keep the loopback mapping. If an approved network design requires binding the container to a VM interface, change the `ports` host address deliberately and enforce access through your company's network/gateway rules. Docker-published ports can bypass ordinary UFW rules. See [Docker firewall guidance](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations).

Keep `BASE_URL=/` when serving the API at the origin root. A gateway path prefix also needs appropriate forwarding and an OpenAPI server URL matching that prefix; `BASE_URL` does not relocate Express routes.

## 7. Operate and back up

Start services automatically at host boot with the Docker service enabled and the configured restart policies. An unhealthy status alone does not trigger a restart; inspect health/logs and underlying database availability.

To restart without changing credentials:

```bash
sudo docker compose restart
```

For configuration changes, recreate instead:

```bash
sudo docker compose \
  up -d --wait --wait-timeout 180
```

Create a database backup outside the source directory:

```bash
umask 077
mkdir -p ../nearby-backups
chmod 700 ../nearby-backups
sudo docker compose exec -T postgres \
  pg_dump -U nearby -d nearby -Fc \
  > "../nearby-backups/nearby-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Check the command's exit status and retain backups in protected storage outside the VM as well. A volume on the same VM is persistent storage, not an independent backup. Rehearse restoration into a disposable PostGIS database before relying on it. See [Operations](OPERATIONS.md) for recovery considerations.

Stop the stack while preserving the data volume:

```bash
sudo docker compose down
```

Do not add `--volumes` for an ordinary shutdown. Preserve `.env`, the Compose project name and the named volume. Changing the project name selects a different volume and can make the existing data appear absent.

## Upgrade from the previous VM package

The earlier VM package used `.env.vm` and `docker-compose.vm.yaml`. This release replaces those names with `.env` and `docker-compose.yaml`. The service names, project name, images, database identity and volume key are unchanged. Existing passwords must be retained.

1. Back up the running database using the previous deployment commands, and retain its source and configuration.
2. Extract this package into a clean release directory and verify `SHA256SUMS` before copying private configuration. Do not overlay it on an old source tree; this prevents the old templates and Compose file from remaining alongside the new files.
3. Copy the existing private `.env.vm` into that release directory. If you used a custom Compose project name, continue using that exact name for every command.
4. In the new project root, rename the copied file only if `.env` is absent:

```bash
test ! -e .env && test ! -L .env && mv -T -n -- .env.vm .env
chmod 600 .env
sudo docker compose config --quiet
sudo docker compose up -d --build --wait --wait-timeout 180
sudo docker compose ps
```

Skip the rename if the deployment already uses `.env`. Do not rerun initialization or change either password. The initializer refuses to generate a new file while `.env.vm` exists. An initialized database does not adopt a new password just because the environment file changes.

The default project `nearby-vm` continues to select `nearby-vm_pgdata`; preserve any previous project-name override. No volume deletion, export/import or schema rollback is needed for this configuration-only update of the VM profile. Verify the same volume attachment with `sudo docker volume inspect nearby-vm_pgdata` and repeat the health, existing-data and Swagger checks. Use your actual volume name if the project name was customized.

## Updates and acceptance limits

Back up before planned maintenance. Retain the deployed source/image and `.env` for rollback. Node.js 24 and PostGIS 16/3.6 tags receive updates; record or pin approved image digests in the company's release process. Pull or rebuild during a planned update, then repeat health, write/search and Swagger acceptance checks. PostgreSQL major-version upgrades require their own migration plan.

Use the linked official documentation to verify current host, runtime and registry requirements before deployment. This package's local validation is recorded in [Release validation](VALIDATION.md). The checks performed here do not establish real container startup or VM acceptance.

References:

- [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Compose environment interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)
- [Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/)
- [Node.js release status](https://nodejs.org/en/about/previous-releases)
- [PostGIS image tags and architecture](https://github.com/postgis/docker-postgis)
