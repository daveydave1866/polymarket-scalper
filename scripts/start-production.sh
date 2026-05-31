#!/bin/bash
set -e

echo "Running DB schema migration..."
pnpm --filter @workspace/db push

echo "Starting API server..."
exec NODE_ENV=production pnpm --filter @workspace/api-server start
