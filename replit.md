# Polymarket Scalper

A full-stack Polymarket trading bot dashboard with paper/live trading support.

## Architecture

pnpm monorepo with two apps and two shared libraries:

- `artifacts/trading-bot` — React + Vite frontend (port 5000)
- `artifacts/api-server` — Express API server (port 3001)
- `lib/db` — Drizzle ORM + PostgreSQL schema
- `lib/api-zod` — Zod validation schemas shared between server and client
- `lib/api-client-react` — TanStack Query hooks for all API calls

## Running

The `Start application` workflow starts everything:
1. Installs dependencies
2. Pushes DB schema (Drizzle)
3. Starts API server (tsx watch)
4. Starts frontend (Vite)

## Key Features

- **Dashboard** — bot status, start/stop controls, market sync
- **Opportunities** — live market list from Polymarket Gamma API with scoring
- **Signals** — generated trading signals
- **Positions** — open/closed positions with P&L
- **Settings** — full config including L1 key wizard, L2 key generator, Telegram, and data feed API keys

## Bot Modes

- **Paper** — simulated trading with a virtual balance
- **Live** — real trading via Polymarket CLOB API (requires L1 + L2 credentials)

## User Preferences

- Dark terminal aesthetic with JetBrains Mono font and green primary color
- Monospace UI throughout, all-caps labels, square corners
