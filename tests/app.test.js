const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { createTestApp } = require("./fixtures/app.factory");

test("separate app instances retain their own API limits, documentation and credentials", async () => {
  const first = createTestApp({ SWAGGER_ENABLED: "true", DEFAULT_MAX_DISTANCE_METERS: "500",
    SWAGGER_AUTH_USERNAME: "first", SWAGGER_AUTH_PASSWORD: "a".repeat(32) });
  const second = createTestApp({ SWAGGER_ENABLED: "true", SWAGGER_TRY_IT_OUT_ENABLED: "false",
    DEFAULT_MAX_DISTANCE_METERS: "700", SWAGGER_AUTH_USERNAME: "second", SWAGGER_AUTH_PASSWORD: "b".repeat(32) });
  const servers = [];
  try {
    for (const context of [first, second]) {
      const server = await new Promise(resolve => { const s = context.app.listen(0, "127.0.0.1", () => resolve(s)); });
      servers.push(server);
      context.url = "http://127.0.0.1:" + server.address().port;
      context.auth = { Authorization: "Basic " + Buffer.from(context.config.SWAGGER_AUTH_USERNAME + ":" + context.config.SWAGGER_AUTH_PASSWORD).toString("base64") };
    }
    for (const [context, radius, enabled] of [[first, 500, true], [second, 700, false]]) {
      let actualRadius;
      context.locations.findNearby = async (_lat, _lng, value) => { actualRadius = value; return { data: [], totalCount: 0 }; };
      const response = await fetch(context.url + "/location/nearby", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinate: { lat: 0, lng: 0 } }) });
      assert.equal(response.status, 200);
      assert.equal(actualRadius, radius);
      const specification = await (await fetch(context.url + "/api-docs/openapi.json", { headers: context.auth })).json();
      assert.equal(specification.components.schemas.NearbyRequest.properties.maxDistance.default, radius);
      const init = await (await fetch(context.url + "/api-docs/swagger-ui-init.js", { headers: context.auth })).text();
      assert.match(init, new RegExp('"tryItOutEnabled": ' + enabled));
      const other = context === first ? second : first;
      assert.equal((await fetch(context.url + "/api-docs/", { headers: other.auth })).status, 401);
    }
  } finally {
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});

test("importing application modules does not load .env or start cleanup schedules", () => {
  const root = path.resolve(__dirname, "..");
  const temp = fs.mkdtempSync(path.join(root, ".import-test-"));
  try {
    fs.writeFileSync(path.join(temp, ".env"), "PORT=invalid\nSWAGGER_AUTH_PASSWORD=invalid\n");
    const code = `const path=require('node:path'); const root=${JSON.stringify(root)};
      for(const file of ['app','runtime','config/env','config/openapi','models/location.model','jobs/cleanup.job','utils/db']) require(path.join(root,'dist',file));
      const cron=require(path.join(root,'node_modules/node-cron')); if(cron.getTasks().size) throw new Error('Unexpected scheduled task');
      console.log('Modules imported without runtime initialization');`;
    const result = spawnSync(process.execPath, ["-e", code], { cwd: temp, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /without runtime initialization/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
