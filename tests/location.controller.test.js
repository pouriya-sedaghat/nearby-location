const assert = require("node:assert/strict");
const test = require("node:test");
const { createLocationController } = require("../dist/controllers/location.controller");
const { parseConfig } = require("../dist/config/env");
const config = parseConfig({ DATABASE_URL: "postgresql://test.invalid/nearby" });
const logger = { log() {}, error() {} };
const now = Date.parse("2026-10-25T12:00:00Z");
const response = () => ({
  statusCode: undefined, body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
});
const request = { query: {}, body: { coordinate: { lat: 0, lng: 0 } } };
const row = milliseconds => ({ userId: "test", coordinate: { lat: 0, lng: 0 }, distance: 0, updatedAt: new Date(milliseconds) });

test("all nearby rows share one reference clock and retain their exact update timestamp", async () => {
  let clockReads = 0;
  const data = [row(now - 60000), row(now - 3600000), row(now + 1)];
  const locations = { findNearby: async () => ({ data, totalCount: data.length }) };
  const controller = createLocationController(locations, config, logger, () => now + 60000 * clockReads++);
  const res = response();
  await controller.findNearby(request, res);
  assert.equal(res.statusCode, 200);
  assert.equal(clockReads, 1);
  assert.deepEqual(res.body.data.map(item => item.updateStatus), ["1 minute ago", "1 hour ago", "0 seconds ago"]);
  assert.deepEqual(res.body.data.map(item => item.updatedAt), data.map(item => item.updatedAt));
});

test("an invalid stored timestamp produces the generic internal error instead of misleading age text", async () => {
  const locations = { findNearby: async () => ({ data: [row(NaN)], totalCount: 1 }) };
  const controller = createLocationController(locations, config, logger, () => now);
  const res = response();
  await controller.findNearby(request, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { success: false, message: "Internal server error" });
});
