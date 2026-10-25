#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.vm"
REPORTS="$ROOT_DIR/vm-reports"
COMPOSE_FILE="$ROOT_DIR/deploy/vm/compose.yaml"
cd "$ROOT_DIR"

dc() {
  # Credentials come from this profile's file, not unrelated exported values.
  env -u POSTGRES_PASSWORD -u LOCATION_AUTH_TOKEN -u METRICS_AUTH_TOKEN \
    -u PRIVACY_AUTH_TOKEN -u CURSOR_SIGNING_SECRET \
    -u SWAGGER_AUTH_USERNAME -u SWAGGER_AUTH_PASSWORD \
    docker compose --project-name nearby-evaluation --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}
require_command() { command -v "$1" >/dev/null 2>&1 || { printf 'Required command missing: %s\n' "$1" >&2; exit 1; }; }
require_env() { [[ -f "$ENV_FILE" ]] || { echo 'Run ./deploy/vm/vm.sh init first.' >&2; exit 1; }; }
capture() {
  local file="$1"; shift
  if "$@" > "$file" 2>&1; then return; else
    local status=$?
    printf '\nCommand exited with status %s.\n' "$status" >> "$file"
  fi
}

case "${1:-help}" in
  init)
    require_command openssl
    [[ ! -e "$ENV_FILE" ]] || { echo '.env.vm already exists; preserved existing credentials.'; exit 0; }
    temporary="$(mktemp "$ROOT_DIR/.env.vm.XXXXXX")"
    trap 'rm -f "$temporary"' EXIT
    printf 'VM_HTTP_PORT=8081\nPG_POOL_MAX=10\nPG_STATEMENT_TIMEOUT_MS=2000\n' > "$temporary"
    for key in POSTGRES_PASSWORD LOCATION_AUTH_TOKEN METRICS_AUTH_TOKEN PRIVACY_AUTH_TOKEN CURSOR_SIGNING_SECRET; do
      credential="$(openssl rand -hex 32)"
      printf '%s=%s\n' "$key" "$credential" >> "$temporary"
    done
    chmod 600 "$temporary"
    # Hard-link publication refuses to overwrite a file created concurrently.
    ln "$temporary" "$ENV_FILE"
    echo 'Created .env.vm with private random credentials. Keep this file for restarts.'
    ;;
  build|up|status|smoke|seed|benchmark|explain|resources|restart|collect|down)
    require_command docker
    require_env
    mkdir -p "$REPORTS"
    case "$1" in
      build) dc build --pull nearby 2>&1 | tee "$REPORTS/build.log" ;;
      up) dc up -d --wait --wait-timeout 180 2>&1 | tee "$REPORTS/start.log" ;;
      status)
        dc ps --all
        dc exec -T postgres psql -U postgres -d nearby_vm -c 'SELECT COUNT(*) AS location_rows FROM locations;'
        ;;
      smoke) dc exec -T nearby node scripts/smoke-http.js | tee "$REPORTS/smoke.json" ;;
      seed)
        dc exec -T -e BENCHMARK_SEED_COUNT=10000 -e BENCHMARK_SEED_BATCH_SIZE=5000 \
          -e BENCHMARK_SEED_USER_PREFIX=vm_bench_ -e BENCHMARK_SEED_RADIUS_METERS=10000 \
          -e BENCHMARK_SEED_FRESHNESS_DAYS=1 \
          -e BENCHMARK_SEED_TRUNCATE=false nearby node scripts/seed-benchmark.js | tee "$REPORTS/seed.json"
        ;;
      benchmark)
        mode="${2:-cursor_first}"
        levels="${3:-1,5,20}"
        seconds="${4:-15}"
        case "$mode" in cursor_first|cursor_next|offset_first|offset_deep) ;; *) echo 'Invalid benchmark mode.' >&2; exit 2 ;; esac
        [[ "$levels" =~ ^[1-9][0-9]*(,[1-9][0-9]*)*$ && "$seconds" =~ ^[1-9][0-9]{0,3}$ ]] || { echo 'Use positive integer concurrency CSV and duration.' >&2; exit 2; }
        (( seconds <= 3600 )) || { echo 'Duration must be at most 3600 seconds.' >&2; exit 2; }
        IFS=',' read -r -a concurrencies <<< "$levels"
        for concurrency in "${concurrencies[@]}"; do
          [[ ${#concurrency} -le 4 ]] && (( concurrency <= 2000 )) || { echo 'Concurrency must be at most 2000.' >&2; exit 2; }
        done
        failed=0
        for concurrency in "${concurrencies[@]}"; do
          if dc exec -T -e "BENCHMARK_CONCURRENCY=$concurrency" \
            -e "BENCHMARK_DURATION_SECONDS=$seconds" -e BENCHMARK_WARMUP_SECONDS=2 \
            -e "BENCHMARK_REQUEST_MODE=$mode" -e BENCHMARK_MAX_DISTANCE_METERS=10000 \
            -e BENCHMARK_MAX_ERROR_RATE=0 nearby node -e \
            'process.env.BENCHMARK_AUTH_TOKEN=process.env.LOCATION_AUTH_TOKEN;require("./scripts/benchmark-http")' \
            | tee "$REPORTS/benchmark-$mode-c$concurrency.json"; then :; else failed=1; fi
        done
        [[ "$failed" == 0 ]] || exit 2
        ;;
      explain)
        mode="${2:-cursor_first}"
        case "$mode" in cursor_first|cursor_next) ;; *) echo 'Invalid EXPLAIN mode.' >&2; exit 2 ;; esac
        for radius in 1000 10000; do
          dc exec -T -e EXPLAIN_OUTPUT=json -e EXPLAIN_INCLUDE_PLAN=true \
            -e "EXPLAIN_QUERY_MODE=$mode" -e "EXPLAIN_MAX_DISTANCE_METERS=$radius" \
            nearby node scripts/explain-nearby.js | tee "$REPORTS/explain-$mode-r$radius.json"
        done
        ;;
      resources)
        require_command python3
        seconds="${2:-600}"
        [[ "$seconds" =~ ^[1-9][0-9]{0,3}$ ]] && (( seconds <= 3600 )) || { echo 'Resource duration must be between 1 and 3600 seconds.' >&2; exit 2; }
        mapfile -t containers < <(dc ps -q nearby postgres)
        [[ ${#containers[@]} -eq 2 && -n "${containers[0]}" && -n "${containers[1]}" ]] || { echo 'Start both VM services before capturing resources.' >&2; exit 1; }
        python3 "$ROOT_DIR/deploy/vm/resources.py" --seconds "$seconds" "${containers[@]}" | tee "$REPORTS/resources.jsonl"
        ;;
      restart)
        dc restart nearby
        dc up -d --wait --wait-timeout 180
        ;;
      collect)
        require_command python3
        require_command tar
        stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
        directory="$REPORTS/support-$stamp"
        mkdir "$directory"
        capture "$directory/os.txt" uname -srvmo
        capture "$directory/cpu.txt" lscpu
        capture "$directory/memory.txt" free -h
        capture "$directory/disk.txt" df -h "$ROOT_DIR"
        capture "$directory/docker.txt" docker version
        capture "$directory/compose-version.txt" docker compose version
        # The wrapper may run through sudo while Git belongs to the SSH user.
        # Trust only this requested checkout for these read-only commands.
        capture "$directory/revision.txt" git -c "safe.directory=$ROOT_DIR" rev-parse HEAD
        capture "$directory/working-tree.txt" git -c "safe.directory=$ROOT_DIR" status --short
        capture "$directory/runtime.json" dc exec -T nearby node -e \
          'console.log(JSON.stringify({version:require("./package.json").version,node:process.version,rankingMode:process.env.RANKING_MODE}))'
        capture "$directory/containers.txt" dc ps --all
        capture "$directory/application.log" dc logs --no-color --timestamps --tail 1000 nearby
        capture "$directory/postgres.log" dc logs --no-color --timestamps --tail 200 postgres
        capture "$directory/database.json" dc exec -T nearby node scripts/inspect-db.js
        capture "$directory/retention.json" dc exec -T nearby node scripts/audit-privacy-retention.js
        capture "$directory/metrics.prom" dc exec -T nearby node -e \
          'fetch("http://127.0.0.1:8080/metrics",{headers:{Authorization:"Bearer "+process.env.METRICS_AUTH_TOKEN},signal:AbortSignal.timeout(10000)}).then(async r=>{if(!r.ok)throw Error("Metrics HTTP "+r.status);process.stdout.write(await r.text())}).catch(()=>{console.error("Metrics collection failed");process.exitCode=1})'
        for file in "$REPORTS"/{build.log,start.log,smoke.json,seed.json,resources.jsonl} "$REPORTS"/benchmark-*.json "$REPORTS"/explain-*.json; do
          [[ ! -f "$file" ]] || cp "$file" "$directory/$(basename "$file")"
        done
        python3 "$ROOT_DIR/deploy/vm/redact.py" "$ENV_FILE" "$directory"
        tar -czf "$directory.tar.gz" -C "$REPORTS" "$(basename "$directory")"
        echo "Support bundle: $directory.tar.gz"
        ;;
      down) dc down ;;
    esac
    ;;
  *)
    echo 'Usage: ./deploy/vm/vm.sh {init|build|up|status|smoke|seed|benchmark|explain|resources|restart|collect|down}'
    echo 'Benchmark arguments: [cursor_first|cursor_next|offset_first|offset_deep] [concurrency CSV] [seconds]'
    echo 'EXPLAIN arguments: [cursor_first|cursor_next]; resources arguments: [seconds]'
    echo 'Use an isolated test VM/database. Documentation: docs/VM_TESTING.md'
    case "${1:-help}" in help|--help|-h) ;; *) exit 2 ;; esac
    ;;
esac
