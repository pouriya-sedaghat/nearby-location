const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const python = spawnSync("python3", ["--version"]).status === 0;

test("source packaging excludes local exports and includes only release paths", {
  skip: python ? false : "Requires Python 3 for the packaging script",
}, () => {
  const temp = fs.mkdtempSync(path.join(root, ".packaging-test-"));
  try {
    const write = (name, content) => {
      const file = path.join(temp, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    };
    write("scripts/package-source.py", fs.readFileSync(path.join(root, "scripts/package-source.py")));
    write("package.json", JSON.stringify({ name: "package-test", version: "1.0.0" }));
    const included = [".env.example", "README.md", "CONTRIBUTING.md", "CHANGELOG.md", "LICENSE",
      "src/app.ts", "docs/API.md", "docs/openapi.json",
      "migrations/1_init.js", "scripts/init-env.sh", "scripts/fixtures/query.sql", "tests/fixture.test.js",
      "tests/fixtures/query.sql", "tests/fixtures/browser.js"];
    const excluded = [".env", ".env.vm", ".env.production.example", "nearby-backup.dump", "local-notes.txt",
      "private-work/notes.md", "docs/nearby-backup.dump", "docs/private-work/notes.md",
      "scripts/key.pem", "migrations/backup.sql", "src/.private/local.ts", "src/node_modules/local.ts",
      "node_modules/dependency/index.js", "dist/app.js", "tests/private-work/synthetic.js"];
    for (const name of included) write(name, "synthetic release content\n");
    for (const name of excluded) write(name, "synthetic private content\n");
    if (process.platform !== "win32") {
      fs.symlinkSync(path.join(temp, "local-notes.txt"), path.join(temp, "src/linked.ts"));
      excluded.push("src/linked.ts");
    }
    const archive = path.join(temp, "source.zip");
    if (process.platform !== "win32") {
      const refused = spawnSync("python3", [path.join(temp, "scripts/package-source.py"), "--output", archive], { encoding: "utf8" });
      assert.notEqual(refused.status, 0, "A supported source symlink must fail closed");
      assert.match(refused.stderr, /symbolic links/);
      fs.unlinkSync(path.join(temp, "src/linked.ts"));
    }
    const packaged = spawnSync("python3", [path.join(temp, "scripts/package-source.py"), "--output", archive], {
      encoding: "utf8",
    });
    assert.equal(packaged.status, 0, packaged.stderr);
    const checked = spawnSync("python3", ["-c", [
      "import hashlib,json,sys,zipfile",
      "with zipfile.ZipFile(sys.argv[1]) as archive:",
      "    assert archive.testzip() is None",
      "    manifest=archive.read('nearby-location/SHA256SUMS').decode().splitlines()",
      "    assert len(manifest)==len(archive.namelist())-1",
      "    for line in manifest:",
      "        digest,name=line.split('  ',1)",
      "        assert hashlib.sha256(archive.read('nearby-location/'+name)).hexdigest()==digest",
      "    print(json.dumps(archive.namelist()))",
    ].join("\n"), archive], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
    const names = JSON.parse(checked.stdout);
    for (const name of included) assert.ok(names.includes("nearby-location/" + name), name);
    for (const name of excluded) assert.ok(!names.includes("nearby-location/" + name), name);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
