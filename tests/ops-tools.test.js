const assert = require("node:assert/strict");
const test = require("node:test");
const { withPostgresOptions, migrationTlsArgs } = require("../scripts/lib/postgres-options");
const { summarizePlan } = require("../scripts/lib/explain-summary");

test("migration and server select the same environment file and preserve exported settings", () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'nearby-env-'));
  const production = 'postgresql://localhost/production_db';
  const development = 'postgresql://localhost/development_db';
  try {
    fs.writeFileSync(path.join(temp, '.env'), `DATABASE_URL=${production}\n`);
    fs.writeFileSync(path.join(temp, '.env.production'), `DATABASE_URL=${development}\n`);
    fs.writeFileSync(path.join(temp, '.env.development'), `DATABASE_URL=${development}\n`);
    for (const [nodeEnv, exported, expected] of [[undefined, undefined, production], ['development', undefined, production], [undefined, development, development]]) {
      const env = { ...process.env, PG_SSL: 'false', SWAGGER_ENABLED: 'false' };
      delete env.NODE_ENV;
      delete env.DATABASE_URL;
      if (nodeEnv) env.NODE_ENV = nodeEnv;
      if (exported) env.DATABASE_URL = exported;
      const runtime = spawnSync(process.execPath, ['-e', `console.log(require(${JSON.stringify(path.join(root, 'dist/config/env'))}).config.DATABASE_URL)`], {cwd:temp,env,encoding:'utf8'});
      assert.equal(runtime.status, 0, runtime.stderr);
      const migration = spawnSync(process.execPath, ['-e', `
        const child=require('node:child_process');
        child.spawnSync=(_cmd,_args,options)=>{console.log(options.env.DATABASE_URL);return {status:0}};
        process.argv=['node','run-migration.js','up'];
        require(${JSON.stringify(path.join(root, 'scripts/run-migration.js'))});
      `], {cwd:temp,env,encoding:'utf8'});
      assert.equal(migration.status, 0, migration.stderr);
      assert.equal(runtime.stdout.trim(), expected);
      assert.equal(migration.stdout.trim(), expected);
    }
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test("EXPLAIN CLI emits parseable JSON without dotenv startup banners", () => {
  const { spawnSync } = require("node:child_process");
  const path = require("node:path");
  const script = `
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === 'pg') return { Pool: class {
        async query() { return { rows: [{ 'QUERY PLAN': [{ Plan: { 'Node Type': 'Seq Scan', 'Shared Hit Blocks': 10 }, 'Execution Time': 1 }] }] }; }
        async end() {}
      } };
      return originalLoad.call(this, request, parent, isMain);
    };
    require('./scripts/explain-nearby');
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."), encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", EXPLAIN_OUTPUT: "json", EXPLAIN_REQUIRE_GIST_INDEX: "false", EXPLAIN_MAX_EXECUTION_MS: "", PG_SSL: "false" },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.buffers["Shared Hit Blocks"], 10);
  assert.equal(report.executionTimeMs, 1);
});

test("operational pools honor TLS verification and bound connection acquisition", () => {
  const options = withPostgresOptions({ max: 1, connectionString: "postgresql://localhost/test" }, { PG_SSL: "true" });
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.equal(options.connectionTimeoutMillis, 5000);
  assert.equal(options.max, 1);
  assert.equal(withPostgresOptions({}, {}).ssl, undefined);
  assert.deepEqual(withPostgresOptions({}, { PG_SSL: "true", PG_SSL_REJECT_UNAUTHORIZED: "false", PG_CONN_TIMEOUT_MS: "1000" }), {
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 1000,
  });
  assert.throws(() => withPostgresOptions({}, { PG_SSL: "yes" }), /true or false/);
  assert.throws(() => withPostgresOptions({}, { PG_CONN_TIMEOUT_MS: "0" }), /PG_CONN_TIMEOUT_MS/);
});

test("TLS URL parameters cannot silently override explicit server/tool TLS settings", () => {
  const { Client } = require('pg');
  for (const query of ['sslmode=disable', 'sslmode=no-verify', 'sslmode=require', 'ssl=false', 'sslrootcert=custom.pem', 'uselibpqcompat=true']) {
    const connectionString = `postgresql://localhost/test?${query}`;
    assert.throws(() => withPostgresOptions({ connectionString }, { PG_SSL: 'true' }), /DATABASE_URL TLS parameters conflict/);
    assert.throws(() => migrationTlsArgs([], { DATABASE_URL: connectionString, PG_SSL: 'true' }), /DATABASE_URL TLS parameters conflict/);
  }
  const options = withPostgresOptions({ connectionString: 'postgresql://localhost/test?application_name=example' }, { PG_SSL: 'true' });
  assert.deepEqual(new Client(options).connectionParameters.ssl, { rejectUnauthorized: true });
  const urlOwned = withPostgresOptions({ connectionString: 'postgresql://localhost/test?sslmode=verify-full' }, { PG_SSL: 'false' });
  assert.deepEqual(new Client(urlOwned).connectionParameters.ssl, {});
});

test("cursor-first EXPLAIN runs the API query including count and coordinate projections", () => {
  const { spawnSync } = require("node:child_process");
  const path = require("node:path");
  const script = `
    const Module = require('node:module');
    const original = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === 'pg') return { Pool: class {
        on() {}
        async query(sql, values) {
          if (!sql.includes('(SELECT COUNT(*) FROM ranked)') || !sql.includes('ST_X(geom::geometry)') || values[5] !== 21)
            throw Error('EXPLAIN must use the exact API first-page query');
          return { rows: [{ 'QUERY PLAN': [{ Plan: { 'Node Type': 'Limit' }, 'Execution Time': 2 }] }] };
        }
        async end() {}
      } };
      return original.call(this, request, parent, isMain);
    };
    require('./scripts/explain-nearby');
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."), encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", EXPLAIN_OUTPUT: "json", EXPLAIN_QUERY_MODE: "cursor_first",
      EXPLAIN_INCLUDE_PLAN: "true", EXPLAIN_LIMIT: "20", EXPLAIN_REQUIRE_GIST_INDEX: "false", EXPLAIN_MAX_EXECUTION_MS: "", PG_SSL: "false" },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.queryMode, "cursor_first");
  assert.equal(report.plan["Node Type"], "Limit");
});

test("cursor-next EXPLAIN bootstraps the real keyset/count tuple and retains JIT diagnostics", () => {
  const { spawnSync } = require("node:child_process");
  const path = require("node:path");
  const script = `
    const Module = require('node:module'); const original = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === 'pg') return { Pool: class {
        on() {}
        async query(sql, values) {
          if (!sql.startsWith('EXPLAIN')) return { rows: Array.from({length:21}, (_,i)=>({
            score:1-i/100, user_id:'fixture_'+i, ranked_at:'2026-10-10T15:00:00Z', total_count:'10000'
          })) };
          if (values[3] !== 0.81 || values[4] !== 'fixture_19' || values[13] !== 10000 || sql.includes('(SELECT COUNT(*) FROM ranked)'))
            throw Error('The next page must reuse the bootstrapped keyset and count');
          return { rows: [{'QUERY PLAN': [{Plan:{'Node Type':'Sort'},JIT:{Timing:{Total:12.3}},'Execution Time':20}]}] };
        }
        async end() {}
      } };
      return original.call(this,request,parent,isMain);
    };
    require('./scripts/explain-nearby');
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."), encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", RANKING_MODE: "legacy", EXPLAIN_OUTPUT: "json", EXPLAIN_QUERY_MODE: "cursor_next",
      EXPLAIN_LIMIT: "20", EXPLAIN_REQUIRE_GIST_INDEX: "false", EXPLAIN_MAX_EXECUTION_MS: "", PG_SSL: "false" },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.queryMode, "cursor_next");
  assert.equal(report.jit.Timing.Total, 12.3);
});

test("migration CLI enables configured TLS and preserves explicit command options", () => {
  assert.deepEqual(migrationTlsArgs([], { PG_SSL: "true" }), ["--reject-unauthorized", "true"]);
  assert.deepEqual(migrationTlsArgs([], { PG_SSL: "true", PG_SSL_REJECT_UNAUTHORIZED: "false" }), ["--reject-unauthorized", "false"]);
  assert.deepEqual(migrationTlsArgs([], {}), []);
  assert.deepEqual(migrationTlsArgs(["--reject-unauthorized=false"], { PG_SSL: "true" }), []);
});

test("EXPLAIN buffers use the cumulative root without double counting child access", () => {
  const result = summarizePlan({
    "Node Type": "Limit", "Shared Hit Blocks": 10, "Temp Read Blocks": 4,
    Plans: [{ "Node Type": "Sort", "Shared Hit Blocks": 10, "Temp Read Blocks": 4,
      Plans: [{ "Node Type": "Index Scan", "Index Name": "locations_geom_gist_idx", "Shared Hit Blocks": 10 }],
    }],
  });
  assert.equal(result.buffers["Shared Hit Blocks"], 10);
  assert.equal(result.buffers["Temp Read Blocks"], 4);
  assert.deepEqual(result.indexes, ["locations_geom_gist_idx"]);
  assert.deepEqual(result.nodeTypes, ["Index Scan", "Limit", "Sort"]);
});
