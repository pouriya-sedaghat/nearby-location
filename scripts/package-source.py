#!/usr/bin/env python3
"""Package reviewed source paths with deterministic metadata and checksums."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
ROOT_FILES = {".dockerignore", ".env.example", ".gitattributes", ".gitignore", ".nvmrc",
              "Dockerfile", "docker-compose.yaml", "docker-entrypoint.sh", "package.json",
              "package-lock.json", "tsconfig.json", "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "LICENSE"}
DEPLOY_FILES = {'deploy/kubernetes/canary-deployment.example.yaml', 'deploy/kubernetes/release/README.md', 'deploy/kubernetes/hpa.example.yaml', 'deploy/kubernetes/secret.example.yaml', 'deploy/kubernetes/kustomization.yaml', 'deploy/vm/compose.yaml', 'deploy/kubernetes/pdb.yaml', 'deploy/kubernetes/service.yaml', 'deploy/kubernetes/httproute-canary.example.yaml', 'deploy/compose.development.yaml', 'deploy/kubernetes/release/post-promotion-smoke-job.template.yaml', 'deploy/kubernetes/privacy-audit-cronjob.example.yaml', 'deploy/vm/resources.py', 'deploy/kubernetes/release/release.sh', 'deploy/kubernetes/networkpolicy.example.yaml', 'deploy/kubernetes/prometheus-rule.example.yaml', 'deploy/kubernetes/release-rbac.example.yaml', 'deploy/kubernetes/release/canary-gate-job.template.yaml', 'deploy/vm/vm.sh', 'deploy/kubernetes/README.md', 'deploy/kubernetes/configmap.yaml', 'deploy/kubernetes/canary-service.example.yaml', 'deploy/kubernetes/deployment.yaml', 'deploy/kubernetes/release/capacity-job.template.yaml', 'deploy/kubernetes/release/migration-job.template.yaml', 'deploy/vm/redact.py', 'deploy/kubernetes/migration-job.example.yaml', 'deploy/kubernetes/release/canary-deployment.template.yaml'}

def approved(path):
    parts = path.parts
    if len(parts) == 1:
        return parts[0] in ROOT_FILES
    if any(part.startswith('.') or part in {'node_modules', 'dist', '__pycache__', 'vm-reports'} for part in parts):
        return parts[:2] == ('.github', 'workflows') and len(parts) == 3 and parts[2] in {'ci.yml', 'release-canary.yml'}
    if parts[0] == 'src': return path.suffix == '.ts'
    if parts[0] == 'docs': return (len(parts) == 2 and path.suffix in {'.md', '.json'}) or (len(parts) == 3 and parts[1] == 'runbooks' and path.suffix == '.md')
    if parts[0] == 'migrations': return len(parts) == 2 and path.suffix == '.js'
    if parts[0] == 'scripts':
        return (len(parts) == 2 and path.suffix in {'.js', '.py', '.sh'}) or (len(parts) == 3 and parts[1] in {'lib', 'fixtures'} and path.suffix in {'.js', '.sql'})
    if parts[0] == 'tests':
        return (len(parts) == 2 and (path.suffix == '.js' or path.name == 'prometheus-rules.test.yml')) or (len(parts) == 3 and parts[1] == 'fixtures' and path.suffix in {'.js', '.json', '.sql'})
    return path.as_posix() in DEPLOY_FILES

def main():
    version = json.loads((ROOT/'package.json').read_text())['version']
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT.parent/f'nearby-location-postgis-v{version}.zip')
    output = parser.parse_args().output.resolve()
    files = {}
    for source in sorted(ROOT.rglob('*')):
        relative = source.relative_to(ROOT)
        if not approved(relative): continue
        if source.is_symlink() or any(parent.is_symlink() for parent in source.parents if parent != ROOT and ROOT in parent.parents):
            raise ValueError(f'Source archives do not follow symbolic links: {relative}')
        if source.is_file(): files[relative.as_posix()] = source.read_bytes().replace(b'\r\n', b'\n')
    manifest = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name, data in files.items()).encode()
    (ROOT/'SHA256SUMS').write_bytes(manifest)
    files['SHA256SUMS'] = manifest
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            info = ZipInfo('nearby-location/'+name, date_time=(2000, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (0o100000 | (0o755 if Path(name).suffix in {'.sh', '.py'} else 0o644)) << 16
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, data, compresslevel=9)
    print(json.dumps({'file':str(output),'version':version,'files':len(files)}))

if __name__ == '__main__': main()
