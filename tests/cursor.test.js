const assert = require("node:assert/strict");
const test = require("node:test");
const { createHmac } = require("node:crypto");

process.env.NODE_ENV = "test";

const {
  buildNearbyQueryHash,
  decodeNearbyCursor,
  encodeNearbyCursor,
  getNearbyCursorAgeStatus,
} = require("../dist/utils/cursor");

const context = {
  lat: 35.6892,
  lng: 51.389,
  maxDistance: 10000,
  excludeUserId: "self",
};

const signingSecret = "a".repeat(48);
const previousSecret = "b".repeat(48);

test("legacy nearby cursor round-trips and binds to query context", () => {
  const queryHash = buildNearbyQueryHash(context);
  const cursor = encodeNearbyCursor(123.456, "user_2", queryHash);
  const decoded = decodeNearbyCursor(cursor);

  assert.equal(decoded.version, 1);
  assert.equal(decoded.score, 123.456);
  assert.equal(decoded.userId, "user_2");
  assert.equal(decoded.queryHash, queryHash);
  assert.notEqual(
    buildNearbyQueryHash({ ...context, maxDistance: 5000 }),
    queryHash,
  );
});

test("nearby cursor rejects malformed input", () => {
  assert.throws(() => decodeNearbyCursor("not-a-valid-cursor"), /Invalid cursor/);
});

test("every cursor version rejects invalid identifiers, including signed payloads", () => {
  const queryHash = buildNearbyQueryHash(context);
  for (const userId of ["", "   ", "user\u0000id", "x".repeat(256), "user\ud800id", "\udfff"]) {
    assert.throws(() => encodeNearbyCursor(1, userId, queryHash));
    for (const version of [1, 2, 3]) {
      const encoded = Buffer.from(JSON.stringify({
        version, score: 1, userId, queryHash,
        rankedAtMs: Date.now(), rankingProfileId: "0123456789abcdef",
        totalCount: 1, issuedAtMs: Date.now(),
      })).toString("base64url");
      assert.throws(() => decodeNearbyCursor(encoded), /Invalid cursor/);
      if (version !== 3) {
        assert.throws(() => decodeNearbyCursor(encoded, { signingSecret }), /Invalid cursor/);
      }
      const signature = createHmac("sha256", signingSecret).update(encoded).digest("base64url");
      assert.throws(() => decodeNearbyCursor(`s1.${encoded}.${signature}`, { signingSecret }), /Invalid cursor/);
    }
  }
  const userId = "界".repeat(255);
  assert.equal(decodeNearbyCursor(encodeNearbyCursor(1, userId, queryHash)).userId, userId);
});

test("cursors continue across identifiers stored before control characters were rejected", () => {
  // Versions before 2.13.1 stored C0/C1 controls other than NUL. A page ending
  // on such a row must still produce a cursor instead of an HTTP 500.
  const queryHash = buildNearbyQueryHash(context);
  for (const userId of ["legacy\u0001id", "\tuser", "user\u0085id", "😀".repeat(127)]) {
    const signed = encodeNearbyCursor(1, userId, queryHash, {
      totalCount: 3, security: { signingSecret, requireSignature: true },
    });
    assert.equal(decodeNearbyCursor(signed, { signingSecret, requireSignature: true }).userId, userId);
    assert.equal(decodeNearbyCursor(encodeNearbyCursor(1, userId, queryHash)).userId, userId);
  }
});

test("every signed cursor for a supported identifier fits the request and decoder limit", () => {
  const { MAX_CURSOR_LENGTH } = require("../dist/utils/cursor");
  const { findNearbyReqSchema } = require("../dist/schemas/request.schema");
  // Independent worst case for a signed v3 decay payload. JSON.stringify writes
  // an accepted control character such as U+0001 as "\u0001": six UTF-8 bytes
  // for one UTF-16 unit, more than any other accepted unit (BMP text is three
  // bytes, a surrogate pair four bytes for two units).
  const maxBytesPerUnit = 6;
  const longestNumber = String(-1.2345678901234567e-6); // longest finite double text
  assert.equal(longestNumber.length, 25);
  const template = JSON.stringify({
    version: 3, score: 0, userId: "", queryHash: "0".repeat(24), totalCount: 0,
    issuedAtMs: 0, rankedAtMs: 0, rankingProfileId: "0".repeat(16),
  });
  const payloadBytes = Buffer.byteLength(template) - 1 + longestNumber.length
    - 3 + 3 * String(Number.MAX_SAFE_INTEGER).length + 255 * maxBytesPerUnit;
  const signature = 43; // unpadded base64url HMAC-SHA256
  const worstCase = "s1.".length + Math.ceil(payloadBytes * 4 / 3) + 1 + signature;
  assert.ok(worstCase <= MAX_CURSOR_LENGTH, `worst case ${worstCase} exceeds ${MAX_CURSOR_LENGTH}`);
  assert.ok(MAX_CURSOR_LENGTH - worstCase < 32, "keep the accepted length tightly bounded");

  const security = { signingSecret, requireSignature: true };
  const rankingProfileId = "0123456789abcdef";
  const identifiers = [
    "legacy" + "\u0001".repeat(249), "\u0001".repeat(255), "\u001f".repeat(255),
    "\"".repeat(255), "\\".repeat(255), "\t".repeat(254) + "x", "\u0085".repeat(255),
    "界".repeat(255), "😀".repeat(127) + "x",
  ];
  let longest = 0;
  for (const userId of identifiers) {
    for (const rankingContext of [undefined, { rankedAtMs: Number.MAX_SAFE_INTEGER, rankingProfileId }]) {
      const queryHash = buildNearbyQueryHash(context, rankingContext && rankingProfileId);
      const cursor = encodeNearbyCursor(-1.2345678901234567e-6, userId, queryHash, {
        totalCount: Number.MAX_SAFE_INTEGER, issuedAtMs: Number.MAX_SAFE_INTEGER, rankingContext, security,
      });
      longest = Math.max(longest, cursor.length);
      assert.ok(cursor.length <= MAX_CURSOR_LENGTH, `${cursor.length} > ${MAX_CURSOR_LENGTH}`);
      assert.equal(decodeNearbyCursor(cursor, security).userId, userId);
      const parsed = findNearbyReqSchema.safeParse({ coordinate: { lat: 0, lng: 0 }, cursor });
      assert.equal(parsed.success, true, JSON.stringify(parsed.error?.format?.()));
    }
  }
  assert.equal(longest, worstCase, "fixtures must reach the derived worst case");
  assert.throws(() => decodeNearbyCursor("s1." + "a".repeat(MAX_CURSOR_LENGTH), security), /Invalid cursor/);
});

test("exact erasure accepts exactly the stored identifiers the cursor codec accepts", () => {
  const { exactStoredUserIdSchema } = require("../dist/schemas/request.schema");
  const { isStoredUserId } = require("../dist/utils/user-id");
  const corpus = [
    "user", "\tuser", " user ", "user\t", "legacy\u0001id", "user\u0085id", "\u0001".repeat(255),
    "界".repeat(255), "😀".repeat(127), "", " ", "\t\n", "user\u0000id", "user\ud800id", "\udfff",
    "x".repeat(255), "x".repeat(256), "😀".repeat(128),
  ];
  for (const userId of corpus) {
    const accepted = exactStoredUserIdSchema.safeParse(userId);
    assert.equal(accepted.success, isStoredUserId(userId), JSON.stringify(userId));
    if (accepted.success) assert.equal(accepted.data, userId, "exact mode must not normalize");
  }
});

test("v2 decay cursor carries a stable ranking snapshot and profile", () => {
  const rankingProfileId = "0123456789abcdef";
  const rankedAtMs = Date.UTC(2026, 9, 7, 12, 0, 0);
  const queryHash = buildNearbyQueryHash(context, rankingProfileId);
  const cursor = encodeNearbyCursor(0.8123, "user_9", queryHash, {
    rankedAtMs,
    rankingProfileId,
  });
  const decoded = decodeNearbyCursor(cursor);

  assert.equal(decoded.version, 2);
  assert.equal(decoded.score, 0.8123);
  assert.equal(decoded.userId, "user_9");
  assert.equal(decoded.queryHash, queryHash);
  assert.equal(decoded.rankedAtMs, rankedAtMs);
  assert.equal(decoded.rankingProfileId, rankingProfileId);
  assert.notEqual(buildNearbyQueryHash(context), queryHash);
});

test("v3 cursor carries totalCount and can be HMAC signed", () => {
  const queryHash = buildNearbyQueryHash(context);
  const issuedAtMs = Date.UTC(2026, 9, 7, 12, 0, 0);
  const cursor = encodeNearbyCursor(88.5, "user_7", queryHash, {
    totalCount: 421,
    issuedAtMs,
    security: { signingSecret },
  });

  assert.match(cursor, /^s1\./);
  const decoded = decodeNearbyCursor(cursor, { signingSecret });
  assert.equal(decoded.version, 3);
  assert.equal(decoded.totalCount, 421);
  assert.equal(decoded.issuedAtMs, issuedAtMs);
  assert.equal(decoded.score, 88.5);
  assert.equal(decoded.userId, "user_7");
});

test("signed cursor rejects payload or signature tampering", () => {
  const queryHash = buildNearbyQueryHash(context);
  const cursor = encodeNearbyCursor(88.5, "user_7", queryHash, {
    totalCount: 421,
    security: { signingSecret },
  });
  const [prefix, payload, signature] = cursor.split(".");
  const mutatedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;
  const mutatedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

  assert.throws(
    () => decodeNearbyCursor(`${prefix}.${mutatedPayload}.${signature}`, { signingSecret }),
    /Invalid cursor/,
  );
  assert.throws(
    () => decodeNearbyCursor(`${prefix}.${payload}.${mutatedSignature}`, { signingSecret }),
    /Invalid cursor/,
  );
});

test("previous signing secret supports zero-downtime key rotation", () => {
  const queryHash = buildNearbyQueryHash(context);
  const oldCursor = encodeNearbyCursor(77, "user_old", queryHash, {
    totalCount: 9,
    security: { signingSecret: previousSecret },
  });

  const decoded = decodeNearbyCursor(oldCursor, {
    signingSecret,
    previousSigningSecret: previousSecret,
  });
  assert.equal(decoded.version, 3);
  assert.equal(decoded.totalCount, 9);
});


test("configured signing accepts old unsigned v1 but rejects forged unsigned v3", () => {
  const queryHash = buildNearbyQueryHash(context);
  const oldV1 = encodeNearbyCursor(12, "legacy_user", queryHash);
  const unsignedV3 = encodeNearbyCursor(13, "forged_user", queryHash, {
    totalCount: 999,
    issuedAtMs: Date.UTC(2026, 9, 7, 12, 0, 0),
  });

  assert.equal(
    decodeNearbyCursor(oldV1, { signingSecret }).version,
    1,
  );
  assert.throws(
    () => decodeNearbyCursor(unsignedV3, { signingSecret }),
    /Invalid cursor/,
  );
});

test("requireSignature rejects unsigned legacy cursors", () => {
  const queryHash = buildNearbyQueryHash(context);
  const unsigned = encodeNearbyCursor(12, "user_1", queryHash);

  assert.throws(
    () => decodeNearbyCursor(unsigned, { signingSecret, requireSignature: true }),
    /Invalid cursor/,
  );
});

test("v3 decay cursor preserves total count and ranking snapshot", () => {
  const rankingProfileId = "0123456789abcdef";
  const rankedAtMs = Date.UTC(2026, 9, 7, 12, 0, 0);
  const queryHash = buildNearbyQueryHash(context, rankingProfileId);
  const issuedAtMs = rankedAtMs + 500;
  const cursor = encodeNearbyCursor(0.7, "user_10", queryHash, {
    totalCount: 50,
    issuedAtMs,
    rankingContext: { rankedAtMs, rankingProfileId },
    security: { signingSecret },
  });
  const decoded = decodeNearbyCursor(cursor, { signingSecret });

  assert.equal(decoded.version, 3);
  assert.equal(decoded.totalCount, 50);
  assert.equal(decoded.issuedAtMs, issuedAtMs);
  assert.equal(decoded.rankedAtMs, rankedAtMs);
  assert.equal(decoded.rankingProfileId, rankingProfileId);
});


test("v3 session issuance time can be preserved across page cursors", () => {
  const queryHash = buildNearbyQueryHash(context);
  const issuedAtMs = Date.UTC(2026, 9, 7, 12, 0, 0);
  const first = encodeNearbyCursor(9, "user_a", queryHash, {
    totalCount: 20,
    issuedAtMs,
    security: { signingSecret },
  });
  const firstDecoded = decodeNearbyCursor(first, { signingSecret });
  assert.equal(firstDecoded.version, 3);

  const second = encodeNearbyCursor(8, "user_b", queryHash, {
    totalCount: firstDecoded.totalCount,
    issuedAtMs: firstDecoded.issuedAtMs,
    security: { signingSecret },
  });
  const secondDecoded = decodeNearbyCursor(second, { signingSecret });
  assert.equal(secondDecoded.version, 3);
  assert.equal(secondDecoded.issuedAtMs, issuedAtMs);
});

test("cursor age validation distinguishes valid, expired and future timestamps", () => {
  const now = Date.UTC(2026, 9, 7, 12, 0, 0);
  assert.equal(getNearbyCursorAgeStatus(now - 30 * 60_000, 60, now), "valid");
  assert.equal(getNearbyCursorAgeStatus(now - 61 * 60_000, 60, now), "expired");
  assert.equal(getNearbyCursorAgeStatus(now + 6 * 60_000, 60, now), "future");
});
