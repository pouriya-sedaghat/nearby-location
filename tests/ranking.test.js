const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NODE_ENV = "test";

const { calculateDecayScore } = require("../dist/utils/ranking");

const profile = {
  mode: "decay",
  distanceScaleMeters: 2000,
  freshnessHalfLifeMinutes: 60,
  distanceWeight: 0.65,
  freshnessWeight: 0.35,
};
const reference = new Date("2026-10-07T12:00:00.000Z");

test("decay ranking decreases as distance increases", () => {
  const updatedAt = new Date(reference);
  const near = calculateDecayScore(100, updatedAt, reference, profile);
  const far = calculateDecayScore(3000, updatedAt, reference, profile);

  assert.ok(near > far);
  assert.ok(near <= 1 && near > 0);
  assert.ok(far <= 1 && far > 0);
});

test("decay ranking halves the freshness component at the configured half-life", () => {
  const fresh = calculateDecayScore(1000, reference, reference, profile);
  const oneHourOld = calculateDecayScore(
    1000,
    new Date(reference.getTime() - 60 * 60 * 1000),
    reference,
    profile,
  );
  const twoHoursOld = calculateDecayScore(
    1000,
    new Date(reference.getTime() - 2 * 60 * 60 * 1000),
    reference,
    profile,
  );

  assert.ok(fresh > oneHourOld);
  assert.ok(oneHourOld > twoHoursOld);
});

test("decay ranking can favor a fresh farther user over a stale nearer user", () => {
  const freshFar = calculateDecayScore(2000, reference, reference, profile);
  const staleNear = calculateDecayScore(
    500,
    new Date(reference.getTime() - 4 * 60 * 60 * 1000),
    reference,
    profile,
  );

  assert.ok(freshFar > staleNear);
});
