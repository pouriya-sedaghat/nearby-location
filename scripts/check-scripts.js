const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const files = fs.readdirSync(__dirname, { recursive: true })
  .filter((file) => file.endsWith(".js"))
  .sort();
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", path.join(__dirname, file)], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    failed = true;
    console.error(result.error?.message ?? result.stderr);
  }
}
if (failed) process.exitCode = 1;
else console.log(`Validated syntax for ${files.length} operational JavaScript files.`);
