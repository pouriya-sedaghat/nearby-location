const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const config = require("../dist/config/env").parseConfig({ DATABASE_URL: "postgresql://test.invalid/nearby" });
const buildOpenApiSpec = require("../dist/config/openapi").createOpenApiSpec;
const createOpenApiSpec = () => buildOpenApiSpec(config);
const root = path.resolve(__dirname, "..");
test("OpenAPI declares every baseline route and the additive coordinate response", () => {
  const spec = createOpenApiSpec();
  assert.deepEqual(Object.keys(spec.paths).sort(), ["/health/live", "/health/ready", "/location/nearby", "/location/upsert"]);
  assert.equal(spec.info.version, require("../package.json").version);
  assert.ok(spec.components.schemas.NearbyUser.required.includes("coordinate"));
  const inspect = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.$ref) {
      assert.ok(value.$ref.startsWith("#/"));
      const target = value.$ref.slice(2).split("/").reduce((parent, key) => parent?.[key], spec);
      assert.ok(target, value.$ref);
    }
    Object.values(value).forEach(inspect);
  };
  inspect(spec);
  assert.deepEqual(spec, JSON.parse(fs.readFileSync(path.join(root, "docs/openapi.json"), "utf8")));
});
test("compiled-only distribution generates the contract without route sources or cwd dependence", () => {
  const temp = fs.mkdtempSync(path.join(root, ".openapi-test-"));
  try {
    fs.cpSync(path.join(root, "dist"), path.join(temp, "dist"), { recursive: true });
    fs.copyFileSync(path.join(root, "package.json"), path.join(temp, "package.json"));
    const result = spawnSync(process.execPath, ["-e", `console.log(JSON.stringify(require(${JSON.stringify(path.join(temp, "dist/config/openapi"))}).createOpenApiSpec(${JSON.stringify(config)})))`], { cwd: __dirname, env: process.env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), createOpenApiSpec());
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test("canonical export ignores unrelated local and process runtime settings", () => {
  const temp = fs.mkdtempSync(path.join(root, ".openapi-test-"));
  try {
    fs.writeFileSync(path.join(temp, ".env"), [
      "BASE_URL=https://local.invalid",
      "SWAGGER_AUTH_USERNAME=",
      "SWAGGER_AUTH_PASSWORD=",
      "CLEANUP_CRON_SCHEDULE=invalid-local-schedule",
    ].join("\n"));
    const result = spawnSync(process.execPath, [path.join(root, "scripts/export-openapi.js"), "--check"], {
      cwd: temp,
      env: { ...process.env, BASE_URL: "https://process.invalid", DEFAULT_MAX_DISTANCE_METERS: "invalid",
        PG_CONN_TIMEOUT_MS: "invalid", SWAGGER_AUTH_PASSWORD: "short", SWAGGER_AUTH_USERNAME: "" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OpenAPI contract is current/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test("disabled Swagger stays unmounted", async () => {
  const { app } = require("./fixtures/app.factory").createTestApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${url}/api-docs/`)).status, 404);
    assert.equal((await fetch(`${url}/api-docs/openapi.json`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
