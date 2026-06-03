---
name: Multi-user engine pattern
description: How per-user trading state is managed and the monitorPositions paper-close pitfall
---

All per-user runtime state (timers, lastCycleAt, lastDiscoveryAt, liveClient) is stored in module-level Maps keyed by userId (UUID). Every engine function takes `userId: string` as its first parameter and scopes all DB queries with `.where(eq(table.userId, userId))` or `.where(eq(botConfigTable.id, userId))`.

**monitorPositions paper-close pitfall:**
The shouldClose branch has two sub-branches: `config.mode === "live"` (places CLOB close order, sets status "closing") and `else` (paper: closes immediately — sets status "closed", refunds paperBalance, notifies). The `!shouldClose` branch just updates currentPrice/pnl and does nothing else. It is easy to accidentally invert these two else-branches, causing paper positions to never close and live positions to be immediately set "closed" without placing an order.

**Why:** The original singleton engine was rewritten to support per-user isolation; the Maps pattern was chosen over class instances to keep the module flat and avoid serialization complexity.

**How to apply:** When adding new per-user state, add a `Map<string, T>` at module level and initialize lazily inside the relevant function.
