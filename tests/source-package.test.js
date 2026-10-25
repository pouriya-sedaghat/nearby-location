const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("source archives are reproducible, executable on Unix and exclude local credentials/build files", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nearby-source-"));
  try {
    const first = path.join(temp, "first.zip");
    const second = path.join(temp, "second.zip");
    for (const output of [first, second]) {
      const result = spawnSync("python3", ["scripts/package-source.py", "--output", output], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    assert.deepEqual(fs.readFileSync(first), fs.readFileSync(second));
    const result = spawnSync("python3", ["-c", `import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    for entry in archive.infolist():
        name = entry.filename
        assert not any(part in {'.git', 'node_modules', 'dist', 'vm-reports'} for part in name.split('/')), name
        assert not (name.split('/')[-1].startswith('.env') and not name.endswith('/.env.example')), name
        if name.endswith('.sh'):
            assert (entry.external_attr >> 16) & 0o111, name
            assert b'\\r' not in archive.read(entry), name
    assert 'nearby-location/docker-entrypoint.sh' in archive.namelist()
    assert 'nearby-location/package-lock.json' in archive.namelist()
`, first], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("extracted source can be packaged without Git metadata and omits local secrets", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nearby-no-git-"));
  try {
    fs.mkdirSync(path.join(temp, "scripts"));
    fs.copyFileSync("scripts/package-source.py", path.join(temp, "scripts/package-source.py"));
    fs.copyFileSync("package.json", path.join(temp, "package.json"));
    fs.writeFileSync(path.join(temp, ".env.production"), "SWAGGER_AUTH_PASSWORD=private-value");
    fs.writeFileSync(path.join(temp, ".env.example"), "SWAGGER_ENABLED=\n");
    fs.mkdirSync(path.join(temp, "node_modules"));
    fs.writeFileSync(path.join(temp, "node_modules", "private.js"), "private-dependency");
    const output = path.join(temp, "source.zip");
    const packaged = spawnSync("python3", [path.join(temp, "scripts/package-source.py"), "--output", output], { encoding: "utf8" });
    assert.equal(packaged.status, 0, packaged.stderr);
    const checked = spawnSync("python3", ["-c", `import sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    assert 'nearby-location/.env.example' in archive.namelist()
    assert not any('node_modules' in name or name.endswith('.env.production') or name.endswith('.zip') for name in archive.namelist())
`, output], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("Docker build context excludes every locally ignored credential/build path", () => {
  const patterns = (file) => fs.readFileSync(file, "utf8").split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
    .map((line) => line.replace(/\/$/, ""));
  const dockerignore = new Set(patterns(".dockerignore"));
  // Development images run `COPY . .`; anything Git treats as local-only must
  // not reach the build context either.
  for (const pattern of patterns(".gitignore")) {
    assert.ok(dockerignore.has(pattern), `.dockerignore must exclude ${pattern}`);
  }
});
