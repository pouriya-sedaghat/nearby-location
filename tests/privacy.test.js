const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const { evaluatePrivacyAudit } = require("../scripts/lib/privacy-audit");

test("privacy retention audit passes within configured anomaly budgets", () => {
  assert.deepEqual(
    evaluatePrivacyAudit({
      overdueRows: 0,
      futureRows: 0,
      maxOverdueRows: 0,
      maxFutureRows: 0,
    }),
    { passed: true, failures: [] },
  );
});

test("privacy retention audit fails on overdue or future-dated rows", () => {
  const result = evaluatePrivacyAudit({
    overdueRows: 2,
    futureRows: 1,
    maxOverdueRows: 0,
    maxFutureRows: 0,
  });
  assert.equal(result.passed, false);
  assert.equal(result.failures.length, 2);
});

const calls = [];
const logs = [];
const metricCalls = [];
let draining = false;
let deleteImplementation = async () => true;

const originalLoad = Module._load;
Module._load = function mockedLoad(request, parent, isMain) {
  if (request === "../models/location.model") {
    return {
      __esModule: true,
      default: {
        deleteUserLocation: async (userId) => {
          calls.push(userId);
          return deleteImplementation(userId);
        },
      },
    };
  }
  if (request === "../schemas/request.schema") {
    return {
      deleteLocationReqSchema: {
        safeParse: (body) =>
          body && typeof body.userId === "string" && body.userId.trim()
            ? { success: true, data: { userId: body.userId.trim() } }
            : {
                success: false,
                error: { format: () => ({ userId: { _errors: ["Required"] } }) },
              },
      },
    };
  }
  if (request === "../utils/logger") {
    return {
      logger: {
        info: (message, fields) => logs.push({ level: "info", message, fields }),
        error: (message, fields) => logs.push({ level: "error", message, fields }),
      },
    };
  }
  if (request === "../utils/metrics") {
    return {
      metrics: {
        recordPrivacyDeletion: (...args) => metricCalls.push(["privacy", ...args]),
        recordDbError: () => metricCalls.push(["db_error"]),
        observeDbOperation: (...args) => metricCalls.push(["db_operation", ...args]),
      },
    };
  }
  if (request === "../utils/lifecycle") {
    return { lifecycle: { isDraining: () => draining } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const controllerPath = path.resolve(__dirname, "../dist/controllers/privacy.controller.js");
delete require.cache[controllerPath];
const { deleteUserLocation } = require(controllerPath);
Module._load = originalLoad;

const invoke = async (body) => {
  let statusCode = 200;
  let responseBody;
  let ended = false;
  const headers = new Map();
  const req = { body };
  const res = {
    locals: { requestId: "privacy-test" },
    setHeader: (name, value) => headers.set(name.toLowerCase(), String(value)),
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (value) => {
      responseBody = value;
      return res;
    },
    end: () => {
      ended = true;
      return res;
    },
  };
  await deleteUserLocation(req, res);
  return { statusCode, responseBody, ended, headers };
};

test.beforeEach(() => {
  calls.length = 0;
  logs.length = 0;
  metricCalls.length = 0;
  draining = false;
  deleteImplementation = async () => true;
});

test("privacy delete is idempotent and does not log the raw user id", async () => {
  const userId = "sensitive-user-123";
  const deleted = await invoke({ userId });
  assert.equal(deleted.statusCode, 204);
  assert.equal(deleted.ended, true);
  assert.deepEqual(calls, [userId]);
  assert.equal(JSON.stringify(logs).includes(userId), false);

  deleteImplementation = async () => false;
  const missing = await invoke({ userId });
  assert.equal(missing.statusCode, 204);
  assert.equal(missing.ended, true);
});

test("privacy delete rejects new work while the process is draining", async () => {
  draining = true;
  const result = await invoke({ userId: "user_1" });
  assert.equal(result.statusCode, 503);
  assert.equal(result.headers.get("retry-after"), "1");
  assert.equal(calls.length, 0);
});

test("privacy delete returns retryable 503 for PostgreSQL availability errors", async () => {
  for (const failure of [
    Object.assign(new Error("connection lost"), { code: "08006" }),
    Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
    new Error("timeout exceeded when trying to connect"),
  ]) {
    deleteImplementation = async () => { throw failure; };
    const result = await invoke({ userId: "user_1" });
    assert.equal(result.statusCode, 503);
    assert.equal(result.headers.get("retry-after"), "1");
  }
});

test("privacy delete rejects invalid body before touching storage", async () => {
  const result = await invoke({ userId: "" });
  assert.equal(result.statusCode, 400);
  assert.equal(calls.length, 0);
});

test("privacy metric exports only bounded outcome labels", () => {
  const metricsPath = path.resolve(__dirname, "../dist/utils/metrics.js");
  const original = Module._load;
  Module._load = function metricsMock(request, parent, isMain) {
    if (request === "../config/env") {
      return {
        config: {
          NEARBY_MAX_IN_FLIGHT: 50,
          UPSERT_MAX_IN_FLIGHT: 100,
          ADAPTIVE_NEARBY_LATENCY_TARGET_MS: 250,
          ADAPTIVE_UPSERT_LATENCY_TARGET_MS: 100,
          ADAPTIVE_ADMISSION_ENABLED: false,
          PG_POOL_MAX: 10,
        },
      };
    }
    if (request === "./db") {
      return { pool: { totalCount: 2, idleCount: 1, waitingCount: 0 } };
    }
    return original.call(this, request, parent, isMain);
  };
  delete require.cache[metricsPath];
  const { metrics } = require(metricsPath);
  Module._load = original;

  metrics.recordPrivacyDeletion("deleted");
  const output = metrics.renderPrometheus();
  assert.match(
    output,
    /nearby_privacy_location_deletions_total\{outcome="deleted"\} 1/,
  );
  assert.doesNotMatch(output, /sensitive-user-123/);
});
