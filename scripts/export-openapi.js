const fs = require("node:fs");
const path = require("node:path");
const { buildOpenApiSpec, canonicalSettings } = require("../dist/config/openapi");
const output = path.resolve(__dirname, "../docs/openapi.json");
const value = JSON.stringify(buildOpenApiSpec(canonicalSettings), null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (fs.readFileSync(output, "utf8") !== value) throw new Error("OpenAPI is stale; run npm run docs:api");
  console.log("OpenAPI contract is current");
} else fs.writeFileSync(output, value);
