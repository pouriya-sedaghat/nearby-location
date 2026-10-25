const assert = require("node:assert/strict");
const test = require("node:test");
const { spawn } = require("node:child_process");
const path = require("node:path");
if (process.env.SWAGGER_DOM_TESTS !== "true") {
  test("optional Swagger DOM tests (see docs/TESTING.md)", { skip: true }, () => {});
} else {
  for (const readOnly of [false, true]) {
    test("Swagger DOM: " + (readOnly ? "explicit read-only mode" : "interactive HTTP execution"), { timeout: 30000 }, async () => {
      const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, "fixtures/swagger-ui-runner.js"), ...(readOnly ? ["--readonly"] : [])], {
          env: process.env, timeout: 25000,
        });
        let output = "";
        child.stdout.on("data", data => { output += data; });
        child.stderr.on("data", data => { output += data; });
        child.on("error", reject);
        child.on("close", (code, signal) => resolve({ code, signal, output }));
      });
      assert.equal(result.code, 0, result.signal + "\n" + result.output);
    });
  }
}
