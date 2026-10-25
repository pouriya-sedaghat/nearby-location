# Service incident response

[Operations](../OPERATIONS.md) · [Release recovery](../../deploy/kubernetes/release/README.md#failure-and-recovery)

## Trigger and ownership

Use for sustained failed readiness, elevated 5xx or controlled rejections, accepted-request latency regression, DB outage, cleanup backlog, or a failed rollout. Assign an incident owner and note the affected environment, UTC time range, image/configuration revisions, and recent changes.

## Triage

1. Check liveness, readiness, authenticated nearby behavior, request statuses/rejection headers, and current deployment state.
2. Inspect accepted RPS/latency, pool waiters, circuit state, admission limits, DB-operation latency, resource pressure, and recent structured events.
3. Compare with the accepted baseline and recent image/configuration/schema/network/credential changes.
4. Preserve minimal aggregate evidence and request IDs. Avoid raw location rows, request bodies, or secrets.

On Kubernetes, with the intended context/namespace selected:

```bash
kubectl -n "$KUBE_NAMESPACE" get deployments,pods,jobs
kubectl -n "$KUBE_NAMESPACE" rollout status deployment/nearby-location --timeout=30s
kubectl -n "$KUBE_NAMESPACE" logs deployment/nearby-location --tail=100
```

A wait timeout is evidence to investigate, not an instruction to repeatedly restart the service.

## Contain and recover

| Failure | Response |
|---|---|
| DB unavailable/TLS/auth failure | Check DB/platform health, routing/trust/credentials; preserve admission/backoff; engage DB owner |
| Pool or concurrency pressure | Reduce incoming workload/retry amplification; inspect plans and DB capacity before increasing pools/replicas |
| Bad image rollout | Pause promotion; restore the recorded compatible previous image; verify rollout and the SQL path |
| Config/Secret regression | Restore compatible recorded values and roll pods; image rollback alone does not restore them |
| Migration error | Stop rollout; inspect migration state and locks; use reviewed recovery compatible with both images |
| Cleanup backlog | Check cron/timezone, advisory-lock skips, errors and caps; tune cleanup with DB owner; audit retention |
| Suspected exposure or compromised token | Switch to [privacy/security incident response](LOCATION_PRIVACY_INCIDENT.md) |
| Database restore required | Follow [backup/restore](BACKUP_RESTORE.md) and keep traffic/publishing contained |

Use a recorded immutable previous image for manual image recovery:

```bash
kubectl -n "$KUBE_NAMESPACE" set image deployment/nearby-location \
  "nearby-location=$PREVIOUS_IMAGE_REF"
kubectl -n "$KUBE_NAMESPACE" rollout status deployment/nearby-location --timeout=5m
```

This restores the application image only. Do not run `migrate:down` as an automatic response; the initial down migration drops the live table and extension. Confirm schema/configuration compatibility first. Verify whether a release runner is still active before changing or clearing its lock.

## Exit criteria

Confirm readiness plus authenticated reads/writes on an approved synthetic test path, correct auth rejection, accepted throughput/latency, stable pool/circuit behavior, healthy cleanup/audit, and monitoring delivery. Check privacy completion/backlog separately if affected. Observe an agreed recovery window, preserve evidence, then record the cause, remediation, and regression/prevention work.
