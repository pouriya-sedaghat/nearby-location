const assert = require("node:assert/strict");
const test = require("node:test");

const {
  extractBearerToken,
  verifyBearerAuthorization,
} = require("../dist/utils/auth-core");

const primary = "p".repeat(40);
const previous = "q".repeat(40);

test("bearer parser distinguishes missing and malformed headers", () => {
  assert.deepEqual(extractBearerToken(undefined), { reason: "missing" });
  assert.deepEqual(extractBearerToken("Basic abc"), { reason: "malformed" });
  assert.deepEqual(extractBearerToken("Bearer"), { reason: "malformed" });
});

test("bearer authentication accepts primary token case-insensitively by scheme", () => {
  assert.deepEqual(verifyBearerAuthorization(`bearer ${primary}`, primary), {
    authorized: true,
    matched: "primary",
  });
});

test("bearer authentication accepts previous token during rotation", () => {
  assert.deepEqual(
    verifyBearerAuthorization(`Bearer ${previous}`, primary, previous),
    { authorized: true, matched: "previous" },
  );
});

test("bearer authentication rejects invalid tokens without echoing token data", () => {
  assert.deepEqual(
    verifyBearerAuthorization(`Bearer ${"x".repeat(40)}`, primary, previous),
    { authorized: false, reason: "invalid" },
  );
});
