const fs = require("node:fs");
const path = require("node:path");
// Export a canonical contract without reading local or process credentials.
const spec = require("../dist/config/openapi").createOpenApiSpec({
  BASE_URL: "/",
  DEFAULT_MAX_DISTANCE_METERS: 10000,
  MAX_MAX_DISTANCE_METERS: 100000,
});
const output = JSON.stringify(spec, null, 2) + "\n";
const file = path.resolve(__dirname, "../docs/openapi.json");
if (process.argv.includes("--check")) {
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== output) {
    console.error("docs/openapi.json is stale; run npm run openapi:export");
    process.exitCode = 1;
  } else console.log("OpenAPI contract is current");
} else {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, output);
  console.log("Exported docs/openapi.json");
}
