const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const YAML = require("yaml");
const { runSmoke } = require("../scripts/smoke-http");
const { encodeNearbyCursor, decodeNearbyCursor } = require("../dist/utils/cursor");

test("VM initialization creates private credentials once and aborts on random-generator failure", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vm-init-test-"));
  try {
    const helper = path.join(temp, "deploy/vm/vm.sh");
    fs.mkdirSync(path.dirname(helper), { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, "../deploy/vm/vm.sh"), helper);
    const init = (env = process.env) => spawnSync("bash", [helper, "init"], { env, encoding: "utf8" });
    assert.equal(init().status, 0);
    const file = path.join(temp, ".env.vm");
    const original = fs.readFileSync(file, "utf8");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const credentials = original.split("\n").filter((line) => /PASSWORD|TOKEN|SECRET/.test(line)).map((line) => line.split("=")[1]);
    assert.equal(credentials.length, 5);
    assert.equal(new Set(credentials).size, 5);
    assert.ok(credentials.every((value) => /^[a-f0-9]{64}$/.test(value)));
    assert.equal(init().status, 0);
    assert.ok(fs.readFileSync(file, "utf8") === original, "Existing credentials must be preserved");
    fs.unlinkSync(file);
    const bin = path.join(temp, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "openssl"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    assert.notEqual(init({ ...process.env, PATH: `${bin}:${process.env.PATH}` }).status, 0);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.readdirSync(temp).some((name) => name.startsWith(".env.vm.")), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("VM Compose profile isolates ports, credentials, data and runtime settings", () => {
  const profile = YAML.parse(fs.readFileSync(path.resolve(__dirname, "../deploy/vm/compose.yaml"), "utf8"));
  assert.equal(profile.name, "nearby-evaluation");
  assert.notEqual(profile.name, YAML.parse(fs.readFileSync("docker-compose.yaml", "utf8")).name);
  const api = profile.services.nearby;
  assert.deepEqual(api.ports, ["127.0.0.1:${VM_HTTP_PORT:-8081}:8080"]);
  assert.equal(profile.services.postgres.ports, undefined);
  assert.equal(api.environment.NODE_ENV, "production");
  assert.equal(api.environment.LOCATION_AUTH_MODE, "bearer");
  assert.equal(api.environment.METRICS_AUTH_MODE, "bearer");
  assert.equal(api.environment.CURSOR_REQUIRE_SIGNATURE, "true");
  assert.equal(api.read_only, true);
  assert.equal(api.build.target, "production");
  assert.equal(api.container_name, undefined);
  assert.equal(profile.volumes["postgres-data"]?.name, undefined);
  assert.match(api.environment.DATABASE_URL, /POSTGRES_PASSWORD:\?/);
});

test("diagnostic redaction removes known credentials, URLs and bearer values", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vm-redact-test-"));
  try {
    const env = path.join(temp, ".env.vm");
    const directory = path.join(temp, "support");
    fs.mkdirSync(directory);
    fs.writeFileSync(env, "POSTGRES_PASSWORD=fake-private-password\nLOCATION_AUTH_TOKEN=fake-private-token\n");
    const log = path.join(directory, "application.log");
    fs.writeFileSync(log, 'fake-private-password fake-private-token postgres://postgres:other-secret@postgres/db Authorization: Bearer unrelated:token\npassed=true\n');
    const result = spawnSync("python3", [path.resolve(__dirname, "../deploy/vm/redact.py"), env, directory], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const redacted = fs.readFileSync(log, "utf8");
    for (const value of ["fake-private-password", "fake-private-token", "other-secret", "unrelated:token"]) assert.equal(redacted.includes(value), false);
    assert.match(redacted, /passed=true/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("VM collection includes mode-specific benchmarks and plans and redacts their contents", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vm-collect-test-"));
  try {
    const helper = path.join(temp, "deploy/vm/vm.sh");
    fs.mkdirSync(path.dirname(helper), { recursive: true });
    for (const name of ["vm.sh", "redact.py"]) fs.copyFileSync(path.resolve(__dirname, `../deploy/vm/${name}`), path.join(path.dirname(helper), name));
    fs.writeFileSync(path.join(temp, ".env.vm"), "LOCATION_AUTH_TOKEN=fake-bundle-secret\n");
    const reports = path.join(temp, "vm-reports");
    fs.mkdirSync(reports);
    const names = ["benchmark-cursor_first-c10.json", "benchmark-cursor_next-c20.json", "explain-r10000.json", "resources.jsonl"];
    for (const name of names) fs.writeFileSync(path.join(reports, name), '{"evidence":"fake-bundle-secret"}\n');
    const bin = path.join(temp, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "docker"), "#!/bin/sh\nprintf '{}\\n'\n", { mode: 0o755 });
    const git = (args, env = process.env) => spawnSync("git", ["-C", temp, ...args], { encoding: "utf8", env });
    assert.equal(git(["init", "-q"]).status, 0);
    assert.equal(git(["-c", "user.name=VM Test", "-c", "user.email=vm@example.test", "commit", "--allow-empty", "-qm", "fixture"]).status, 0);
    const head = git(["rev-parse", "HEAD"]).stdout.trim();
    const actualGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    // Model the observed ownership failure at the CLI boundary; Git's internal
    // GIT_TEST_* controls differ between client versions and are not a public API.
    fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\nif [ "$1" != -c ] || [ "$2" != "safe.directory=$PWD" ]; then\n  echo 'fatal: detected dubious ownership' >&2\n  exit 128\nfi\nexec '${actualGit.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
    const globalConfig = path.join(temp, "global-gitconfig");
    fs.writeFileSync(globalConfig, "");
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1" };
    assert.notEqual(git(["rev-parse", "HEAD"], env).status, 0, "The ownership failure must be simulated");
    const result = spawnSync("bash", [helper, "collect"], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr);
    const archive = fs.readdirSync(reports).find((name) => name.endsWith(".tar.gz"));
    assert.ok(archive);
    const archivePath = path.join(reports, archive);
    const root = archive.slice(0, -7);
    const revision = spawnSync("tar", ["-xOzf", archivePath, `${root}/revision.txt`], { encoding: "utf8" });
    assert.equal(revision.stdout.trim(), head);
    assert.equal(spawnSync("tar", ["-xOzf", archivePath, `${root}/runtime.json`], { encoding: "utf8" }).status, 0);
    assert.equal(fs.readFileSync(globalConfig, "utf8"), "", "Collection must not change global Git trust");
    for (const name of names) {
      const content = spawnSync("tar", ["-xOzf", archivePath, `${root}/${name}`], { encoding: "utf8" });
      assert.equal(content.status, 0, content.stderr);
      assert.match(content.stdout, /REDACTED/);
      assert.equal(content.stdout.includes("fake-bundle-secret"), false);
    }
    assert.equal(spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8" }).stdout.includes(".env.vm"), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("VM resource capture emits timestamped JSONL and reports Docker failures", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vm-resources-test-"));
  try {
    const docker = path.join(temp, "docker");
    fs.writeFileSync(docker, '#!/bin/sh\nprintf \'\\033[H{"Name":"nearby-test","CPUPerc":"190%%"}\\033[K\\n\\033[J\'\n', { mode: 0o755 });
    const run = () => spawnSync("python3", [path.resolve(__dirname, "../deploy/vm/resources.py"), "--seconds", "1", "test-id"], {
      encoding: "utf8", env: { ...process.env, PATH: `${temp}:${process.env.PATH}` },
    });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const rows = result.stdout.trim().split("\n").map(JSON.parse);
    assert.ok(rows.length > 0);
    assert.equal(rows[0].Name, "nearby-test");
    assert.equal(rows[0].CPUPerc, "190%");
    assert.ok(Number.isFinite(Date.parse(rows[0].timestamp)));
    assert.equal(result.stdout.includes("\u001b"), false);
    fs.writeFileSync(docker, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    assert.notEqual(run().status, 0);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

const tokens = { location: "l".repeat(48), metrics: "m".repeat(48), privacy: "p".repeat(48) };
const fakeApi = (breakCoordinates = false) => {
  const stored = new Map();
  const signingSecret = "s".repeat(48);
  const fetchImpl = async (url, options) => {
    const route = new URL(url).pathname;
    const response = (status, body, headers = {}) => new Response(status === 204 ? null : typeof body === "string" ? body : JSON.stringify(body), { status, headers });
    if (route.startsWith("/health/")) return response(200, { status: "ready" });
    const surface = route === "/metrics" ? "metrics" : route.startsWith("/privacy/") ? "privacy" : "location";
    if (options.headers.Authorization !== `Bearer ${tokens[surface]}`) return response(401, {});
    if (route === "/metrics") return response(200, "nearby_http_requests_total 1\nnearby_pg_pool_total_connections 1\n");
    if (options.headers["Content-Encoding"]) return response(415, {});
    let body;
    try { body = JSON.parse(options.body); } catch { return response(400, {}); }
    if (route === "/location/upsert") { stored.set(body.userId, body.coordinate); return response(200, { success: true }); }
    if (route.startsWith("/privacy/")) { stored.delete(body.userId); return response(204); }
    if (body.coordinate.lat > 90 || body.excludeUserId?.includes("\u0000")) return response(400, {});
    const entries = [...stored].filter(([id]) => id !== body.excludeUserId).sort(([a], [b]) => a.localeCompare(b));
    let offset = ((body.page ?? 1) - 1) * body.pageSize;
    if (body.cursor) {
      try { offset = entries.findIndex(([id]) => id === decodeNearbyCursor(body.cursor, { signingSecret }).userId) + 1; }
      catch { return response(400, {}); }
    }
    const page = entries.slice(offset, offset + body.pageSize);
    const hasMore = offset + page.length < entries.length;
    return response(200, {
      totalCount: entries.length, hasMore,
      nextCursor: hasMore ? encodeNearbyCursor(1, page.at(-1)[0], "a".repeat(24), { totalCount: entries.length, security: { signingSecret } }) : null,
      data: page.map(([userId, coordinate]) => ({ userId, ...(breakCoordinates ? {} : { coordinate }), distance: 10, updatedAt: new Date().toISOString(), updateStatus: "just now" })),
    }, { "Cache-Control": "no-store" });
  };
  return { fetchImpl, stored };
};

test("VM smoke runner exercises its complete API flow and erases synthetic fixtures", async () => {
  const api = fakeApi();
  const report = await runSmoke({ baseUrl: "http://127.0.0.1:8080", tokens, fetchImpl: api.fetchImpl });
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.equal(api.stored.size, 0);
  assert.ok(report.checks.some((entry) => entry.name === "signed_cursor_traversal"));
  assert.ok(report.checks.some((entry) => entry.name === "exact_erasure_endpoint" && entry.passed));
  for (const token of Object.values(tokens)) assert.equal(JSON.stringify(report).includes(token), false);
});

test("a failed VM contract check still cleans fixtures and reports failure", async () => {
  const api = fakeApi(true);
  const report = await runSmoke({ baseUrl: "http://127.0.0.1:8080", tokens, fetchImpl: api.fetchImpl });
  assert.equal(report.passed, false);
  assert.equal(api.stored.size, 0);
  assert.equal(report.checks.at(-1).name, "fixture_cleanup");
  assert.equal(report.checks.at(-1).passed, true);
});
