const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const available = process.platform === "linux" && spawnSync("openssl", ["version"]).status === 0;
if (!available) {
  test("environment generator", { skip: "Requires Linux coreutils, POSIX shell and openssl" }, () => {});
} else {
  async function fixture(run) {
    const temp = fs.mkdtempSync(path.join(root, ".env-init-test-"));
    fs.mkdirSync(path.join(temp, "scripts"));
    fs.copyFileSync(path.join(root, "scripts/init-env.sh"), path.join(temp, "scripts/init-env.sh"));
    fs.copyFileSync(path.join(root, ".env.example"), path.join(temp, ".env.example"));
    try { await run(temp); }
    finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
  const generate = (project, values = {}, cwd = project) => spawnSync("sh", [path.join(project, "scripts/init-env.sh")], {
    cwd, env: { ...process.env, ...values }, encoding: "utf8",
  });
  test("initialization creates private, unique credentials without printing them", () => fixture(temp => {
    const first = generate(temp);
    assert.equal(first.status, 0, first.stderr);
    const file = path.join(temp, ".env");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const content = fs.readFileSync(file, "utf8");
    const db = content.match(/^POSTGRES_PASSWORD=([a-f0-9]{64})$/m)?.[1];
    const docs = content.match(/^SWAGGER_AUTH_PASSWORD=([a-f0-9]{48})$/m)?.[1];
    assert.ok(db && docs);
    assert.ok(!first.stdout.includes(db) && !first.stdout.includes(docs));
    assert.ok(!first.stderr.includes(db) && !first.stderr.includes(docs));
    assert.equal(new URL("postgresql://nearby:" + db + "@postgres:5432/nearby").password, db);
    fs.unlinkSync(file);
    assert.equal(generate(temp).status, 0);
    assert.ok(!fs.readFileSync(file, "utf8").includes(db));
    assert.deepEqual(fs.readdirSync(temp).filter(name => name.startsWith(".env.tmp.")), []);
  }));
  test("initialization refuses to replace existing deployment credentials", () => fixture(temp => {
    assert.equal(generate(temp).status, 0);
    const file = path.join(temp, ".env");
    const before = fs.readFileSync(file);
    const result = generate(temp);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already exists/);
    assert.deepEqual(fs.readFileSync(file), before);
  }));
  test("initialization refuses existing and dangling symbolic links and directories", () => fixture(temp => {
    const target = path.join(temp, "keep.env");
    fs.writeFileSync(target, "unchanged");
    for (const file of [target, path.join(temp, "missing.env"), path.join(temp, "scripts")]) {
      const link = path.join(temp, ".env");
      fs.symlinkSync(file, link);
      assert.notEqual(generate(temp).status, 0);
      assert.ok(fs.lstatSync(link).isSymbolicLink());
      fs.unlinkSync(link);
    }
    fs.mkdirSync(path.join(temp, ".env"));
    assert.notEqual(generate(temp).status, 0);
    assert.equal(fs.readFileSync(target, "utf8"), "unchanged");
  }));
  test("initialization writes beside the project regardless of the working directory", () => fixture(temp => {
    const cwd = path.join(temp, "scripts");
    assert.equal(generate(temp, {}, cwd).status, 0);
    assert.ok(fs.existsSync(path.join(temp, ".env")));
    assert.ok(!fs.existsSync(path.join(cwd, ".env")));
  }));
  test("initialization preserves previous VM credentials for a deliberate rename", () => fixture(temp => {
    const file = path.join(temp, ".env.vm");
    fs.writeFileSync(file, "POSTGRES_PASSWORD=keep-existing-password\n");
    const result = generate(temp);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Existing .env.vm found/);
    assert.ok(!fs.existsSync(path.join(temp, ".env")));
    assert.equal(fs.readFileSync(file, "utf8"), "POSTGRES_PASSWORD=keep-existing-password\n");
  }));
  test("failed credential generation leaves no partial environment file", () => fixture(temp => {
    const bin = path.join(temp, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "openssl"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    assert.notEqual(generate(temp, { PATH: bin + path.delimiter + process.env.PATH }).status, 0);
    assert.ok(!fs.existsSync(path.join(temp, ".env")));
    assert.deepEqual(fs.readdirSync(temp).filter(name => name.startsWith(".env.tmp.")), []);
  }));
  test("concurrent initialization publishes one complete file without replacing it", () => fixture(async temp => {
    const run = () => new Promise((resolve, reject) => {
      const child = spawn("sh", [path.join(temp, "scripts/init-env.sh")], { cwd: temp });
      let output = "";
      child.stdout.on("data", data => { output += data; });
      child.stderr.on("data", data => { output += data; });
      child.on("error", reject);
      child.on("close", status => resolve({ status, output }));
    });
    const results = await Promise.all([run(), run()]);
    assert.deepEqual(results.map(result => result.status).sort(), [0, 1]);
    const content = fs.readFileSync(path.join(temp, ".env"), "utf8");
    assert.match(content, /^POSTGRES_PASSWORD=[a-f0-9]{64}$/m);
    assert.match(content, /^SWAGGER_AUTH_PASSWORD=[a-f0-9]{48}$/m);
    assert.deepEqual(fs.readdirSync(temp).filter(name => name.startsWith(".env.tmp.")), []);
  }));
}
