// Optional DOM interaction check; jsdom is installed separately from the service.
const assert = require("node:assert/strict");
const { JSDOM, VirtualConsole } = require("jsdom");
const readOnly = process.argv.includes("--readonly");
const { app, database: db, locations: Location } = require("./app.factory").createTestApp({
  NODE_ENV: "development", SWAGGER_ENABLED: "true",
  SWAGGER_TRY_IT_OUT_ENABLED: readOnly ? "false" : "true",
});
const rows = new Map(), calls = [];
db.ping = async () => { calls.push("ready"); };
Location.upsertLocation = async (userId, lat, lng) => {
  calls.push("upsert");
  rows.set(userId, { userId, coordinate: { lat, lng }, distance: 0, updatedAt: new Date() });
};
Location.findNearby = async (_lat, _lng, _radius, skip, limit, exclude) => {
  calls.push("nearby");
  const data = [...rows.values()].filter(row => row.userId !== exclude);
  return { totalCount: data.length, data: data.slice(skip, skip + limit) };
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(message);
    await pause(25);
  }
}
let server, dom;
(async () => {
  try {
    server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    dom = await JSDOM.fromURL("http://127.0.0.1:" + server.address().port + "/api/docs/", {
      resources: "usable", runScripts: "dangerously", pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
      beforeParse(window) {
        for (const key of ["TextEncoder", "TextDecoder", "Request", "Response", "Headers", "Blob", "File", "AbortController", "AbortSignal"]) {
          if (global[key]) window[key] = global[key];
        }
        window.fetch = (input, options) => fetch(typeof input === "string" ? new URL(input, window.location.href) : input, options);
        window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      },
    });
    const doc = dom.window.document;
    await until(() => doc.querySelector("#operations-Location-upsertLocation"), "Swagger did not render");
    assert.equal(doc.title, "Nearby Location API " + require("../../package.json").version);
    assert.equal(doc.querySelectorAll(".opblock").length, 5);
    async function expand(id) {
      const block = doc.getElementById(id);
      block.querySelector(".opblock-summary-control").click();
      await until(() => block.querySelector(".responses-wrapper"), "Operation did not expand: " + id);
      return block;
    }
    const upsert = await expand("operations-Location-upsertLocation");
    if (readOnly) {
      assert.equal(upsert.querySelector("button.execute"), null);
      assert.equal(upsert.querySelector(".try-out__btn"), null);
      assert.ok(upsert.querySelector(".examples-select-element"));
      assert.deepEqual(calls, []);
    } else {
      const select = upsert.querySelector(".examples-select-element");
      assert.equal(select.options.length, 3);
      select.value = "zeroCoordinates";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await until(() => upsert.querySelector("textarea").value.includes("origin-user"), "Named example did not change JSON");
      select.value = "create";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await until(() => upsert.querySelector("textarea").value.includes("demo-user"), "Create example did not restore JSON");
      async function execute(block) {
        const button = block.querySelector("button.execute");
        assert.ok(button && !button.disabled, "Execute must be enabled");
        button.click();
        await until(() => block.querySelector(".live-responses-table"), "No live HTTP response");
        assert.match(block.querySelector(".live-responses-table").textContent, /200/);
        assert.match(block.querySelector(".request-snippets").textContent, /curl/);
        const duration = [...block.querySelectorAll("h5")].find(heading => heading.textContent === "Request duration");
        assert.ok(duration, "Request duration must be displayed");
        assert.match(duration.parentElement.textContent, /\d+ ms/);
      }
      await execute(upsert);
      assert.ok(rows.has("demo-user"), "Execute must reach the upsert controller");
      assert.match(dom.window.location.hash, /Location\/upsertLocation/);
      const nearby = await expand("operations-Location-findNearbyUsers");
      await execute(nearby);
      assert.match(nearby.querySelector(".live-responses-table").textContent, /demo-user/);
      const language = nearby.querySelector('tr[data-param-name="Accept-Language"] input');
      assert.ok(language, "Accept-Language must be editable in the operation");
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(language, "fa");
      language.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await execute(nearby);
      await until(() => /پیش/.test(nearby.querySelector(".live-responses-table").textContent), "Persian request did not produce localized age text");
      assert.match(nearby.querySelector(".request-snippets").textContent, /Accept-Language: fa/);
      await execute(await expand("operations-Health-getLiveness"));
      await execute(await expand("operations-Health-getReadiness"));
      assert.deepEqual(calls, ["upsert", "nearby", "nearby", "ready"]);
      const filter = doc.querySelector(".operation-filter-input");
      assert.ok(filter);
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(filter, "Health");
      filter.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await until(() => doc.querySelectorAll(".opblock").length === 2, "Tag filter did not update operations");
    }
    console.log(readOnly ? "Read-only override verified" : "Swagger Execute, examples, snippets, duration, deep links and filtering verified");
  } finally {
    dom?.window.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
