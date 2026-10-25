# Deployment guide

[Documentation index](README.md) · [Configuration](CONFIGURATION.md) · [Production acceptance](PRODUCTION_READINESS.md)

## Select a deployment path

| Path | Intended use | Database / migration responsibility |
|---|---|---|
| Root `docker-compose.yaml` | Existing single-VM deployment | Included PostGIS; generated credentials; existing volume and entrypoint migrations |
| `deploy/compose.development.yaml` | Disposable development | Example credentials; separate project/volume; loopback HTTP |
| [VM evaluation profile](VM_TESTING.md) | Isolated functional/load/persistence evaluation | Included PostGIS; generated credentials; entrypoint migrations |
| Production container with external database | Single host or your container platform | Provision database, secrets, transport, backups; run a migration step |
| [Kubernetes manifests](../deploy/kubernetes/README.md) | Cluster deployment after adaptation | External database; separate migration Job before API rollout |
| [Kubernetes release script](../deploy/kubernetes/release/README.md) | Upgrades of an existing stable deployment | Capacity preflight, migration, isolated canary, promotion, image rollback |

This guide supplies the deployment procedure. Workload limits, failover, backups, privacy, and rollback need acceptance in the target environment. The root Compose and VM profiles do not provision a highly available production database or public TLS ingress.

## Prepare a release

1. Select an exact reviewed commit, inspect its CI, and record the commit SHA.
2. Build the production stage from that checkout and publish it to your registry.
3. Record the immutable image digest and use the same image for migration and API execution.
4. Prepare database, credentials, network policy, retention, monitoring, and recovery owners.
5. Rehearse migration and application rollback against a staging clone before production.

```bash
git rev-parse HEAD
NEARBY_BUILD_SHA="$(git rev-parse HEAD)"
docker build --target production -t "nearby-location:$NEARBY_BUILD_SHA" .
```

Tag/push according to your registry workflow and record the resulting `repository@sha256:<64 hex>` reference. The package reports 2.14.0. Use the recorded digest for deployment rather than reusing a mutable tag. The repository's CI builds a test image; it does not publish a production image. The release workflow accepts an existing immutable image; it does not build one.

## Database preparation

Provision PostgreSQL with PostGIS availability and a database reserved for this application. The migration identity must be allowed to create the extension, table, and indexes, or a database administrator must provision the extension appropriately. A least-privilege runtime role needs the DML/sequence permissions for upsert, search, cleanup, and erasure.

The supplied examples reuse `DATABASE_URL` for runtime and migration jobs. Separating identities requires adapting migration Job/secret wiring and applying appropriate grants after migration. Validate sequence permissions as well as table permissions. Keep administrative privileges out of routine caller workflows.

For external database TLS, use `PG_SSL=true`, `PG_SSL_REJECT_UNAUTHORIZED=true`, a trusted certificate chain, and a connection URL without TLS parameters. See [TLS conflict rules](CONFIGURATION.md#database).

Connection capacity is shared across pools. Before rollout, run `capacity:check` with expected maximum stable replicas plus surge and canary, and reserve space for terminating pods, migration/tool connections, and other clients. See [capacity calculations](OPERATIONS.md#connection-capacity).

## Production container on a host

Prepare a private environment file outside version control with the real database URL and independently generated secrets. Generate each value securely, for example with `openssl rand -hex 32`, and keep the file readable only by its deployment owner.

Required decisions/settings include:

```dotenv
NODE_ENV=production
PORT=8080
DATABASE_URL=postgresql://nearby:REPLACE_PASSWORD@db.example.internal:5432/nearby
PG_SSL=true
PG_SSL_REJECT_UNAUTHORIZED=true
RUN_MIGRATIONS_ON_STARTUP=false
LOCATION_AUTH_MODE=bearer
LOCATION_AUTH_TOKEN=REPLACE_WITH_INDEPENDENT_RANDOM_TOKEN
METRICS_AUTH_MODE=bearer
METRICS_AUTH_TOKEN=REPLACE_WITH_INDEPENDENT_RANDOM_TOKEN
CURSOR_SIGNING_SECRET=REPLACE_WITH_INDEPENDENT_RANDOM_KEY
CURSOR_REQUIRE_SIGNATURE=true
PRIVACY_API_ENABLED=false
SWAGGER_ENABLED=false
SWAGGER_TRY_IT_OUT_ENABLED=false
HTTP_TRUST_PROXY=false
```

Replace every placeholder and URL before use. Add a privacy token if enabling erasure, and tune pool/retention/admission settings from measured evidence. Set `NEARBY_ENV_FILE` to this private file and `IMAGE_REF` to the published digest, then run migrations once:

```bash
docker run --rm --env-file "$NEARBY_ENV_FILE" \
  --entrypoint node "$IMAGE_REF" scripts/run-migration.js up
```

After successful migration, start the API behind a controlled TLS gateway:

```bash
docker run -d --name nearby-location \
  --env-file "$NEARBY_ENV_FILE" \
  -p 127.0.0.1:8080:8080 \
  --restart unless-stopped --stop-timeout 20 \
  --read-only --tmpfs /tmp:rw,nosuid,noexec,size=64m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  "$IMAGE_REF"
curl --fail --retry 15 --retry-delay 2 --retry-connrefused \
  --max-time 3 --retry-max-time 60 http://127.0.0.1:8080/health/ready
```

The readiness request retries startup connection refusals and transient 503 responses within a bounded retry window. A final failure requires inspection before sending traffic. The production image runs as a non-root user and handles SIGTERM. The 20-second example host grace exceeds the default 10-second application deadline. If increasing the application deadline, increase host grace accordingly. Configure health supervision and log rotation through the host/platform. The command itself does not create a Docker health check.

For an upgrade, preserve the previous image/environment revision, run backward-compatible migrations, replace the container during a planned availability window or through your platform's rollout mechanism, and perform an authenticated search. A single container replacement has an interruption; use an orchestrated deployment when continuity requires multiple replicas.

## Prepare cluster-specific files

The base kustomization includes only ConfigMap, Deployment, Service, and PDB. It omits database provisioning, Secret, migration Job, ingress, NetworkPolicy, HPA, monitoring rules, RBAC, and privacy audit scheduling.

Prepare a private staging directory outside the checkout:

```bash
umask 077
NEARBY_DEPLOY_DIR="$(mktemp -d)"
cp deploy/kubernetes/configmap.yaml deploy/kubernetes/deployment.yaml \
  deploy/kubernetes/service.yaml deploy/kubernetes/pdb.yaml \
  deploy/kubernetes/kustomization.yaml "$NEARBY_DEPLOY_DIR/"
cp deploy/kubernetes/migration-job.example.yaml "$NEARBY_DEPLOY_DIR/migration-job.yaml"
cp deploy/kubernetes/secret.example.yaml "$NEARBY_DEPLOY_DIR/secret.yaml"
```

Edit the copies or build your managed overlay before applying:

- Replace image references in Deployment and migration Job with the same immutable registry digest. Configure registry access if needed.
- Replace all Secret placeholders with real credentials using your secret-management process. Keep `DATABASE_URL` free of TLS parameters (`sslmode`, `ssl`, `sslrootcert`, ...) while the ConfigMap's `PG_SSL=true` owns verified TLS; adding them makes the server and migration Jobs refuse to start.
- Set `LOCATION_AUTH_MODE=bearer` and supply its token, or document the equivalent authenticated private service boundary. Decide metrics auth and configure scraper credentials together.
- Keep signed cursors required and share keys across replicas. Select normalized or exact erasure according to the identifier source; this is a caller choice between routes, not a deployment mode. If the privacy workflow uses `POST /privacy/location/delete-exact`, admit that path at the gateway and follow [the exact-erasure rollout rules](OPERATIONS.md#rolling-out-exact-erasure): builds without the route return 404, which the workflow must retry rather than treat as success.
- Keep `RUN_MIGRATIONS_ON_STARTUP=false`. Verify TLS certificate trust, resources, replicas, pool capacity, retention, and process timezone.
- Configure ingress TLS and routing if external access is required. `BASE_URL` affects OpenAPI only; gateway rewriting is external.
- Adapt optional NetworkPolicy selectors to your real namespaces and labels. Its example controls ingress by pod/namespace and port, not HTTP path authorization or egress.

Inspect the rendered resources with `kubectl kustomize "$NEARBY_DEPLOY_DIR"`. This output excludes the separate Secret file; avoid publishing rendered secret material.

## First Kubernetes installation

Set `KUBE_NAMESPACE` to the target namespace. Confirm the active cluster before applying any resources:

```bash
kubectl config current-context
kubectl get namespace "$KUBE_NAMESPACE"
```

Provision the namespace through your cluster process if absent. Then apply prepared configuration and secrets, execute the migration Job, and wait for it before creating API pods:

```bash
(
  set -eu
  : "${KUBE_NAMESPACE:?Set the target namespace}"
  : "${NEARBY_DEPLOY_DIR:?Set the prepared manifest directory}"
  kubectl -n "$KUBE_NAMESPACE" apply -f "$NEARBY_DEPLOY_DIR/configmap.yaml"
  kubectl -n "$KUBE_NAMESPACE" apply -f "$NEARBY_DEPLOY_DIR/secret.yaml"

  NEARBY_MIGRATION_JOB="$(kubectl -n "$KUBE_NAMESPACE" create \
    -f "$NEARBY_DEPLOY_DIR/migration-job.yaml" -o name)"
  if ! kubectl -n "$KUBE_NAMESPACE" wait --for=condition=complete \
    "$NEARBY_MIGRATION_JOB" --timeout=10m; then
    kubectl -n "$KUBE_NAMESPACE" get "$NEARBY_MIGRATION_JOB" || true
    kubectl -n "$KUBE_NAMESPACE" logs "$NEARBY_MIGRATION_JOB" || true
    exit 1
  fi
  kubectl -n "$KUBE_NAMESPACE" logs "$NEARBY_MIGRATION_JOB"

  kubectl -n "$KUBE_NAMESPACE" apply -k "$NEARBY_DEPLOY_DIR"
  kubectl -n "$KUBE_NAMESPACE" rollout status deployment/nearby-location --timeout=5m
)
```

The subshell stops on failed configuration, Secret, Job creation, migration completion, or rollout commands. A failed migration wait exits before API resources are applied even if diagnostic commands succeed. Inspect Job/pod status and database migration state before retrying. A failed Job can still consume the full wait timeout because `kubectl wait` watches completion rather than the failed condition.

```mermaid
flowchart TD
  Prepare["Database, image, configuration, secrets"] --> Capacity{"Capacity and migration rehearsal passed?"}
  Capacity -->|no| Correct["Correct environment and rehearse"]
  Correct --> Capacity
  Capacity -->|yes| Config["Apply ConfigMap and Secret"]
  Config --> Migration["Run migration Job"]
  Migration --> Result{"Job completed?"}
  Result -->|no| Investigate["Inspect Job and DB; stop rollout"]
  Result -->|yes| API["Apply Deployment, Service, PDB"]
  API --> Verify["Probe, authenticated search, metrics, observation"]
```

Verify through a private access path:

```bash
kubectl -n "$KUBE_NAMESPACE" port-forward service/nearby-location 8080:80
```

In another terminal, check readiness and an authenticated nearby search using the [API examples](API.md). An empty search still validates the installed SQL path. Also confirm metrics, unauthorized rejection, Secret handling, pod termination, and alerts. Install reviewed optional resources after adapting them to the cluster.

## Kubernetes upgrades and rollback

Use the [release procedure](../deploy/kubernetes/release/README.md) when a stable `nearby-location` Deployment already exists. It requires the expected resource names, ConfigMap/Secret, permissions, and a published candidate digest. Configuration changes must be applied separately; the script promotes the image and does not manage a complete configuration release.

Before changing configuration, record its previous revision and compatibility with both images. Environment variables are read at startup; restart pods deliberately after updates. `kubectl rollout undo` restores a pod-template revision, not earlier external Secret/ConfigMap contents or database data.

The automated release attempts an image rollback after promotion failure. Database changes are not automatically reversed. The initial `migrate:down` is destructive and is not a routine image rollback procedure.

## Acceptance and handover

Record commit, image digest, applied configuration revision, migration outcome, capacity assumptions, workload evidence, monitoring/alert route, recovery drill, and owners. Complete [production readiness](PRODUCTION_READINESS.md), and hand over [operations](OPERATIONS.md) and the [runbooks](README.md#runbooks).

Source: [Dockerfile](../Dockerfile), [entrypoint](../docker-entrypoint.sh), [Compose profiles](../deploy/vm/compose.yaml), [Kubernetes manifests](../deploy/kubernetes), [release script](../deploy/kubernetes/release/release.sh).
