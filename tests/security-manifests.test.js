const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) => fs.readFileSync(file, "utf8");

test("API deployments support authenticated Swagger without exposing credentials in ConfigMap", () => {
  const config = read("deploy/kubernetes/configmap.yaml");
  assert.match(config, /SWAGGER_ENABLED: "false"/);
  assert.doesNotMatch(config, /SWAGGER_AUTH_PASSWORD/);
  for (const file of ["deploy/kubernetes/deployment.yaml", "deploy/kubernetes/canary-deployment.example.yaml", "deploy/kubernetes/release/canary-deployment.template.yaml"]) {
    const yaml = read(file);
    assert.match(yaml, /key: SWAGGER_AUTH_USERNAME\n\s+optional: true/);
    assert.match(yaml, /key: SWAGGER_AUTH_PASSWORD\n\s+optional: true/);
  }
});

test("example Kubernetes Secret and ConfigMap pass server and migration TLS validation unchanged", () => {
  const { parse } = require("yaml");
  const { withPostgresOptions, migrationTlsArgs } = require("../scripts/lib/postgres-options");
  const configMap = parse(read("deploy/kubernetes/configmap.yaml")).data;
  const secret = parse(read("deploy/kubernetes/secret.example.yaml")).stringData;
  const env = { ...configMap, ...secret };

  // Keep explicit verified TLS: the fix must not drop PG_SSL or verification.
  assert.equal(env.PG_SSL, "true");
  assert.equal(env.PG_SSL_REJECT_UNAUTHORIZED, "true");
  assert.deepEqual(withPostgresOptions({ connectionString: env.DATABASE_URL }, env).ssl, { rejectUnauthorized: true });
  assert.deepEqual(migrationTlsArgs([], env), ["--reject-unauthorized", "true"]);

  // The API pod receives the ConfigMap plus these Secret keys; load the real
  // server configuration and pool module exactly as a pod would.
  const result = spawnSync(process.execPath, ["-e", "require('./dist/utils/db')"], {
    cwd: path.resolve(__dirname, ".."),
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("example manifests reference the packaged application version", () => {
  const { version } = require("../package.json");
  const files = fs.readdirSync("deploy/kubernetes").filter((file) => file.endsWith(".yaml"))
    .map((file) => `deploy/kubernetes/${file}`);
  for (const file of files) {
    const yaml = read(file);
    for (const [, tag] of yaml.matchAll(/image: nearby-location:(\S+)/g)) assert.equal(tag, version, file);
    for (const [, label] of yaml.matchAll(/app\.kubernetes\.io\/version: "([^"]+)"/g)) assert.equal(label, version, file);
  }
});

test("stable Service and PDB select API pods and exclude maintenance Job pods", () => {
  const { parse } = require("yaml");
  const service = parse(read("deploy/kubernetes/service.yaml"));
  const pdb = parse(read("deploy/kubernetes/pdb.yaml"));
  const matches = (selector, labels) => Object.entries(selector).every(([key, value]) => labels[key] === value);
  for (const file of [
    "deploy/kubernetes/deployment.yaml",
    "deploy/kubernetes/canary-deployment.example.yaml",
    "deploy/kubernetes/migration-job.example.yaml",
    "deploy/kubernetes/release/migration-job.template.yaml",
    "deploy/kubernetes/release/capacity-job.template.yaml",
    "deploy/kubernetes/release/canary-gate-job.template.yaml",
    "deploy/kubernetes/release/post-promotion-smoke-job.template.yaml",
    "deploy/kubernetes/privacy-audit-cronjob.example.yaml",
  ]) {
    const manifest = parse(read(file));
    const labels = (manifest.kind === "CronJob" ? manifest.spec.jobTemplate.spec : manifest.spec).template.metadata.labels;
    const expected = file === "deploy/kubernetes/deployment.yaml";
    assert.equal(matches(service.spec.selector, labels), expected, file);
    assert.equal(matches(pdb.spec.selector.matchLabels, labels), expected, file);
  }
});

test("stable Deployment and HPA pod selection exclude maintenance Job pods", () => {
  const { parse } = require("yaml");
  const stable = parse(read("deploy/kubernetes/deployment.yaml"));
  const selector = stable.spec.selector.matchLabels;
  assert.equal(selector["app.kubernetes.io/component"], "api");
  const matches = labels => Object.entries(selector).every(([key, value]) => labels[key] === value);
  assert.equal(matches(stable.spec.template.metadata.labels), true);
  for (const file of ["deploy/kubernetes/migration-job.example.yaml", "deploy/kubernetes/release/capacity-job.template.yaml", "deploy/kubernetes/release/canary-gate-job.template.yaml"]) {
    assert.equal(matches(parse(read(file)).spec.template.metadata.labels), false, file);
  }
});

test("network policy is opt-in and selects both stable/canary API pods", () => {
  const kustomization = read("deploy/kubernetes/kustomization.yaml");
  const policy = read("deploy/kubernetes/networkpolicy.example.yaml");
  assert.doesNotMatch(kustomization, /networkpolicy\.example\.yaml/);
  assert.match(policy, /app\.kubernetes\.io\/part-of: nearby-location/);
  assert.match(policy, /app\.kubernetes\.io\/component: api/);
  assert.match(policy, /nearby-location\/access: location-client/);
  assert.match(policy, /nearby-location\/privacy-client: "true"/);
});

test("release RBAC remains namespace-scoped and cannot read Secrets", () => {
  const rbac = read("deploy/kubernetes/release-rbac.example.yaml");
  assert.match(rbac, /kind: Role\n/);
  assert.doesNotMatch(rbac, /kind: ClusterRole\n/);
  assert.doesNotMatch(rbac, /resources: \[[^\]]*"secrets"/);
  assert.match(rbac, /resources: \["deployments"\]/);
  assert.match(rbac, /resources: \["jobs"\]/);
  const { parseAllDocuments } = require('yaml');
  const role = parseAllDocuments(rbac).map((doc) => doc.toJSON()).find((doc) => doc.kind === 'Role');
  const scale = role.rules.find((rule) => rule.resources.includes('deployments/scale'));
  assert.ok(scale, 'kubectl scale requires explicit subresource permission');
  assert.deepEqual(scale.apiGroups, ['apps']);
  assert.deepEqual(scale.resourceNames, ['nearby-location-canary']);
  for (const verb of ['get', 'patch', 'update']) assert.ok(scale.verbs.includes(verb));
});

test("release synthetic jobs can authenticate to protected location endpoints", () => {
  for (const file of [
    "deploy/kubernetes/release/canary-gate-job.template.yaml",
    "deploy/kubernetes/release/post-promotion-smoke-job.template.yaml",
  ]) {
    const yaml = read(file);
    assert.match(yaml, /nearby-location\/access: location-client/);
    assert.match(yaml, /name: BENCHMARK_AUTH_TOKEN/);
    assert.match(yaml, /key: LOCATION_AUTH_TOKEN/);
  }
});

test("location authentication is mounted before JSON parsing", () => {
  const app = read("src/app.ts");
  const authIndex = app.indexOf('app.use("/location", authorizationMiddleware("location"))');
  const parserIndex = app.indexOf('app.use(express.json(');
  const routeIndex = app.indexOf('app.use("/location", locationRoutes)');
  assert.ok(authIndex >= 0 && parserIndex >= 0 && routeIndex >= 0);
  assert.ok(authIndex < parserIndex, "auth must run before body parsing");
  assert.ok(parserIndex < routeIndex, "body parsing must run before controllers");
});

test("base Kubernetes config keeps auth and privacy rollout backward compatible", () => {
  const config = read("deploy/kubernetes/configmap.yaml");
  assert.match(config, /LOCATION_AUTH_MODE: "disabled"/);
  assert.match(config, /METRICS_AUTH_MODE: "disabled"/);
  assert.match(config, /PRIVACY_API_ENABLED: "false"/);
  const deployment = read("deploy/kubernetes/deployment.yaml");
  assert.match(deployment, /key: LOCATION_AUTH_TOKEN\n\s+optional: true/);
  assert.match(deployment, /key: PRIVACY_AUTH_TOKEN\n\s+optional: true/);
});

test("stable and canary API deployments can start when privacy auth is enabled", () => {
  for (const file of [
    "deploy/kubernetes/deployment.yaml",
    "deploy/kubernetes/canary-deployment.example.yaml",
    "deploy/kubernetes/release/canary-deployment.template.yaml",
  ]) {
    const yaml = read(file);
    assert.match(yaml, /name: PRIVACY_AUTH_TOKEN/);
    assert.match(yaml, /key: PRIVACY_AUTH_TOKEN/);
    assert.match(yaml, /key: PRIVACY_AUTH_PREVIOUS_TOKEN/);
  }
});

test("privacy authentication is mounted before JSON parsing and the route is opt-in", () => {
  const app = read("src/app.ts");
  const authIndex = app.indexOf('app.use("/privacy", authorizationMiddleware("privacy"))');
  const parserIndex = app.indexOf('app.use(express.json(');
  const routeIndex = app.indexOf('app.use("/privacy", privacyRoutes)');
  assert.ok(authIndex >= 0 && parserIndex >= 0 && routeIndex >= 0);
  assert.ok(authIndex < parserIndex, "privacy auth must run before body parsing");
  assert.ok(parserIndex < routeIndex, "body parsing must run before privacy controller");
  assert.match(app, /if \(config\.PRIVACY_API_ENABLED\)/);
});
test("privacy audit CronJob is opt-in and runs without Kubernetes API credentials", () => {
  const kustomization = read("deploy/kubernetes/kustomization.yaml");
  const cron = read("deploy/kubernetes/privacy-audit-cronjob.example.yaml");
  assert.doesNotMatch(kustomization, /privacy-audit-cronjob\.example\.yaml/);
  assert.match(cron, /automountServiceAccountToken: false/);
  assert.match(cron, /scripts\/audit-privacy-retention\.js/);
  assert.doesNotMatch(cron, /PRIVACY_AUTH_TOKEN/);
});
