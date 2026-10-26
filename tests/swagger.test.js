const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");

process.env.NODE_ENV = "test";
const { config } = require("../dist/config/env");
const { setupSwagger, createOpenApiSpec } = require("../dist/config/swagger");
const docsPassword = "swagger-test-password-32-characters";
const docsAuthorization = `Basic ${Buffer.from(`docs:${docsPassword}`).toString("base64")}`;
const withDocs = async (settings, check) => {
  const saved = { ...config };
  Object.assign(config, {
    SWAGGER_ENABLED: true, SWAGGER_TRY_IT_OUT_ENABLED: true,
    SWAGGER_AUTH_USERNAME: undefined, SWAGGER_AUTH_PASSWORD: undefined,
    LOCATION_AUTH_MODE: "disabled", METRICS_AUTH_MODE: "disabled",
    PRIVACY_API_ENABLED: false, BASE_URL: "/", ...settings,
  });
  const app = express();
  setupSwagger(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try { await check(`http://127.0.0.1:${server.address().port}`); }
  finally {
    await new Promise((resolve) => server.close(resolve));
    Object.assign(config, saved);
  }
};

test("disabled Swagger does not expose its UI, JSON or assets", async () => {
  await withDocs({ SWAGGER_ENABLED: false }, async (baseUrl) => {
    for (const path of ["/api/docs/", "/api/docs/openapi.json", "/api/docs/swagger-ui-init.js"]) {
      assert.equal((await fetch(baseUrl + path)).status, 404, path);
    }
  });
});

test("live Swagger serves UI and JSON at the current origin and omits disabled routes", async () => {
  await withDocs({}, async (baseUrl) => {
    const page = await fetch(baseUrl + "/api/docs");
    assert.equal(page.status, 200);
    assert.equal(page.url, baseUrl + "/api/docs/");
    assert.match(await page.text(), /Nearby Location API/);
    const response = await fetch(baseUrl + "/api/docs/openapi.json");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const spec = await response.json();
    assert.equal(spec.servers[0].url, "/");
    assert.equal(spec.paths["/privacy/location/delete"], undefined);
    assert.equal(spec.paths["/privacy/location/delete-exact"], undefined);
    assert.deepEqual(spec.paths["/location/nearby"].post.security, []);
    assert.deepEqual(spec.paths["/metrics"].get.security, []);
  });
});

test("documentation login protects HTML, JSON and JavaScript and never embeds credentials", async () => {
  await withDocs({ SWAGGER_AUTH_USERNAME: "docs", SWAGGER_AUTH_PASSWORD: docsPassword }, async (baseUrl) => {
    for (const path of ["/api/docs/", "/api/docs/openapi.json", "/api/docs/swagger-ui-init.js", "/api/docs/swagger-ui.css"]) {
      for (const authorization of [undefined, "Basic invalid", "Bearer wrong", `Basic ${Buffer.from("docs:wrong").toString("base64")}`]) {
        const response = await fetch(baseUrl + path, { headers: authorization ? { Authorization: authorization } : {} });
        assert.equal(response.status, 401, path);
        assert.match(response.headers.get("www-authenticate"), /^Basic /);
        assert.equal((await response.text()).includes(docsPassword), false);
      }
      const response = await fetch(baseUrl + path, { headers: { Authorization: docsAuthorization } });
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await response.text()).includes(docsPassword), false);
    }
  });
});

test("Swagger execution can be disabled and credentials are not persisted or sent to a validator", async () => {
  for (const interactive of [false, true]) {
    await withDocs({ SWAGGER_TRY_IT_OUT_ENABLED: interactive }, async (baseUrl) => {
      const source = await (await fetch(baseUrl + "/api/docs/swagger-ui-init.js")).text();
      assert.match(source, /"persistAuthorization": false/);
      assert.match(source, /"validatorUrl": null/);
      assert.match(source, /"queryConfigEnabled": false/);
      assert.match(source, /"url": "\.\/openapi\.json"/);
      if (interactive) assert.match(source, /"supportedSubmitMethods": \[\s*"get",\s*"post"\s*\]/);
      else assert.match(source, /"supportedSubmitMethods": \[\]/);
    });
  }
});

test("enabled API surfaces use distinct bearer schemes and configured radius limits", async () => {
  await withDocs({ LOCATION_AUTH_MODE: "bearer", METRICS_AUTH_MODE: "bearer", PRIVACY_API_ENABLED: true, DEFAULT_MAX_DISTANCE_METERS: 2500, MAX_MAX_DISTANCE_METERS: 8000 }, async (baseUrl) => {
    const spec = await (await fetch(baseUrl + "/api/docs/openapi.json")).json();
    assert.deepEqual(spec.paths["/location/nearby"].post.security, [{ locationBearerAuth: [] }]);
    assert.deepEqual(spec.paths["/metrics"].get.security, [{ metricsBearerAuth: [] }]);
    assert.deepEqual(spec.paths["/privacy/location/delete"].post.security, [{ privacyBearerAuth: [] }]);
    assert.deepEqual(spec.paths["/privacy/location/delete-exact"].post.security, [{ privacyBearerAuth: [] }]);
    const radius = spec.paths["/location/nearby"].post.parameters.find((item) => item.name === "maxDistance").schema;
    assert.equal(radius.default, 2500);
    assert.equal(radius.maximum, 8000);
    assert.equal(spec.components.schemas.NearbyRequest.properties.maxDistance.maximum, 8000);
  });
});

test("OpenAPI construction is independent of the launch directory", () => {
  const previous = process.cwd();
  try {
    process.chdir(require("node:os").tmpdir());
    const spec = createOpenApiSpec();
    assert.ok(spec.paths["/location/nearby"].post);
    assert.ok(spec.paths["/privacy/location/delete"].post);
  } finally { process.chdir(previous); }
});

test("compiled production documentation works without the source directory", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const temp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "swagger-dist-"));
  try {
    fs.cpSync(path.resolve("dist"), path.join(temp, "dist"), { recursive: true });
    fs.copyFileSync(path.resolve("package.json"), path.join(temp, "package.json"));
    fs.cpSync(path.resolve("scripts/lib"), path.join(temp, "scripts/lib"), { recursive: true });
    fs.symlinkSync(path.resolve("node_modules"), path.join(temp, "node_modules"), "junction");
    const result = spawnSync(process.execPath, ["-e", `
      const app=require('express')();
      require('./dist/config/swagger').setupSwagger(app);
      const server=app.listen(0,'127.0.0.1',async()=>{
        try {
          const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/docs/openapi.json',{
            headers:{Authorization:'Basic '+Buffer.from('docs:'+process.env.SWAGGER_AUTH_PASSWORD).toString('base64')}
          });
          if(!response.ok) throw Error('HTTP '+response.status);
          const spec=await response.json();
          if(!spec.paths['/location/nearby']?.post) throw Error('Missing compiled contract');
          console.log(JSON.stringify({version:spec.info.version,server:spec.servers[0].url}));
        } catch(error) {console.error(error.message);process.exitCode=1;}
        finally {server.close();}
      });
    `], {
      cwd: temp, encoding: "utf8", timeout: 10000,
      env: { ...process.env, NODE_ENV: "production", DATABASE_URL: "postgresql://test.invalid/nearby", SWAGGER_ENABLED: "true", SWAGGER_AUTH_USERNAME: "docs", SWAGGER_AUTH_PASSWORD: docsPassword },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).server, "/");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
