# Isolated VM evaluation

[Documentation index](README.md) · [Deployment](DEPLOYMENT.md) · [Testing](TESTING.md)

The evaluation profile uses project `nearby-evaluation` and host port 8081 so it cannot replace the existing `nearby-vm` production containers. Its named volume is separate. An existing `.env.vm` can still contain port 8080; review it before running beside production. See [upgrade guidance](UPGRADING.md).

## Scope and prerequisites

Use the supplied VM profile to evaluate the production image on an isolated host with synthetic data. It includes a persistent PostGIS container, generated independent credentials, signed cursors, dedicated privacy auth, localhost-only API exposure, and bounded log files. It is a single-host evaluation profile; production TLS ingress, HA, backup management, and operational acceptance remain your responsibility.

Install Git, Docker with a recent Compose plugin supporting `--wait`, Bash, OpenSSL, Python 3, and basic Linux diagnostic tools. Run from the checkout as a user authorized to use Docker. Node is supplied by the image; host Node is needed only for host-side development commands.

## Initialize, build, and start

```bash
git clone https://github.com/pouriya-sedaghat/nearby-location.git
cd nearby-location
git rev-parse HEAD
./deploy/vm/vm.sh init
./deploy/vm/vm.sh build
./deploy/vm/vm.sh up
./deploy/vm/vm.sh status
./deploy/vm/vm.sh smoke
```

Evaluate a selected reviewed commit rather than assuming the current branch is accepted. `init` creates `.env.vm` with mode 600 and preserves an existing file. Keep it for subsequent starts. The profile binds the API to `127.0.0.1:${VM_HTTP_PORT:-8081}`; PostGIS has no host port.

The profile starts migrations through the entrypoint. Smoke checks require location/metrics bearer auth, privacy deletion (normalized and exact routes), and signed cursors, all enabled by this profile. They publish temporary synthetic users, check responses, and erase fixtures afterward. Do not point this runner at live user data.

For browser access from your workstation, forward the loopback port through SSH:

```bash
ssh -L 8081:127.0.0.1:8081 your-user@your-vm
```

Swagger is disabled by default. If needed for evaluation, add explicit Swagger switches and dedicated credentials to `.env.vm`, then rerun `up` so Compose recreates the affected container. Interactive execution must be enabled separately. Read [API docs authentication](API.md#swagger-and-openapi).

## Seed and measure

```bash
./deploy/vm/vm.sh seed
./deploy/vm/vm.sh explain cursor_first
./deploy/vm/vm.sh explain cursor_next
./deploy/vm/vm.sh benchmark cursor_first 1,5,20 15
./deploy/vm/vm.sh benchmark cursor_next 1,5,20 15
./deploy/vm/vm.sh benchmark offset_first 1,5,20 15
./deploy/vm/vm.sh benchmark offset_deep 1,5,20 15
```

Seed inserts/updates 10,000 users with prefix `vm_bench_`, a 10 km synthetic radius, and one-day freshness; it does not truncate the table. Repeated seed refreshes those IDs. Query-plan checks run at 1 km and 10 km.

Benchmark arguments are request mode, concurrency CSV, and duration seconds. The wrapper limits concurrency to 2,000 and duration to 3,600 seconds. Each measurement has a two-second warmup and an error-rate budget of zero. A budget failure returns a nonzero status; inspect the output rather than treating completion as success.

For simultaneous resource observation, run this in another shell while a benchmark is active:

```bash
./deploy/vm/vm.sh resources 60
```

Measurements describe this VM, this profile, the stated synthetic distribution, and the selected image. Keep accepted RPS, p95/p99, errors, controlled rejections, CPU, memory, query plans, and database sizing together. Compare production-shaped workloads separately; [testing](TESTING.md#record-evidence) defines an evidence record.

## Persistence and recovery check

```bash
./deploy/vm/vm.sh status
./deploy/vm/vm.sh restart
./deploy/vm/vm.sh smoke
./deploy/vm/vm.sh status
```

Confirm the synthetic dataset persists and the API becomes ready after restart. This tests local persistence/restart; it does not prove database failover or backup restoration. Rehearse those using the [backup/restore runbook](runbooks/BACKUP_RESTORE.md).

## Collect and stop

```bash
./deploy/vm/vm.sh collect
./deploy/vm/vm.sh down
```

Reports are written under `vm-reports/`. Collection records revision/working tree, runtime identity, host/container diagnostics, aggregate DB/retention data, metrics, and recent logs, then creates a support archive. The redactor removes known credentials from `.env.vm`; review the bundle before sharing because redaction does not prove arbitrary private data is absent. `down` preserves the named database volume.

## Troubleshooting

| Symptom | Check |
|---|---|
| `.env.vm` missing | Run `init`; do not replace an existing credential file casually |
| Compose does not support `--wait` | Install a compatible Compose plugin |
| API unhealthy | Inspect `docker compose --env-file .env.vm -f deploy/vm/compose.yaml logs --tail 100 nearby` and database readiness |
| DB auth fails after password edit | Existing volume retains the original Postgres password; coordinate credential rotation with the database |
| Host cannot reach API | Use the loopback port or SSH forward; it is deliberately not a public binding |
| Changing `.env.vm` has no effect | Read `compose.yaml`: hardcoded values are not overridden; recreate containers after supported env changes |
| Benchmark/EXPLAIN budget fails | Inspect the measured dataset, mode, radius, concurrency, and resource evidence |

Source: [VM wrapper](../deploy/vm/vm.sh), [profile](../deploy/vm/compose.yaml), [smoke runner](../scripts/smoke-http.js), [resource sampler](../deploy/vm/resources.py), [redactor](../deploy/vm/redact.py).
