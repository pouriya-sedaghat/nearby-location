# Getting started

[Documentation index](README.md)

For a new private VM deployment, follow [Ubuntu VM deployment](VM_UBUNTU.md). Clone the repository, run `./scripts/init-env.sh` once and start the root Compose profile. Preserve its `.env` and persistent volume for later upgrades.

For an existing installation, read [Upgrading](UPGRADING.md) before replacing source or starting another Compose profile. For disposable development, use the separate profile in [Development](DEVELOPMENT.md). First write/search examples and language headers are in the root [README](../README.md) and [API reference](API.md).
