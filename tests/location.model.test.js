const assert = require("node:assert/strict");
const test = require("node:test");
const { LocationRepository } = require("../dist/models/location.model");

test("repository preserves coordinate ordering and typed nearby output", async () => {
  const calls = [], updatedAt = new Date("2026-10-25T12:00:00Z");
  const repository = new LocationRepository({ query: async (query, values) => {
    calls.push({ query, values });
    return { rows: [{ user_id: "matched", lat: "-33.9", lng: "151.2", distance: "12.5", updated_at: updatedAt, total_count: "3" }] };
  } }, 9);
  await repository.upsertLocation("writer", -33.9, 151.2);
  assert.deepEqual(calls[0].values, ["writer", 151.2, -33.9]);
  const found = await repository.findNearby(-33.9, 151.2, 500, 0, 10, "writer");
  assert.deepEqual(calls[1].values, [151.2, -33.9, 500, 0, 10, 9, "writer"]);
  assert.deepEqual(found, { totalCount: 3, data: [{ userId: "matched", coordinate: { lat: -33.9, lng: 151.2 }, distance: 12.5, updatedAt }] });
});
test("empty pages retain the matching count and pass the same freshness/exclusion filters", async () => {
  const calls = [];
  const repository = new LocationRepository({ query: async (_query, values) => {
    calls.push(values);
    return calls.length === 1 ? { rows: [] } : { rows: [{ total_count: "23" }] };
  } }, 12);
  const found = await repository.findNearby(1, 2, 5000, 100, 10, "excluded");
  assert.deepEqual(found, { data: [], totalCount: 23 });
  assert.deepEqual(calls[1], [2, 1, 5000, 12, "excluded"]);
});
test("an empty first page needs no fallback count and cleanup uses the repository TTL", async () => {
  const calls = [];
  const repository = new LocationRepository({ query: async (_query, values) => {
    calls.push(values); return { rows: [], rowCount: 4 };
  } }, 11);
  assert.deepEqual(await repository.findNearby(0, 0, 50, 0, 10), { data: [], totalCount: 0 });
  assert.equal(calls.length, 1);
  assert.equal(await repository.deleteStaleLocations(100), 4);
  assert.deepEqual(calls[1], [11, 100]);
});
test("persistence errors propagate to the HTTP boundary without fabricated results", async () => {
  const failure = new Error("database unavailable");
  const repository = new LocationRepository({ query: async () => { throw failure; } }, 7);
  await assert.rejects(repository.upsertLocation("test", 0, 0), error => error === failure);
  await assert.rejects(repository.findNearby(0, 0, 50, 0, 10), error => error === failure);
  await assert.rejects(repository.deleteStaleLocations(100), error => error === failure);
});
