const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NODE_ENV = "test";
const { createOpenApiSpec } = require("../dist/config/swagger");

test("OpenAPI parses all endpoint annotations and describes nearby coordinates in both modes", () => {
  const spec = createOpenApiSpec();
  for (const path of ["/location/upsert", "/location/nearby", "/privacy/location/delete", "/privacy/location/delete-exact"]) {
    assert.ok(spec.paths[path]?.post, `${path} must be documented`);
  }
  for (const path of ["/health/live", "/health/ready", "/metrics"]) {
    assert.ok(spec.paths[path]?.get, `${path} must be documented`);
  }
  const response = spec.paths["/location/nearby"].post.responses[200].content["application/json"].schema;
  assert.equal(response.oneOf.length, 2);
  for (const name of ["NearbyOffsetResponse", "NearbyCursorResponse"]) {
    assert.equal(spec.components.schemas[name].properties.data.items.$ref, "#/components/schemas/NearbyUser");
  }
  assert.ok(spec.components.schemas.NearbyUser.required.includes("coordinate"));
  assert.equal(spec.components.schemas.NearbyUser.properties.coordinate.$ref, "#/components/schemas/Coordinate");
  const { MAX_CURSOR_LENGTH } = require("../dist/utils/cursor");
  assert.equal(spec.components.schemas.NearbyRequest.properties.cursor.maxLength, MAX_CURSOR_LENGTH);
  const cursorParameter = spec.paths["/location/nearby"].post.parameters.find((parameter) => parameter.name === "cursor");
  assert.equal(cursorParameter.schema.maxLength, MAX_CURSOR_LENGTH);
});

test("OpenAPI documents normalized and exact erasure as distinct endpoints", () => {
  const spec = createOpenApiSpec();
  const body = (path) => spec.paths[path].post.requestBody.content["application/json"].schema;
  // The 2.13.5 path keeps its single normalized request shape; no selector field.
  const normalized = body("/privacy/location/delete");
  assert.deepEqual(normalized.required, ["userId"]);
  assert.deepEqual(Object.keys(normalized.properties), ["userId"]);
  assert.equal(normalized.properties.userId.pattern, "^[^\\u0000-\\u001f\\u007f-\\u009f]*$");
  // Exact erasure is a separate path, so releases without it answer 404.
  const exact = body("/privacy/location/delete-exact");
  assert.deepEqual(exact.required, ["userId"]);
  assert.equal(exact.additionalProperties, false);
  assert.equal(exact.properties.userId.pattern, "^[^\\u0000]*$");
  for (const path of ["/privacy/location/delete", "/privacy/location/delete-exact"]) {
    assert.deepEqual(spec.paths[path].post.security, [{ privacyBearerAuth: [] }]);
    assert.ok(spec.paths[path].post.responses[204]);
  }
});

test("the full OpenAPI contract and named request examples validate", async () => {
  const spec = createOpenApiSpec();
  await require("@apidevtools/swagger-parser").validate(structuredClone(spec));
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;
    const copy = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
    if (copy.exclusiveMinimum === true) { copy.exclusiveMinimum = copy.minimum; delete copy.minimum; }
    return copy;
  };
  const Ajv = require("ajv");
  const ajv = new Ajv({ strict: false, validateFormats: false });
  ajv.addSchema({ $id: "contract", components: normalize(spec.components) });
  const ids = [];
  for (const item of Object.values(spec.paths)) {
    for (const operation of Object.values(item)) {
      assert.ok(operation.operationId); ids.push(operation.operationId);
      const media = operation.requestBody?.content["application/json"];
      if (!media?.examples) continue;
      const validate = ajv.compile(media.schema.$ref ? { $ref: "contract" + media.schema.$ref } : normalize(media.schema));
      for (const example of Object.values(media.examples)) assert.ok(validate(example.value), JSON.stringify(validate.errors));
    }
  }
  assert.equal(new Set(ids).size, 7);
});
