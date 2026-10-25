const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const candidate = `ghcr.io/example/nearby@sha256:${"a".repeat(64)}`;
const previous = `ghcr.io/example/nearby@sha256:${"b".repeat(64)}`;

const mockKubectl = `#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >> "$MOCK_LOG"
printf '\n' >> "$MOCK_LOG"
args=" $* "
if [[ "$args" == *" create configmap "* ]]; then [[ "\${MOCK_LOCK_HELD:-}" == "true" ]] && exit 1; exit 0; fi
if [[ "$args" == *" get configmap "* ]]; then printf '%s' "$RELEASE_ID"; exit 0; fi
if [[ "$args" == *" delete configmap "* ]]; then exit 0; fi
if [[ "$args" == *" get hpa "* ]]; then
  [[ -n "\${MOCK_HPA_MAX:-}" ]] || exit 1
  [[ "$args" == *"jsonpath="* ]] && printf '%s' "$MOCK_HPA_MAX"
  exit 0
fi
if [[ "$args" == *" get deployment nearby-location "* ]]; then
  if [[ "$args" == *"jsonpath="*"image"* ]]; then printf '%s' "$MOCK_PREVIOUS_IMAGE"; exit 0; fi
  if [[ "$args" == *"jsonpath="*"replicas"* ]]; then printf '3'; exit 0; fi
  if [[ "$args" == *"jsonpath="*"maxSurge"* ]]; then printf '%s' "\${MOCK_MAX_SURGE:-}"; exit 0; fi
  if [[ "$args" == *"jsonpath="*"strategy.type"* ]]; then printf '%s' "\${MOCK_STRATEGY:-RollingUpdate}"; exit 0; fi
  exit 0
fi
if [[ "$args" == *" create -f - -o name "* ]]; then
  body="$(cat)"
  if grep -q '__[A-Z_][A-Z_]*__' <<<"$body"; then echo 'unresolved template token' >&2; exit 8; fi
  n=0; [[ -f "$MOCK_JOB_COUNTER" ]] && n="$(cat "$MOCK_JOB_COUNTER")"
  n=$((n+1)); printf '%s' "$n" > "$MOCK_JOB_COUNTER"
  printf 'job.batch/mock-job-%s\n' "$n"
  exit 0
fi
if [[ "$args" == *" wait --for=condition=complete "* ]]; then
  if [[ -n "\${MOCK_FAIL_JOB_INDEX:-}" && "$args" == *"mock-job-\${MOCK_FAIL_JOB_INDEX}"* ]]; then exit 1; fi
  exit 0
fi
if [[ "$args" == *" logs job.batch/"* ]]; then echo '{"mock":"job-log"}'; exit 0; fi
if [[ "$args" == *" apply -f - "* ]]; then
  body="$(cat)"
  if grep -q '__[A-Z_][A-Z_]*__' <<<"$body"; then echo 'unresolved template token' >&2; exit 9; fi
  exit 0
fi
if [[ "$args" == *" apply -f "* ]]; then exit 0; fi
if [[ "$args" == *" rollout status "* ]]; then exit 0; fi
if [[ "$args" == *" annotate deployment "* ]]; then exit 0; fi
if [[ "$args" == *" set image deployment/nearby-location "* ]]; then exit 0; fi
if [[ "$args" == *" scale deployment/nearby-location-canary "* ]]; then exit 0; fi
if [[ "$args" == *" get job.batch/"* ]]; then exit 0; fi
echo "unsupported kubectl invocation: $*" >&2
exit 10
`;

const runRelease = (failJobIndex, overrides = {}) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nearby-release-test-"));
  const bin = path.join(temp, "bin");
  fs.mkdirSync(bin);
  const kubectl = path.join(bin, "kubectl");
  fs.writeFileSync(kubectl, mockKubectl, { mode: 0o755 });
  const log = path.join(temp, "kubectl.log");
  const counter = path.join(temp, "job-count");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    IMAGE_REF: candidate,
    KUBE_NAMESPACE: "nearby",
    RELEASE_ID: "release-test",
    RELEASE_OBSERVATION_SECONDS: "0",
    MOCK_LOG: log,
    MOCK_JOB_COUNTER: counter,
    MOCK_PREVIOUS_IMAGE: previous,
    ...(failJobIndex ? { MOCK_FAIL_JOB_INDEX: String(failJobIndex) } : {}),
    ...overrides,
  };
  const result = spawnSync("bash", ["deploy/kubernetes/release/release.sh"], {
    cwd: path.resolve(__dirname, ".."),
    env,
    encoding: "utf8",
  });
  return {
    ...result,
    log: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "",
    jobs: fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0,
  };
};

test("release script promotes immutable candidate after preflight, migration and canary gate", () => {
  const result = runRelease();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.jobs, 4);
  assert.match(result.log, /set image deployment\/nearby-location/);
  assert.match(result.log, new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.log, /scale deployment\/nearby-location-canary --replicas=0/);
  assert.match(result.log, /delete configmap nearby-location-release-lock/);
});

test("release script restores previous image when post-promotion smoke fails", () => {
  const result = runRelease(4);
  assert.notEqual(result.status, 0);
  assert.equal(result.jobs, 4);
  const setImageLines = result.log
    .split("\n")
    .filter((line) => line.includes("set image deployment/nearby-location"));
  assert.equal(setImageLines.length, 2, result.log);
  assert.match(setImageLines[0], /sha256:a{64}/);
  assert.match(setImageLines[1], /sha256:b{64}/);
  assert.match(result.log, /scale deployment\/nearby-location-canary --replicas=0/);
});


test("release script blocks a concurrent release lock before creating Jobs", () => {
  const result = runRelease(undefined, { MOCK_LOCK_HELD: "true" });
  assert.notEqual(result.status, 0);
  assert.equal(result.jobs, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /concurrent release blocked/);
});

test("release script rejects mutable production image references by default", () => {
  const result = runRelease(undefined, { IMAGE_REF: "ghcr.io/example/nearby:2.10.0" });
  assert.notEqual(result.status, 0);
  assert.equal(result.jobs, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /must be immutable/);
});

test("release script rejects YAML-breaking image or namespace inputs before touching a cluster", () => {
  for (const overrides of [
    { IMAGE_REF: "evil\n  injected: true@sha256:" + "a".repeat(64) },
    { KUBE_NAMESPACE: "nearby\nother" },
  ]) {
    const result = runRelease(undefined, overrides);
    assert.notEqual(result.status, 0);
    assert.equal(result.jobs, 0);
    assert.equal(result.log, "");
  }
});

test("capacity preflight includes rolling surge, rounds percentages up, and uses the HPA ceiling", () => {
  for (const [overrides, replicas] of [
    [{ MOCK_MAX_SURGE: "2" }, 6],
    [{ MOCK_MAX_SURGE: "30%" }, 5],
    [{ MOCK_MAX_SURGE: "25%", MOCK_HPA_MAX: "6" }, 9],
    [{}, 5],
    [{ MOCK_STRATEGY: "Recreate" }, 4],
  ]) {
    const result = runRelease(undefined, overrides);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`= ${replicas} replica pools`));
  }
});

test("release refuses an unrecognized surge setting before creating Jobs", () => {
  const result = runRelease(undefined, { MOCK_MAX_SURGE: "invalid" });
  assert.notEqual(result.status, 0);
  assert.equal(result.jobs, 0);
  assert.match(result.stderr, /maxSurge/);
  assert.match(result.log, /delete configmap nearby-location-release-lock/);
});
