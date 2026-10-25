#!/bin/sh
set -e

case "${RUN_MIGRATIONS_ON_STARTUP:-true}" in
  true)
    echo "Running database migrations..."
    node scripts/run-migration.js up
    ;;
  false)
    echo "Skipping startup migrations (RUN_MIGRATIONS_ON_STARTUP=false)."
    ;;
  *)
    echo "RUN_MIGRATIONS_ON_STARTUP must be 'true' or 'false'." >&2
    exit 1
    ;;
esac

echo "Starting application..."
exec "$@"
