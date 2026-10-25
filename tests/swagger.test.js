const assert = require("node:assert/strict");
const test = require("node:test");
const { createTestApp } = require("./fixtures/app.factory");
const { app, locations: Location, database: db, config } = createTestApp({
  NODE_ENV: "production", SWAGGER_ENABLED: "true", SWAGGER_AUTH_USERNAME: "swagger_test",
  SWAGGER_AUTH_PASSWORD: "swagger-test-only-password-012345678901",
  DEFAULT_MAX_DISTANCE_METERS: "1234", MAX_MAX_DISTANCE_METERS: "5678",
});
const { createOpenApiSpec } = require("../dist/config/openapi");
const { upsertReqSchema, createNearbyRequestSchema } = require("../dist/schemas/request.schema");
const findNearbyReqSchema = createNearbyRequestSchema(config);
const Ajv = require("ajv");
const spec = createOpenApiSpec(config);
const auth = { Authorization: "Basic " + Buffer.from(config.SWAGGER_AUTH_USERNAME + ":" + config.SWAGGER_AUTH_PASSWORD).toString("base64") };
const resolve = value => value?.$ref
  ? resolve(value.$ref.slice(2).split("/").reduce((parent, key) => parent[key], spec))
  : value;
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  const copy = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  if (copy.exclusiveMinimum === true) { copy.exclusiveMinimum = copy.minimum; delete copy.minimum; }
  else if (copy.exclusiveMinimum === false) delete copy.exclusiveMinimum;
  return copy;
}
const ajv = new Ajv({ strict: false, validateFormats: false });
ajv.addSchema({ $id: "contract", components: normalize(spec.components) });
function validate(schema, value) {
  const compiled = ajv.compile(schema.$ref
    ? { $ref: "contract" + schema.$ref }
    : normalize(schema));
  assert.ok(compiled(value), JSON.stringify(compiled.errors));
}
let server, url, rows, calls, unavailable;
const original = { upsert: Location.upsertLocation, nearby: Location.findNearby, ping: db.ping };
test.before(async () => {
  Location.upsertLocation = async (userId, lat, lng) => {
    calls.push("upsert");
    rows.set(userId, { userId, coordinate: { lat, lng }, distance: 0, updatedAt: new Date() });
  };
  Location.findNearby = async (_lat, _lng, _radius, skip, limit, exclude) => {
    calls.push("nearby");
    const data = [...rows.values()].filter(row => row.userId !== exclude);
    return { totalCount: data.length, data: data.slice(skip, skip + limit) };
  };
  db.ping = async () => { calls.push("ready"); if (unavailable) throw new Error("test database unavailable"); };
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  url = "http://127.0.0.1:" + server.address().port;
});
test.beforeEach(() => { rows = new Map(); calls = []; unavailable = false; });
test.after(async () => {
  Location.upsertLocation = original.upsert;
  Location.findNearby = original.nearby;
  db.ping = original.ping;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
test("every operation has a unique ID, named examples, and valid reusable responses", async () => {
  await require("@apidevtools/swagger-parser").validate(JSON.parse(JSON.stringify(spec)));
  const operations = Object.values(spec.paths).flatMap(item => Object.values(item));
  assert.deepEqual(operations.map(op => op.operationId).sort(),
    ["findNearbyUsers", "getLiveness", "getReadiness", "upsertLocation"]);
  for (const [route, item] of Object.entries(spec.paths)) {
    for (const operation of Object.values(item)) {
      assert.ok(operation.summary && operation.description);
      const language = operation.parameters.map(resolve).find(parameter => parameter.name === "Accept-Language");
      assert.equal(language.in, "header");
      assert.equal(language.schema.default, "en");
      if (operation.requestBody) {
        const media = resolve(operation.requestBody).content["application/json"];
        assert.ok(Object.keys(media.examples).length >= 3);
        for (const item of Object.values(media.examples)) {
          const value = resolve(item).value;
          validate(media.schema, value);
          const schema = route.endsWith("upsert") ? upsertReqSchema : findNearbyReqSchema;
          assert.ok(schema.safeParse(value).success);
        }
      }
      for (const response of Object.values(operation.responses)) {
        assert.deepEqual(resolve(resolve(response).headers["Content-Language"]).schema.enum, ["en", "fa"]);
        assert.equal(resolve(resolve(response).headers.Vary).example, "Accept-Language");
        const media = resolve(response).content["application/json"];
        assert.ok(Object.keys(media.examples).length);
        for (const item of Object.values(media.examples)) validate(media.schema, resolve(item).value);
      }
    }
  }
  const radius = spec.paths["/location/nearby"].post.parameters.find(p => p.name === "maxDistance").schema;
  assert.equal(radius.default, 1234);
  assert.equal(radius.maximum, 5678);
  assert.deepEqual(radius, spec.components.schemas.NearbyRequest.properties.maxDistance);
  const exclusion = spec.paths["/location/nearby"].post.parameters.find(p => p.name === "excludeUserId");
  assert.equal(exclusion.schema.example, undefined, "Optional exclusion must not prefill and hide the example user");
});
test("authenticated production UI enables Execute and useful exploration controls by default", async () => {
  const response = await fetch(url + "/api-docs/swagger-ui-init.js", { headers: auth });
  assert.equal(response.status, 200);
  const script = await response.text();
  for (const option of ["tryItOutEnabled", "deepLinking", "displayOperationId", "displayRequestDuration", "filter", "requestSnippetsEnabled"]) {
    assert.match(script, new RegExp('"' + option + '": true'), option);
  }
  assert.match(script, /"supportedSubmitMethods": \[\s*"get",\s*"post"\s*\]/);
  assert.match(script, /"persistAuthorization": false/);
  assert.match(script, /"queryConfigEnabled": false/);
});
test("documented examples execute against all four real HTTP controllers", async () => {
  for (const path of ["/health/live", "/health/ready"]) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200);
    validate(resolve(spec.paths[path].get.responses["200"]).content["application/json"].schema, await response.json());
  }
  const body = spec.components.examples.UpsertTehran.value;
  const stored = await fetch(url + "/location/upsert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(stored.status, 200);
  validate(resolve(spec.paths["/location/upsert"].post.responses["200"]).content["application/json"].schema, await stored.json());
  const nearby = await fetch(url + "/location/nearby", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec.components.examples.SearchCenterOnly.value) });
  assert.equal(nearby.status, 200);
  const result = await nearby.json();
  validate(resolve(spec.paths["/location/nearby"].post.responses["200"]).content["application/json"].schema, result);
  assert.equal(result.data[0].userId, body.userId);
  assert.deepEqual(result.data[0].coordinate, body.coordinate);
  assert.deepEqual(calls, ["ready", "upsert", "nearby"]);
});
test("readiness failure matches the documented 503 schema", async () => {
  unavailable = true;
  const response = await fetch(url + "/health/ready");
  assert.equal(response.status, 503);
  validate(resolve(spec.paths["/health/ready"].get.responses["503"]).content["application/json"].schema, await response.json());
});
test("Persian success and validation responses satisfy the same live OpenAPI contracts", async () => {
  const headers = { "Content-Type": "application/json", "Accept-Language": "fa" };
  for (const [path, input, status] of [
    ["/location/upsert", spec.components.examples.UpsertTehran.value, 200],
    ["/location/nearby", spec.components.examples.SearchCenterOnly.value, 200],
    ["/location/upsert", { userId: "", coordinate: { lat: 0, lng: 0 } }, 400],
  ]) {
    const response = await fetch(url + path, { method: "POST", headers, body: JSON.stringify(input) });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("content-language"), "fa");
    const body = await response.json();
    validate(resolve(spec.paths[path].post.responses[status]).content["application/json"].schema, body);
    assert.match(body.message ?? body.data[0].updateStatus, /[\u0600-\u06ff]/);
  }
});
test("documentation still rejects unauthenticated UI and specification requests", async () => {
  for (const path of ["/api-docs/", "/api-docs/openapi.json"]) {
    const response = await fetch(url + path);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate"), /^Basic /);
  }
});
