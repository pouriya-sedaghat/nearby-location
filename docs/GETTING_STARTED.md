# Getting started

[Documentation index](../README.md)

## Requirements

The default deployment runs the service and PostGIS together using Docker Engine and its Compose plugin on an amd64/x86-64 Ubuntu Server 26.04 VM. The VM needs OpenSSL and GNU coreutils for configuration initialization; it does not need a host Node.js or PostgreSQL installation. See [Ubuntu VM deployment](VM_UBUNTU.md) for installation commands and access requirements.

Clone the repository or extract the source archive, then run deployment commands from the project root:

```bash
git clone https://github.com/pouriya-sedaghat/nearby-location.git
cd nearby-location
```

Use the included `docker-compose.yaml`; it is the single default deployment configuration.

## Initialize and start

For a fresh deployment:

```bash
./scripts/init-env.sh
sudo docker compose config --quiet
sudo docker compose up -d --build --wait --wait-timeout 180
sudo docker compose ps
sudo docker compose logs --tail=100 nearby
curl -fsS http://127.0.0.1:8080/health/ready
```

The initializer creates `.env` from `.env.example`, generates separate database and Swagger passwords, sets private permissions, and refuses to overwrite existing configuration. Compose reads `.env` automatically. Keep it for the lifetime of this deployment. If upgrading from the previous VM package, follow [the upgrade instructions](VM_UBUNTU.md#upgrade-from-the-previous-vm-package) instead of generating new credentials.

PostGIS must be healthy before the application starts. The entrypoint applies migrations and then starts HTTP. Database files persist in `nearby-vm_pgdata`. The application listens on VM loopback and the database has no host port. The commands below run on the VM, or on a workstation after opening the documented SSH tunnel.

## First write and search

```bash
curl -fsS -X POST http://127.0.0.1:8080/location/upsert \
  -H 'Content-Type: application/json' \
  --data '{"userId":"demo-user","coordinate":{"lat":35.6892,"lng":51.389}}'
```

Successful response:

```json
{"success":true,"message":"Location upserted successfully"}
```

```bash
curl -fsS -X POST http://127.0.0.1:8080/location/nearby \
  -H 'Content-Type: application/json' \
  --data '{"coordinate":{"lat":35.6892,"lng":51.389},"maxDistance":1000,"page":1,"pageSize":10}'
```

In a fresh database, the result includes `demo-user` at distance zero. The service does not automatically exclude the requester; send `excludeUserId` explicitly to omit an identifier. These requests write real data; records follow the configured TTL and cleanup policy.

## Open Swagger

From the workstation, substituting the SSH user and VM address:

```bash
ssh -N -L 8080:127.0.0.1:8080 vm-user@VM_IP
```

Open [Swagger UI](http://127.0.0.1:8080/api-docs/). Use `docs_operator` and the generated `SWAGGER_AUTH_PASSWORD` from the VM's `.env`. Follow [Interactive Swagger](SWAGGER.md) to execute all four operations. If you change `PORT`, adjust every request URL and tunnel accordingly.

## Stop and resume

```bash
sudo docker compose down
sudo docker compose up -d --wait --wait-timeout 180
```

An ordinary `down` preserves the database volume. Do not request volume removal for shutdown or source upgrades. Reuse `.env` and the same project name. See [Operations](OPERATIONS.md) for backups and troubleshooting, [Configuration](CONFIGURATION.md) for settings, and [Deployment](DEPLOYMENT.md) for optional direct execution.
