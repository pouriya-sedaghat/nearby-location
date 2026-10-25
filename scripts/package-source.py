#!/usr/bin/env python3
"""Package the validated standalone source, without local env or dependencies."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text())["version"]
parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path,
                    default=ROOT.parent / f"nearby-location-postgis-v{VERSION}.zip")
args = parser.parse_args()

# Distribute only supported source/configuration paths. Local exports, backups
# and working notes must not become release content just by being nearby.
ROOT_FILES = {
    ".dockerignore", ".env.example", ".gitattributes", ".gitignore",
    "Dockerfile", "README.md", "CONTRIBUTING.md", "CHANGELOG.md", "LICENSE",
    "docker-compose.yaml", "docker-entrypoint.sh",
    "package.json", "package-lock.json", "tsconfig.json",
}

def is_source(relative):
    parts = relative.parts
    if len(parts) == 1:
        return parts[0] in ROOT_FILES
    if any(part.startswith(".") or part in {"node_modules", "dist", "__pycache__"}
           for part in parts):
        return False
    if parts[0] == "src":
        return relative.suffix == ".ts"
    if parts[0] == "docs" and len(parts) == 2:
        return relative.suffix in {".md", ".json"}
    if parts[0] == "migrations" and len(parts) == 2:
        return relative.suffix == ".js"
    if parts[0] == "scripts":
        return (len(parts) == 2 and relative.suffix in {".js", ".py", ".sh"}) or (
            len(parts) == 3 and parts[1] == "fixtures" and relative.suffix == ".sql")
    if parts[0] == "tests":
        return (len(parts) == 2 and relative.suffix == ".js") or (
            len(parts) == 3 and parts[1] == "fixtures" and relative.suffix in {".js", ".sql"})
    return False

paths = []
for path in sorted(ROOT.rglob("*")):
    relative = path.relative_to(ROOT)
    if not is_source(relative) or not path.is_file() or path.is_symlink():
        continue
    paths.append(path)
manifest = "".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(ROOT).as_posix()}\n" for path in paths)
(ROOT / "SHA256SUMS").write_text(manifest)
paths.append(ROOT / "SHA256SUMS")
args.output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(args.output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(paths):
        info = ZipInfo("nearby-location/" + path.relative_to(ROOT).as_posix(),
                       date_time=(2026, 10, 14, 0, 0, 0))
        info.create_system = 3
        mode = 0o755 if path.suffix in {".sh", ".py"} else 0o644
        info.external_attr = (0o100000 | mode) << 16
        info.compress_type = ZIP_DEFLATED
        archive.writestr(info, path.read_bytes())
print(f"{args.output.resolve()} ({args.output.stat().st_size} bytes, {len(paths)} files)")
