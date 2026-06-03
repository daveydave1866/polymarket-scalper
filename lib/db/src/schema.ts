import { pgTable, text, real, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const botConfigTable = pgTable("bot_config", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull().default("paper"),
  minEdge: real("min_edge").notNull().default(0.05),
  maxPositionSize: real("max_position_size").notNull().default(50),
  maxOpenPositions: integer("max_open_positions").notNull().default(5),
  signalWindowSeconds: integer("signal_window_seconds").notNull().default(300),
  enabledCategories: text("enabled_categories").notNull().default("sports,crypto,weather"),
  paperBalance: real("paper_balance").default(1000),
  running: boolean("running").notNull().default(false),
  startedAt: text("started_at"),
  polymarketPrivateKey: text("polymarket_private_key"),
  polymarketApiKey: text("polymarket_api_key"),
  polymarketApiSecret: text("polymarket_api_secret"),
  polymarketApiPassphrase: text("polymarket_api_passphrase"),
  telegramBotToken: text("telegram_bot_token"),
  telegramChatId: text("telegram_chat_id"),
  dailyReportHour: integer("daily_report_hour").default(8),
  sportsApiKey: text("sports_api_key"),
  weatherApiKey: text("weather_api_key"),
  notifyMinEdge: real("notify_min_edge").notNull().default(0.10),
  notifyMaxPerCycle: integer("notify_max_per_cycle").notNull().default(5),
  partialFillThreshold: real("partial_fill_threshold").notNull().default(0.5),
});

export const marketsTable = pgTable("markets", {
  id: text("id").primaryKey(),
  question: text("question").notNull(),
  category: text("category").notNull().default("crypto"),
  yesPrice: real("yes_price").notNull().default(0.5),
  noPrice: real("no_price").notNull().default(0.5),
  volume: real("volume").notNull().default(0),
  liquidity: real("liquidity").notNull().default(0),
  endDate: text("end_date"),
  conditionId: text("condition_id"),
  slug: text("slug"),
  outcomes: text("outcomes"),
  clobTokenIds: text("clob_token_ids"),
  isTracked: boolean("is_tracked").notNull().default(true),
  lastSyncAt: timestamp("last_sync_at").defaultNow(),
});

export const signalsTable = pgTable("signals", {
  id: text("id").primaryKey(),
  marketId: text("market_id").notNull(),
  side: text("side").notNull(),
  confidence: real("confidence").notNull().default(0),
  edge: real("edge").notNull().default(0),
  source: text("source").notNull().default("engine"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const positionsTable = pgTable("positions", {
  id: text("id").primaryKey(),
  marketId: text("market_id").notNull(),
  signalId: text("signal_id"),
  orderId: text("order_id"),
  closeOrderId: text("close_order_id"),
  closedPrice: real("closed_price"),
  side: text("side").notNull(),
  size: real("size").notNull().default(0),
  entryPrice: real("entry_price").notNull().default(0),
  currentPrice: real("current_price"),
  pnl: real("pnl").default(0),
  realizedPnl: real("realized_pnl").default(0),
  status: text("status").notNull().default("open"),
  openedAt: timestamp("opened_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
  closeOrderPlacedAt: timestamp("close_order_placed_at"),
});

export const balanceSnapshotsTable = pgTable("balance_snapshots", {
  id: text("id").primaryKey(),
  balance: real("balance").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});
