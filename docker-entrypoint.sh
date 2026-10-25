#!/bin/sh
set -e

echo "Running database migrations..."
npm run migrate:up

echo "Starting application..."
exec "$@"
