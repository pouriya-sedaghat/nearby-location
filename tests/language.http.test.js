const assert = require("node:assert/strict");
const test = require("node:test");
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";
const initialTime = Date.parse("2026-10-25T12:00:00Z");
let currentTime = initialTime, clockReads = 0, server, url, calls;
const { config } = require("../dist/config/env");
Object.assign(config, { SWAGGER_ENABLED: true, SWAGGER_AUTH_USERNAME: "language_docs",
  SWAGGER_AUTH_PASSWORD: "language-test-only-password-012345678901", PRIVACY_API_ENABLED: true,
  PRIVACY_AUTH_TOKEN: "privacy-test-only-password-012345678901" });
const locations = require("../dist/models/location.model").default;
const database = require("../dist/utils/db").default;
require("../dist/utils/lifecycle").lifecycle.markReady();
const app = require("../dist/app").createApp({ clock: () => { clockReads++; return currentTime; } });
const coordinate = { lat: 35.6892, lng: 51.389 };
const stored = { userId: "sample", coordinate, distance: 12.5, updatedAt: new Date(initialTime - 60000) };
const auth = "Basic " + Buffer.from(config.SWAGGER_AUTH_USERNAME + ":" + config.SWAGGER_AUTH_PASSWORD).toString("base64");
const post = (path, body, language, headers = {}) => fetch(url + path, {
  method: "POST", headers: { "Content-Type": "application/json", ...(language ? { "Accept-Language": language } : {}), ...headers },
  body: JSON.stringify(body),
});
test.before(async () => {
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  url = "http://127.0.0.1:" + server.address().port;
});
test.beforeEach(() => {
  currentTime = initialTime; clockReads = 0; calls = [];
  locations.upsertLocation = async (...args) => { calls.push(args); };
  locations.findNearby = async (...args) => { calls.push(args); return { totalCount: 1, data: [stored] }; };
  database.ping = async () => {};
});
test.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await database.disconnect(); });

test("Accept-Language negotiates supported regions and quality weights with an English fallback", async () => {
  for (const [header, expected] of [[undefined, "en"], ["fa", "fa"], ["fa-IR", "fa"],
    ["en-US", "en"], ["FA-ir", "fa"], ["en;q=0.3,fa;q=0.9", "fa"],
    ["fa;q=0.2,en;q=0.8", "en"], ["de,fa-IR;q=0.7,en;q=0.5", "fa"],
    ["fa;q=0,en;q=1", "en"], ["de", "en"], ["*", "en"]]) {
    const response = await post("/location/upsert", { userId: "sample", coordinate }, header);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-language"), expected, header);
    assert.match(response.headers.get("vary"), /(?:^|,\s*)Accept-Language(?:,|$)/i);
    assert.deepEqual(await response.json(), { success: true, message: expected === "fa"
      ? "موقعیت با موفقیت ذخیره شد" : "Location upserted successfully" });
  }
});

test("nearby localizes only display text and recomputes age from the stored instant on every request", async () => {
  const english = await (await post("/location/nearby", { coordinate }, "en")).json();
  const persian = await (await post("/location/nearby", { coordinate }, "fa")).json();
  assert.equal(english.data[0].updateStatus, "1 minute ago");
  assert.equal(persian.data[0].updateStatus, "۱ دقیقه پیش");
  const withoutDisplay = body => ({ ...body, data: body.data.map(({ updateStatus, ...row }) => row) });
  assert.deepEqual(withoutDisplay(english), withoutDisplay(persian));
  assert.equal(persian.data[0].updatedAt, "2026-10-25T11:59:00.000Z");
  currentTime += 60000;
  const next = await (await post("/location/nearby", { coordinate }, "fa")).json();
  assert.equal(next.data[0].updateStatus, "۲ دقیقه پیش");
  assert.equal(clockReads, 3);
  assert.equal(stored.updateStatus, undefined, "Display age must not be stored in repository rows");
});

test("one server timestamp precedes database work and is shared by every result", async () => {
  locations.findNearby = async () => {
    currentTime += 120000;
    await Promise.resolve();
    return { totalCount: 2, data: [stored, { ...stored, userId: "second" }] };
  };
  const response = await post("/location/nearby", { coordinate }, "en", { Date: "Thu, 01 Jan 1970 00:00:00 GMT" });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.data.map(row => row.updateStatus), ["1 minute ago", "1 minute ago"]);
  assert.equal(clockReads, 1, "The clock is read once before parsing and database access");
  assert.equal((await (await post("/location/nearby", { coordinate }, "en")).json()).data[0].updateStatus, "3 minutes ago");
});

test("Persian schema errors translate custom rules and missing nested objects without changing error paths", async () => {
  const response = await post("/location/upsert", { userId: "", coordinate: { lat: 91, lng: "bad" } }, "fa");
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.message, "بدنه درخواست نامعتبر است");
  assert.deepEqual(Object.keys(body.errors).sort(), ["_errors", "coordinate", "userId"]);
  for (const error of [body.errors.userId._errors[0], body.errors.coordinate.lat._errors[0], body.errors.coordinate.lng._errors[0]]) {
    assert.match(error, /[\u0600-\u06ff]/);
    assert.doesNotMatch(error, /Invalid|expected|number|string/);
  }
  const missing = await (await post("/location/upsert", { userId: "sample" }, "fa")).json();
  assert.deepEqual(missing.errors.coordinate._errors, ["این بخش از درخواست الزامی است"]);
  const invalid = await (await post("/location/nearby", { coordinate: null, maxDistance: -1, pageSize: 101 }, "fa")).json();
  assert.equal(invalid.message, "اطلاعات درخواست نامعتبر است");
  assert.deepEqual(invalid.errors.coordinate._errors, ["مقدار باید یک شیء JSON باشد"]);
  assert.match(invalid.errors.maxDistance._errors[0], /[\u0600-\u06ff]/);
  assert.match(invalid.errors.pageSize._errors[0], /[\u0600-\u06ff]/);
  assert.equal(calls.length, 0);
});

test("JSON parser failures are localized before controllers and never expose submitted content", async () => {
  for (const [body, contentType, status, message] of [
    ['{"secret":', "application/json", 400, "بدنه JSON نامعتبر است"],
    [Buffer.from([0xff]), "application/json", 400, "بدنه JSON نامعتبر است"],
    [JSON.stringify({ secret: "x".repeat(33 * 1024) }), "application/json", 413, "حجم بدنه درخواست بیش از حد مجاز است"],
    ["{}", "application/json; charset=iso-8859-1", 415, "کدگذاری بدنه درخواست پشتیبانی نمی‌شود"],
  ]) {
    const response = await fetch(url + "/location/upsert", { method: "POST",
      headers: { "Content-Type": contentType, "Accept-Language": "fa" }, body });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("content-language"), "fa");
    assert.deepEqual(await response.json(), { success: false, message });
  }
  assert.equal(calls.length, 0);
});

test("internal errors and unknown routes are translated while health status codes remain stable", async () => {
  locations.upsertLocation = async () => { throw new Error("private database credentials"); };
  const failure = await post("/location/upsert", { userId: "sample", coordinate }, "fa");
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), { success: false, message: "خطای داخلی سرور" });
  const missing = await fetch(url + "/missing", { headers: { "Accept-Language": "fa" } });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { success: false, message: "یافت نشد" });
  for (const [path, status] of [["live", "ok"], ["ready", "ready"]]) {
    const response = await fetch(url + "/health/" + path, { headers: { "Accept-Language": "fa" } });
    assert.equal(response.headers.get("content-language"), "fa");
    const health = await response.json();
    assert.equal(health.success, true); assert.equal(health.status, status);
    if (path === "ready") assert.equal(health.circuit, "closed");
  }
  database.ping = async () => { throw new Error("private"); };
  const ready = await fetch(url + "/health/ready", { headers: { "Accept-Language": "fa" } });
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), { success: false, status: "not_ready" });
});

test("concurrent English and Persian requests cannot change each other's validation or display language", async () => {
  const languages = Array.from({ length: 20 }, (_, i) => i % 2 ? "fa" : "en");
  const responses = await Promise.all(languages.map(async language => {
    const invalid = await post("/location/upsert", { userId: "" }, language);
    const invalidBody = await invalid.json();
    const nearby = await post("/location/nearby", { coordinate }, language);
    return { language, header: nearby.headers.get("content-language"), invalid: invalidBody, nearby: await nearby.json() };
  }));
  for (const result of responses) {
    assert.equal(result.header, result.language);
    assert.equal(result.nearby.data[0].updateStatus, result.language === "fa" ? "۱ دقیقه پیش" : "1 minute ago");
    assert.equal(result.invalid.message, result.language === "fa" ? "بدنه درخواست نامعتبر است" : "Invalid request body");
    assert.equal(result.invalid.errors.userId._errors[0], result.language === "fa" ? "شناسه کاربر نمی‌تواند خالی باشد" : "User id cannot be empty");
    assert.match(result.invalid.errors.coordinate._errors[0], result.language === "fa" ? /الزامی/ : /Invalid input/);
  }
});

test("documentation authentication errors follow the request language and successful documentation stays English", async () => {
  for (const path of ["/api-docs/", "/api-docs/openapi.json", "/api-docs/swagger-ui-init.js"]) {
    const denied = await fetch(url + path, { headers: { "Accept-Language": "fa" } });
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("content-language"), "fa");
    assert.deepEqual(await denied.json(), { success: false, message: "دسترسی غیرمجاز است" });
    const allowed = await fetch(url + path, { headers: { "Accept-Language": "fa", Authorization: auth } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("content-language"), "en");
    await allowed.text();
  }
});

test("UTF-8, compressed UTF-8 and malformed UTF-16 identifiers cannot alias stored identities", async () => {
  const json = '{"userId":"bad-';
  const invalidUtf8 = Buffer.concat([Buffer.from(json), Buffer.from([0xff]), Buffer.from('","coordinate":{"lat":0,"lng":0}}')]);
  const invalidUtf16 = Buffer.concat([Buffer.from(json, "utf16le"), Buffer.from([0x00, 0xd8]), Buffer.from('","coordinate":{"lat":0,"lng":0}}', "utf16le")]);
  for (const [body, extra] of [[invalidUtf8, {}], [require("node:zlib").gzipSync(invalidUtf8), { "Content-Encoding": "gzip" }],
    [invalidUtf16, { "Content-Type": "application/json; charset=utf-16le" }]]) {
    const response = await fetch(url + "/location/upsert", { method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": "fa", ...extra }, body });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { success: false, message: "بدنه JSON نامعتبر است" });
  }
  assert.equal(calls.length, 0);
});

test("authentication, cursor errors and privacy validation support Persian without weakening authorization", async () => {
  const previous = config.LOCATION_AUTH_MODE;
  config.LOCATION_AUTH_MODE = "bearer";
  config.LOCATION_AUTH_TOKEN = "test-location-token-long-enough-for-header";
  try {
    const denied = await post("/location/upsert", { userId: "sample", coordinate }, "fa");
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { success: false, message: "دسترسی غیرمجاز است" });
  } finally { config.LOCATION_AUTH_MODE = previous; }
  const cursor = await post("/location/nearby", { coordinate, cursor: "invalid" }, "fa");
  assert.equal(cursor.status, 400);
  assert.match((await cursor.json()).message, /نشانگر/);
  const privacy = await post("/privacy/location/delete-exact", { userId: "sample", match: "exact" }, "fa", {
    Authorization: "Bearer " + config.PRIVACY_AUTH_TOKEN,
  });
  assert.equal(privacy.status, 400);
  const errors = await privacy.json();
  assert.equal(errors.message, "بدنه درخواست نامعتبر است");
  assert.match(JSON.stringify(errors.errors), /[\u0600-\u06ff]/);
  assert.equal(calls.length, 0);
});
