const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nearby-prometheus-'));
try {
  const manifest = YAML.parse(fs.readFileSync(path.join(root, 'deploy/kubernetes/prometheus-rule.example.yaml'), 'utf8'));
  fs.writeFileSync(path.join(temp, 'rules.yml'), YAML.stringify(manifest.spec));
  fs.copyFileSync(path.join(root, 'tests/prometheus-rules.test.yml'), path.join(temp, 'test.yml'));
  const docker = process.argv.includes('--docker');
  if (docker) fs.chmodSync(temp, 0o755); // Fixtures contain only synthetic counters.
  for (const args of [['check', 'rules', 'rules.yml'], ['test', 'rules', 'test.yml']]) {
    const command = docker ? 'docker' : process.env.PROMTOOL_BIN || 'promtool';
    const commandArgs = docker ? [
      'run', '--rm', '--entrypoint', '/bin/promtool', '-v', `${temp}:/rules:ro`,
      '-w', '/rules', 'prom/prometheus:v3.5.0', ...args,
    ] : args;
    const result = spawnSync(command, commandArgs, { cwd: temp, stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      console.error(result.error?.message || 'Monitoring rule validation failed');
      process.exitCode = result.status || 1;
      break;
    }
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
