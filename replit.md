# Polymarket Scalper

A full-stack Polymarket trading bot dashboard with paper/live trading support.

---

## INSTRUCTION MANUAL

### Step 1 — Create a Polymarket Account

1. Go to [polymarket.com](https://polymarket.com) and sign in with Google, email, or a wallet.
2. Complete any KYC/identity verification if prompted (required for US residents in some regions).
3. Deposit USDC into your Polymarket account via the deposit button on the site.

---

### Step 2 — Find Your Wallet Address (L1 Key)

Your **wallet address** is the Ethereum/Polygon address linked to your Polymarket account.

- If you signed in with **MetaMask or another wallet**: your wallet address is the address you connected with. Copy it from MetaMask (starts with `0x...`).
- If you signed in with **Google/email**: Polymarket creates an embedded wallet for you. Go to your Polymarket profile → **Settings** → you should see your wallet address displayed there.

This is your **L1 address** — paste it into the Settings page of this dashboard under "L1 Wallet Address".

---

### Step 3 — Generate Your L2 (CLOB API) Key

The bot trades via Polymarket's CLOB (Central Limit Order Book) API, which requires a separate L2 API key derived from your L1 wallet.

**If you used MetaMask:**
1. Go to [clob.polymarket.com](https://clob.polymarket.com) (or the Settings page in this dashboard has a built-in key generator).
2. Connect your wallet and sign the key-derivation message.
3. Copy the **API Key**, **Secret**, and **Passphrase** that are generated.

**Using the built-in wizard (easiest):**
1. Open this dashboard → **Settings** page.
2. Under "L2 API Credentials", enter your L1 private key and click **Generate L2 Key**.
3. The API Key, Secret, and Passphrase will be filled in automatically.

> Your L1 private key is only used locally to sign the derivation — it is never sent anywhere except to generate the L2 key.

---

### Step 4 — Configure the Dashboard

Open the **Settings** page and fill in:

| Field | What it is |
|---|---|
| L1 Wallet Address | Your `0x...` Polymarket wallet address |
| L1 Private Key | Your wallet's private key (used to generate L2 key, then can be cleared) |
| L2 API Key | Generated in Step 3 |
| L2 Secret | Generated in Step 3 |
| L2 Passphrase | Generated in Step 3 |
| Bot API Key | The `BOT_API_KEY` secret set in Replit (see below) |
| Trading Mode | **Paper** (safe, simulated) or **Live** (real money) |
| Trade Size (USDC) | How much USDC to spend per trade |
| Max Open Positions | Maximum number of trades open at once |

Click **Save Config** after filling everything in.

---

### Step 5 — Bot API Key (Dashboard Access Control)

The **Bot API Key** is a password that protects the dashboard's API so only you can control the bot.

- It is stored in Replit under **Secrets** (lock icon in the sidebar) as `BOT_API_KEY`.
- To view or change it: open the Replit Secrets panel, find `BOT_API_KEY`.
- The same value must be set in Railway → your project → **Variables → BOT_API_KEY** if you are using the deployed version.
- Enter this key in the Settings page under "Bot API Key" so the frontend can authenticate with the server.

---

### Step 6 — Start Trading

1. Go to the **Dashboard** page.
2. Click **Sync Markets** to pull the latest Polymarket markets into the database.
3. Click **Start Bot**.
4. The bot will run on a 5-minute cycle:
   - Scans markets for trading opportunities (price skew + liquidity)
   - Generates signals (price-based and weather-based)
   - Opens positions when conditions are met
   - Monitors open positions and closes at take-profit (6%) or stop-loss (4%)

---

### Pages Overview

| Page | What it shows |
|---|---|
| **Dashboard** | Bot status, start/stop, balance history chart, sync button |
| **Opportunities** | Live list of markets scored by edge/liquidity |
| **Signals** | All generated trading signals (price-skew + NWS weather) |
| **Positions** | Open and closed positions with full P&L report |
| **Settings** | All credentials and bot configuration |

---

### Paper vs Live Mode

| | Paper | Live |
|---|---|---|
| Real money | No | Yes |
| Real orders | No | Yes (via CLOB API) |
| Balance | Virtual (starts at configured amount) | Your actual Polymarket USDC |
| Risk | None | Real |

**Always test in Paper mode first before switching to Live.**

---

### Bot Strategy

- Looks for markets where the current price deviates significantly from fair value (momentum signal).
- Entry filter: liquidity > $5,000 USDC, price skew > 5%.
- Take-profit: +6% from entry. Stop-loss: -4% from entry.
- Maximum position age: 24 hours (auto-closes stale positions).
- Weather signals: uses US National Weather Service forecasts for temperature-related markets.

---

### Troubleshooting

| Problem | Fix |
|---|---|
| Bot won't start | Check Settings — all L2 credentials must be filled in for Live mode |
| "Invalid API key" errors | Make sure BOT_API_KEY in Replit Secrets matches what's in Settings |
| No opportunities showing | Click "Sync Markets" on the Dashboard to refresh market data |
| Positions stuck as "pending" | Old orders that expired on the exchange — they auto-clear after 2 hours |
| Railway app not working | Check Railway Variables — BOT_API_KEY and DATABASE_URL must be set |

---

## Architecture (Developer Reference)

pnpm monorepo with two apps and two shared libraries:

- `artifacts/trading-bot` — React + Vite frontend (port 5000)
- `artifacts/api-server` — Express API server (port 3001)
- `lib/db` — Drizzle ORM + PostgreSQL schema
- `lib/api-zod` — Zod validation schemas shared between server and client
- `lib/api-client-react` — TanStack Query hooks for all API calls

The `Start application` workflow starts everything:
1. Installs dependencies
2. Pushes DB schema (Drizzle)
3. Starts API server (tsx watch)
4. Starts frontend (Vite)

## User Preferences

- Dark terminal aesthetic with JetBrains Mono font and green primary color
- Monospace UI throughout, all-caps labels, square corners
