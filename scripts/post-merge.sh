#!/bin/bash
set -e

pnpm install --frozen-lockfile=false
pnpm --filter @workspace/db build
pnpm --filter @workspace/api-zod build
pnpm --filter @workspace/db push
