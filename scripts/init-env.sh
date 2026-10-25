#!/bin/sh
# Generate the project's single environment file without replacing credentials.
set -eu
umask 077

if [ "$#" -ne 0 ]; then
  echo "Usage: $0" >&2
  exit 1
fi

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
target="$project_dir/.env"

if [ -e "$target" ] || [ -L "$target" ]; then
  echo ".env already exists; keep it for this deployment." >&2
  exit 1
fi

if [ -e "$project_dir/.env.vm" ] || [ -L "$project_dir/.env.vm" ]; then
  echo "Existing .env.vm found. Follow docs/VM_UBUNTU.md to rename it to .env without changing credentials." >&2
  exit 1
fi

command -v openssl >/dev/null 2>&1 || {
  echo "Install openssl before generating .env." >&2
  exit 1
}

# Build privately in the same directory; expose only the completed file.
temp_file=$(mktemp "$project_dir/.env.tmp.XXXXXX")
trap 'rm -f -- "$temp_file"' 0
trap 'exit 1' HUP INT TERM

database_password=$(openssl rand -hex 32)
documentation_password=$(openssl rand -hex 24)
sed -e "s/^POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=$database_password/" \
    -e "s/^SWAGGER_AUTH_PASSWORD=$/SWAGGER_AUTH_PASSWORD=$documentation_password/" \
    "$project_dir/.env.example" > "$temp_file"

# GNU ln -T refuses existing files, directories and symlinks, including races.
if ! ln -T -- "$temp_file" "$target"; then
  echo "Could not create .env; no existing configuration was replaced." >&2
  exit 1
fi

echo "Created .env with private permissions. Keep it for restarts and upgrades."
