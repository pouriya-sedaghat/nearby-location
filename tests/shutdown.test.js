const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");

test("shutdown exits at its deadline even if the database pool never drains", { timeout: 5000 }, async (t) => {
  // Run the real server shutdown in a child: process.exit must be observed,
  // not mocked into a return value that leaves the process hanging.
  const script = `
    const Module = require('node:module');
    const http = require('node:http');
    const originalLoad = Module._load;
    const logger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, event => console.log(event)]));
    setInterval(() => {}, 1000); // Simulate a checked-out database connection.
    Module._load = function(request, parent, isMain) {
      if (request === './config/env') return { config: { PORT: 0, SHUTDOWN_DRAIN_DELAY_MS: 0, SHUTDOWN_TIMEOUT_MS: 100 } };
      if (request === './app') return { __esModule: true, default: { listen: (_port, ready) => http.createServer().listen(0, '127.0.0.1', ready) } };
      if (request === './utils/db') return { __esModule: true, default: { connect: async () => {}, disconnect: () => new Promise(() => {}) } };
      if (request === './jobs/cleanup.job') return { startCleanupJob: () => ({ stop: async () => {} }) };
      if (request === './utils/logger') return { logger };
      if (request === './config/ranking') return { rankingProfile: {} };
      if (request === './utils/lifecycle') return { lifecycle: { startDraining: () => {}, snapshot: () => ({ activeRequests: 0 }), markReady: () => {}, markStopped: () => {} } };
      if (request === './utils/admission') return { admission: { snapshot: () => ({ adaptive: { nearby: {}, upsert: {} } }) } };
      return originalLoad.call(this, request, parent, isMain);
    };
    require('./dist/server');
  `;
  const child = spawn(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let output = "";
  let errors = "";
  let signaled = false;
  child.stderr.on("data", (chunk) => { errors += chunk; });
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (!signaled && output.includes("service_started")) {
      signaled = true;
      child.kill("SIGTERM");
    }
  });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  assert.deepEqual(result, { code: 0, signal: null }, errors);
  assert.match(output, /shutdown_grace_period_exceeded/);
  assert.doesNotMatch(output, /shutdown_completed/);
});

test("shutdown closes keep-alive connections once their in-flight responses finish", { timeout: 10_000 }, async (t) => {
  // Node's server.close() closes only connections that are idle at that moment.
  // A keep-alive socket finishing an in-flight request afterwards would hold
  // shutdown until keepAliveTimeout (5 s) and could hit the forced deadline.
  const script = `
    const Module = require('node:module');
    const http = require('node:http');
    const originalLoad = Module._load;
    const logger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, event => console.log(event)]));
    const handler = (req, res) => {
      if (req.url === '/slow') { console.log('slow_started'); setTimeout(() => res.end('done'), 300); }
      else res.end('ok');
    };
    Module._load = function(request, parent, isMain) {
      if (request === './config/env') return { config: { PORT: 0, SHUTDOWN_DRAIN_DELAY_MS: 0, SHUTDOWN_TIMEOUT_MS: 4000 } };
      if (request === './app') return { __esModule: true, default: { listen: (_port, ready) => {
        const server = http.createServer(handler);
        return server.listen(0, '127.0.0.1', () => { console.log('port=' + server.address().port); ready(); });
      } } };
      if (request === './utils/db') return { __esModule: true, default: { connect: async () => {}, disconnect: async () => {} } };
      if (request === './jobs/cleanup.job') return { startCleanupJob: () => ({ stop: async () => {} }) };
      if (request === './utils/logger') return { logger };
      if (request === './config/ranking') return { rankingProfile: {} };
      if (request === './utils/lifecycle') return { lifecycle: { startDraining: () => {}, snapshot: () => ({ activeRequests: 0 }), markReady: () => {}, markStopped: () => {} } };
      if (request === './utils/admission') return { admission: { snapshot: () => ({ adaptive: { nearby: {}, upsert: {} } }) } };
      return originalLoad.call(this, request, parent, isMain);
    };
    require('./dist/server');
  `;
  const child = spawn(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let output = "";
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  child.stdout.on("data", (chunk) => { output += chunk; });
  const waitFor = async (pattern) => {
    while (!pattern.test(output)) {
      if (child.exitCode !== null) throw new Error(`child exited early: ${errors}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return output.match(pattern);
  };
  const [, port] = await waitFor(/port=(\d+)/);
  await waitFor(/service_started/);
  const agent = new http.Agent({ keepAlive: true });
  t.after(() => agent.destroy());
  const get = (route) => new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: route, agent }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    }).on("error", reject);
  });
  assert.equal(await get("/warm"), 200);
  const inFlight = get("/slow");
  await waitFor(/slow_started/);
  const startedAt = Date.now();
  const exited = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  child.kill("SIGTERM");
  assert.equal(await inFlight, 200);
  assert.deepEqual(await exited, { code: 0, signal: null }, errors);
  assert.match(output, /shutdown_completed/);
  assert.doesNotMatch(output, /shutdown_grace_period_exceeded/);
  assert.ok(Date.now() - startedAt < 2_000, `shutdown took ${Date.now() - startedAt} ms`);
});

test("signals during startup cancel connection work and cannot start the listener", { timeout: 5000 }, async (t) => {
  const script = `
    const Module=require('node:module'), load=Module._load;
    const logger=Object.fromEntries(['info','warn','error'].map(level=>[level,event=>console.log(event)]));
    Module._load=function(request,parent,isMain){
      if(request==='./config/env')return {config:{PORT:0,SHUTDOWN_DRAIN_DELAY_MS:0,SHUTDOWN_TIMEOUT_MS:1000}};
      if(request==='./app')return {__esModule:true,default:{listen(){throw Error('listener_started_after_cancel');}}};
      if(request==='./utils/db')return {__esModule:true,default:{connect:(_a,_b,signal)=>new Promise((_resolve,reject)=>{
        signal.addEventListener('abort',()=>reject(signal.reason),{once:true});console.log('startup_waiting');
      }),disconnect:async()=>console.log('pool_closed')}};
      if(request==='./jobs/cleanup.job')return {startCleanupJob(){throw Error('cleanup_started_after_cancel');}};
      if(request==='./utils/logger')return {logger};
      if(request==='./config/ranking')return {rankingProfile:{}};
      if(request==='./utils/lifecycle')return {lifecycle:{startDraining(){},snapshot(){return {activeRequests:0}},markStopped(){}}};
      if(request==='./utils/admission')return {admission:{}};
      return load.call(this,request,parent,isMain);
    };require('./dist/server');setInterval(()=>{},1000);
  `;
  const child = spawn(process.execPath, ["-e", script], { cwd: path.resolve(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let output = "", errors = "", signaled = false;
  child.stderr.on("data", chunk => { errors += chunk; });
  child.stdout.on("data", chunk => {
    output += chunk;
    if (!signaled && output.includes("startup_waiting")) { signaled = true; child.kill("SIGTERM"); }
  });
  const code = await new Promise(resolve => child.once("close", resolve));
  assert.equal(code, 0, errors);
  assert.match(output, /pool_closed/);
  assert.match(output, /shutdown_completed/);
  assert.doesNotMatch(output + errors, /listener_started_after_cancel|cleanup_started_after_cancel|service_started/);
});

test("shutdown still closes the database and reports failure when cleanup disposal fails", { timeout: 5000 }, async (t) => {
  const script = `
    const Module=require('node:module'),load=Module._load,http=require('node:http');
    const logger=Object.fromEntries(['info','warn','error'].map(level=>[level,event=>console.log(event)]));
    Module._load=function(request,parent,isMain){
      if(request==='./config/env')return {config:{PORT:0,SHUTDOWN_DRAIN_DELAY_MS:0,SHUTDOWN_TIMEOUT_MS:1000}};
      if(request==='./app')return {__esModule:true,default:{listen:(_port,ready)=>http.createServer().listen(0,'127.0.0.1',ready)}};
      if(request==='./utils/db')return {__esModule:true,default:{connect:async()=>{},disconnect:async()=>console.log('pool_closed')}};
      if(request==='./jobs/cleanup.job')return {startCleanupJob:()=>({stop:async()=>{throw Error('disposal_failed')}})};
      if(request==='./utils/logger')return {logger};
      if(request==='./config/ranking')return {rankingProfile:{}};
      if(request==='./utils/lifecycle')return {lifecycle:{startDraining(){},snapshot(){return {activeRequests:0}},markReady(){},markStopped(){}}};
      if(request==='./utils/admission')return {admission:{snapshot:()=>({adaptive:{nearby:{},upsert:{}}})}};
      return load.call(this,request,parent,isMain);
    };require('./dist/server');
  `;
  const child = spawn(process.execPath, ["-e", script], { cwd: path.resolve(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let output = "", errors = "", signaled = false;
  child.stderr.on("data", chunk => { errors += chunk; });
  child.stdout.on("data", chunk => {
    output += chunk;
    if (!signaled && output.includes("service_started")) { signaled = true; child.kill("SIGTERM"); }
  });
  const code = await new Promise(resolve => child.once("close", resolve));
  assert.equal(code, 1, errors);
  assert.match(output, /pool_closed/);
  assert.match(output, /shutdown_failed/);
});
