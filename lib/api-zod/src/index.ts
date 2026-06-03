import { z } from "zod";

// ── Shared types ──────────────────────────────────────────────────────────────

const BotStatusBase = z.object({
  running: z.boolean(),
  mode: z.enum(["live", "paper", "paused"]),
  uptime: z.number(),
  signalsGenerated: z.number(),
  tradesExecuted: z.number(),
  lastSignalAt: z.string().optional(),
  lastTradeAt: z.string().optional(),
  feedsActive: z.number(),
  marketsTracked: z.number(),
  paperBalance: z.number().optional(),
  paperStartingBalance: z.number().optional(),
  nextCycleAt: z.string().optional(),
});

// ── Bot status ────────────────────────────────────────────────────────────────

export const GetBotStatusResponse = BotStatusBase;
export type GetBotStatusResponseType = z.infer<typeof GetBotStatusResponse>;

export const StartBotResponse = BotStatusBase;
export type StartBotResponseType = z.infer<typeof StartBotResponse>;

export const StopBotResponse = BotStatusBase;
export type StopBotResponseType = z.infer<typeof StopBotResponse>;

// ── Bot config ────────────────────────────────────────────────────────────────

export const BotConfigSchema = z.object({
  mode: z.enum(["live", "paper"]),
  minEdge: z.number(),
  maxPositionSize: z.number(),
  maxOpenPositions: z.number(),
  signalWindowSeconds: z.number(),
  enabledCategories: z.array(z.string()),
  paperBalance: z.number().optional(),
  polymarketPrivateKey: z.string().optional(),
  polymarketApiKey: z.string().optional(),
  polymarketApiSecret: z.string().optional(),
  polymarketApiPassphrase: z.string().optional(),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
  dailyReportHour: z.number().int().min(0).max(23).optional(),
  sportsApiKey: z.string().optional(),
  weatherApiKey: z.string().optional(),
  notifyMinEdge: z.number().min(0).max(1).optional(),
  notifyMaxPerCycle: z.number().int().min(1).max(50).optional(),
});

export const GetBotConfigResponse = BotConfigSchema;
export type GetBotConfigResponseType = z.infer<typeof GetBotConfigResponse>;

export const UpdateBotConfigBody = BotConfigSchema.partial();
export type UpdateBotConfigBodyType = z.infer<typeof UpdateBotConfigBody>;

export const UpdateBotConfigResponse = BotConfigSchema;
export type UpdateBotConfigResponseType = z.infer<typeof UpdateBotConfigResponse>;

// ── Markets ───────────────────────────────────────────────────────────────────

export const SyncMarketsResponse = z.object({
  synced: z.number(),
  total: z.number(),
  lastSyncAt: z.string().optional(),
});
export type SyncMarketsResponseType = z.infer<typeof SyncMarketsResponse>;

export const OpportunitySchema = z.object({
  marketId: z.string(),
  question: z.string(),
  category: z.string(),
  yesPrice: z.number(),
  noPrice: z.number(),
  volume: z.number(),
  liquidity: z.number(),
  endDate: z.string().optional(),
  conditionId: z.string().optional(),
  slug: z.string().optional(),
  opportunityScore: z.number(),
  priceSkew: z.number(),
  polymarketUrl: z.string().optional(),
});
export type OpportunityType = z.infer<typeof OpportunitySchema>;

export const GetOpportunitiesResponse = z.object({
  opportunities: z.array(OpportunitySchema),
  lastSyncAt: z.string().optional(),
  totalTracked: z.number(),
});
export type GetOpportunitiesResponseType = z.infer<typeof GetOpportunitiesResponse>;

// ── Test credentials ──────────────────────────────────────────────────────────

export const TestCredentialsResponse = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
export type TestCredentialsResponseType = z.infer<typeof TestCredentialsResponse>;

// ── Credentials status ────────────────────────────────────────────────────────

const CredentialGroupSchema = z.object({
  configured: z.boolean(),
  source: z.enum(["env", "db", "none"]),
});

export const GetCredentialsStatusResponse = z.object({
  polymarket: CredentialGroupSchema,
  telegram: CredentialGroupSchema,
  sportsApi: CredentialGroupSchema,
  weatherApi: CredentialGroupSchema,
});
export type GetCredentialsStatusResponseType = z.infer<typeof GetCredentialsStatusResponse>;
