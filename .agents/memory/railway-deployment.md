---
name: Railway deployment quirks
description: Known issues and fixes when deploying this pnpm monorepo to Railway
---

## pnpm PATH issue in nixpacks
`npm install -g pnpm@10` in `[phases.install]` installs pnpm but it isn't on PATH for subsequent Docker RUN steps. Fix: use `nixPkgs = ["nodejs_20", "nodePackages.pnpm"]` in nixpacks.toml.

**Why:** Docker build steps each run in a fresh shell; global npm installs land in a bin dir that isn't in the Dockerfile's PATH.

## Workspace lib packages must be compiled for production
`lib/db` and `lib/api-zod` export `./src/index.ts` directly. tsx handles this in dev but plain Node.js cannot load `.ts` files in production. Fix: add `tsconfig.json` + `"build": "tsc"` to each lib package, update exports to `./dist/index.js`, and build them in nixpacks before the api-server.

**Why:** The api-server is compiled with tsc but its workspace deps are not, so at runtime Node tries to import a `.ts` file.

**How to apply:** nixpacks build order must be: api-zod → db → trading-bot → api-server.

## Railway snapshot cache busting
`serviceInstanceDeployV2` and `serviceInstanceRedeploy` reuse Railway's internal snapshot cache — the old Dockerfile/nixpacks plan is rebuilt from a cached snapshot even after pushing fixes to GitHub. Fix: delete the service and recreate it, then use `serviceInstanceDeploy(commitSha: "...")` with the exact latest commit SHA.

**Why:** Railway snapshots the repo at a point in time. Redeploys reuse that snapshot unless forced.

## PostgreSQL provisioning
Railway's native PostgreSQL plugin is not exposed in GraphQL v2 API. Use `serviceCreate` with `source: { image: "postgres:17" }` and manually set POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, DATABASE_URL env vars. The private domain is `<ServiceName lowercased>.railway.internal`.

## Railway live deployment
- Project: polymarket-scalper (4c6443bd-cde5-452b-b650-eb055ec3ca9e)
- Service domain: api-server-production-818a.up.railway.app
- Region: europe-west4 (Frankfurt)
