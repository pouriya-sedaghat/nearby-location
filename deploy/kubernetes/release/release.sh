#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RELEASE_DIR="$ROOT_DIR/deploy/kubernetes/release"
NAMESPACE="${KUBE_NAMESPACE:-default}"
IMAGE_REF="${IMAGE_REF:-}"
LOCK_NAME="${RELEASE_LOCK_NAME:-nearby-location-release-lock}"
RELEASE_ID="${RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
ROLLOUT_TIMEOUT="${RELEASE_ROLLOUT_TIMEOUT:-5m}"
JOB_TIMEOUT="${RELEASE_JOB_TIMEOUT:-10m}"
OBSERVATION_SECONDS="${RELEASE_OBSERVATION_SECONDS:-30}"
ALLOW_MUTABLE_IMAGE="${RELEASE_ALLOW_MUTABLE_IMAGE:-false}"

CANARY_ROUNDS="${CANARY_ROUNDS:-3}"
BENCHMARK_REQUEST_MODE="${BENCHMARK_REQUEST_MODE:-cursor_first}"
BENCHMARK_DURATION_SECONDS="${BENCHMARK_DURATION_SECONDS:-10}"
BENCHMARK_WARMUP_SECONDS="${BENCHMARK_WARMUP_SECONDS:-2}"
BENCHMARK_CONCURRENCY="${BENCHMARK_CONCURRENCY:-20}"
BENCHMARK_MAX_DISTANCE_METERS="${BENCHMARK_MAX_DISTANCE_METERS:-10000}"
BENCHMARK_LAT="${BENCHMARK_LAT:-35.6892}"
BENCHMARK_LNG="${BENCHMARK_LNG:-51.389}"
BENCHMARK_PAGE_SIZE="${BENCHMARK_PAGE_SIZE:-20}"
CANARY_MAX_ERROR_RATE="${CANARY_MAX_ERROR_RATE:-0.01}"
CANARY_MAX_ERROR_RATE_DELTA="${CANARY_MAX_ERROR_RATE_DELTA:-0.005}"
CANARY_MAX_REJECTION_RATE="${CANARY_MAX_REJECTION_RATE:-0.02}"
CANARY_MAX_REJECTION_RATE_DELTA="${CANARY_MAX_REJECTION_RATE_DELTA:-0.01}"
CANARY_MAX_P95_RATIO="${CANARY_MAX_P95_RATIO:-1.25}"
CANARY_MAX_P99_RATIO="${CANARY_MAX_P99_RATIO:-1.35}"
CANARY_MIN_RPS_RATIO="${CANARY_MIN_RPS_RATIO:-0.8}"
CAPACITY_MAX_UTILIZATION_PERCENT="${CAPACITY_MAX_UTILIZATION_PERCENT:-70}"
CAPACITY_EXTERNAL_RESERVE_CONNECTIONS="${CAPACITY_EXTERNAL_RESERVE_CONNECTIONS:-20}"

LOCK_ACQUIRED=false
CANARY_APPLIED=false
PROMOTION_STARTED=false
RELEASE_SUCCEEDED=false
PREVIOUS_IMAGE=""

log() { printf '[release] %s\n' "$*"; }
fail() { printf '[release] ERROR: %s\n' "$*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"; }

is_nonnegative_integer() { [[ "$1" =~ ^[0-9]+$ ]]; }

sed_escape() {
  printf '%s' "$1" | sed -e 's/[&|]/\\&/g'
}

render_template() {
  local template="$1"
  local image expected
  image="$(sed_escape "$IMAGE_REF")"
  expected="$(sed_escape "${EXPECTED_REPLICAS:-}")"
  sed \
    -e "s|__IMAGE_REF__|$image|g" \
    -e "s|__EXPECTED_REPLICAS__|$expected|g" \
    -e "s|__CAPACITY_MAX_UTILIZATION_PERCENT__|$(sed_escape "$CAPACITY_MAX_UTILIZATION_PERCENT")|g" \
    -e "s|__CAPACITY_EXTERNAL_RESERVE_CONNECTIONS__|$(sed_escape "$CAPACITY_EXTERNAL_RESERVE_CONNECTIONS")|g" \
    -e "s|__CANARY_ROUNDS__|$(sed_escape "$CANARY_ROUNDS")|g" \
    -e "s|__BENCHMARK_REQUEST_MODE__|$(sed_escape "$BENCHMARK_REQUEST_MODE")|g" \
    -e "s|__BENCHMARK_DURATION_SECONDS__|$(sed_escape "$BENCHMARK_DURATION_SECONDS")|g" \
    -e "s|__BENCHMARK_WARMUP_SECONDS__|$(sed_escape "$BENCHMARK_WARMUP_SECONDS")|g" \
    -e "s|__BENCHMARK_CONCURRENCY__|$(sed_escape "$BENCHMARK_CONCURRENCY")|g" \
    -e "s|__BENCHMARK_MAX_DISTANCE_METERS__|$(sed_escape "$BENCHMARK_MAX_DISTANCE_METERS")|g" \
    -e "s|__BENCHMARK_LAT__|$(sed_escape "$BENCHMARK_LAT")|g" \
    -e "s|__BENCHMARK_LNG__|$(sed_escape "$BENCHMARK_LNG")|g" \
    -e "s|__BENCHMARK_PAGE_SIZE__|$(sed_escape "$BENCHMARK_PAGE_SIZE")|g" \
    -e "s|__CANARY_MAX_ERROR_RATE__|$(sed_escape "$CANARY_MAX_ERROR_RATE")|g" \
    -e "s|__CANARY_MAX_ERROR_RATE_DELTA__|$(sed_escape "$CANARY_MAX_ERROR_RATE_DELTA")|g" \
    -e "s|__CANARY_MAX_REJECTION_RATE__|$(sed_escape "$CANARY_MAX_REJECTION_RATE")|g" \
    -e "s|__CANARY_MAX_REJECTION_RATE_DELTA__|$(sed_escape "$CANARY_MAX_REJECTION_RATE_DELTA")|g" \
    -e "s|__CANARY_MAX_P95_RATIO__|$(sed_escape "$CANARY_MAX_P95_RATIO")|g" \
    -e "s|__CANARY_MAX_P99_RATIO__|$(sed_escape "$CANARY_MAX_P99_RATIO")|g" \
    -e "s|__CANARY_MIN_RPS_RATIO__|$(sed_escape "$CANARY_MIN_RPS_RATIO")|g" \
    "$template"
}

release_lock() {
  if [[ "$LOCK_ACQUIRED" != true ]]; then return; fi
  local holder
  holder="$(kubectl -n "$NAMESPACE" get configmap "$LOCK_NAME" -o jsonpath='{.data.holder}' 2>/dev/null || true)"
  if [[ "$holder" == "$RELEASE_ID" ]]; then
    kubectl -n "$NAMESPACE" delete configmap "$LOCK_NAME" --ignore-not-found >/dev/null || true
    log "release lock removed"
  else
    log "release lock ownership changed; not deleting it"
  fi
}

on_exit() {
  local status=$?
  trap - EXIT
  if [[ $status -ne 0 ]]; then
    if [[ "$PROMOTION_STARTED" == true && -n "$PREVIOUS_IMAGE" ]]; then
      log "promotion failed; restoring stable image $PREVIOUS_IMAGE"
      kubectl -n "$NAMESPACE" set image deployment/nearby-location "nearby-location=$PREVIOUS_IMAGE" >/dev/null 2>&1 || true
      kubectl -n "$NAMESPACE" rollout status deployment/nearby-location --timeout="$ROLLOUT_TIMEOUT" || true
    fi
    if [[ "$CANARY_APPLIED" == true ]]; then
      kubectl -n "$NAMESPACE" scale deployment/nearby-location-canary --replicas=0 >/dev/null 2>&1 || true
    fi
  elif [[ "$RELEASE_SUCCEEDED" == true && "$CANARY_APPLIED" == true ]]; then
    kubectl -n "$NAMESPACE" scale deployment/nearby-location-canary --replicas=0 >/dev/null 2>&1 || true
  fi
  release_lock
  exit "$status"
}
trap on_exit EXIT

run_job_from_template() {
  local template="$1"
  local label="$2"
  local rendered job_ref
  rendered="$(render_template "$template")"
  job_ref="$(printf '%s\n' "$rendered" | kubectl -n "$NAMESPACE" create -f - -o name)"
  log "$label started: $job_ref"
  if ! kubectl -n "$NAMESPACE" wait --for=condition=complete "$job_ref" --timeout="$JOB_TIMEOUT"; then
    kubectl -n "$NAMESPACE" get "$job_ref" -o wide || true
    kubectl -n "$NAMESPACE" logs "$job_ref" --all-containers=true || true
    return 1
  fi
  kubectl -n "$NAMESPACE" logs "$job_ref" --all-containers=true || true
  log "$label completed: $job_ref"
}

require_command kubectl
require_command node
[[ -n "$IMAGE_REF" ]] || fail "IMAGE_REF is required"
if [[ "$ALLOW_MUTABLE_IMAGE" != true ]] && ! [[ "$IMAGE_REF" =~ @sha256:[0-9a-fA-F]{64}$ ]]; then
  fail "IMAGE_REF must be immutable (repository@sha256:<64 hex>). Set RELEASE_ALLOW_MUTABLE_IMAGE=true only for non-production testing."
fi
[[ "$IMAGE_REF" =~ ^[A-Za-z0-9][A-Za-z0-9._:/@-]*$ ]] || fail "IMAGE_REF contains invalid characters"
[[ "$NAMESPACE" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ && ${#NAMESPACE} -le 63 ]] || fail "invalid Kubernetes namespace"
is_nonnegative_integer "$OBSERVATION_SECONDS" || fail "RELEASE_OBSERVATION_SECONDS must be a non-negative integer"

cd "$ROOT_DIR"
log "checking migration policy"
node scripts/check-migrations.js

log "acquiring Kubernetes release lock '$LOCK_NAME' in namespace '$NAMESPACE'"
if ! kubectl -n "$NAMESPACE" create configmap "$LOCK_NAME" \
  --from-literal="holder=$RELEASE_ID" \
  --from-literal="createdAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --from-literal="image=$IMAGE_REF" >/dev/null 2>&1; then
  log "another release owns the lock:"
  kubectl -n "$NAMESPACE" get configmap "$LOCK_NAME" -o yaml >&2 || true
  fail "concurrent release blocked"
fi
LOCK_ACQUIRED=true

kubectl -n "$NAMESPACE" get deployment nearby-location >/dev/null
PREVIOUS_IMAGE="$(kubectl -n "$NAMESPACE" get deployment nearby-location -o jsonpath='{.spec.template.spec.containers[?(@.name=="nearby-location")].image}')"
[[ -n "$PREVIOUS_IMAGE" ]] || fail "could not determine current stable image"

stable_replicas="$(kubectl -n "$NAMESPACE" get deployment nearby-location -o jsonpath='{.spec.replicas}')"
is_nonnegative_integer "$stable_replicas" || fail "stable replica count is not numeric: $stable_replicas"
capacity_replicas="$stable_replicas"
if kubectl -n "$NAMESPACE" get hpa nearby-location >/dev/null 2>&1; then
  hpa_max="$(kubectl -n "$NAMESPACE" get hpa nearby-location -o jsonpath='{.spec.maxReplicas}')"
  is_nonnegative_integer "$hpa_max" || fail "HPA maxReplicas is not numeric: $hpa_max"
  if (( hpa_max > capacity_replicas )); then
    capacity_replicas="$hpa_max"
  fi
fi
strategy="$(kubectl -n "$NAMESPACE" get deployment nearby-location -o jsonpath='{.spec.strategy.type}')"
surge_replicas=0
if [[ "$strategy" != "Recreate" ]]; then
  max_surge="$(kubectl -n "$NAMESPACE" get deployment nearby-location -o jsonpath='{.spec.strategy.rollingUpdate.maxSurge}')"
  max_surge="${max_surge:-25%}"
  if [[ "$max_surge" =~ ^([0-9]+)%$ ]]; then
    surge_percent="${BASH_REMATCH[1]}"
    surge_replicas=$(( (capacity_replicas * 10#$surge_percent + 99) / 100 ))
  elif is_nonnegative_integer "$max_surge"; then
    surge_replicas=$(( 10#$max_surge ))
  else
    fail "Deployment maxSurge is not an integer or percentage: $max_surge"
  fi
fi
EXPECTED_REPLICAS=$(( capacity_replicas + surge_replicas + 1 ))
export EXPECTED_REPLICAS
log "capacity preflight assumes $capacity_replicas stable replicas + $surge_replicas rollout surge + 1 canary = $EXPECTED_REPLICAS replica pools"
log "reserve additional connections for terminating pods and non-application clients"
run_job_from_template "$RELEASE_DIR/capacity-job.template.yaml" "capacity preflight"

log "running database migrations with candidate image"
run_job_from_template "$RELEASE_DIR/migration-job.template.yaml" "migration"

log "deploying isolated canary"
kubectl -n "$NAMESPACE" apply -f "$ROOT_DIR/deploy/kubernetes/canary-service.example.yaml" >/dev/null
render_template "$RELEASE_DIR/canary-deployment.template.yaml" | kubectl -n "$NAMESPACE" apply -f - >/dev/null
CANARY_APPLIED=true
kubectl -n "$NAMESPACE" rollout status deployment/nearby-location-canary --timeout="$ROLLOUT_TIMEOUT"

log "running pre-promotion stable/canary gate"
run_job_from_template "$RELEASE_DIR/canary-gate-job.template.yaml" "canary gate"

if (( OBSERVATION_SECONDS > 0 )); then
  log "observation window: ${OBSERVATION_SECONDS}s (synthetic canary remains isolated from stable Service)"
  sleep "$OBSERVATION_SECONDS"
  log "running post-observation stable/canary gate"
  run_job_from_template "$RELEASE_DIR/canary-gate-job.template.yaml" "canary observation gate"
fi

log "promoting immutable candidate image to stable deployment"
PROMOTION_STARTED=true
kubectl -n "$NAMESPACE" annotate deployment nearby-location \
  "nearby-location/release-id=$RELEASE_ID" \
  "nearby-location/previous-image=$PREVIOUS_IMAGE" \
  --overwrite >/dev/null
kubectl -n "$NAMESPACE" set image deployment/nearby-location "nearby-location=$IMAGE_REF" >/dev/null
kubectl -n "$NAMESPACE" rollout status deployment/nearby-location --timeout="$ROLLOUT_TIMEOUT"

log "running post-promotion smoke test"
run_job_from_template "$RELEASE_DIR/post-promotion-smoke-job.template.yaml" "post-promotion smoke"

kubectl -n "$NAMESPACE" annotate deployment nearby-location \
  "nearby-location/released-at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --overwrite >/dev/null
RELEASE_SUCCEEDED=true
log "release succeeded: $IMAGE_REF"
