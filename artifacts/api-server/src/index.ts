import express from "express";
import { pinoHttp } from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./lib/logger.js";
import botRouter from "./routes/bot.js";
import dataRouter from "./routes/data.js";
import { db, botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { startTradingLoop } from "./lib/engine.js";
import { seedCredentialsFromEnv } from "./lib/credentials.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

app.use(pinoHttp({ logger }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.post("/api/auth/verify", (req, res) => {
  const BOT_API_KEY = process.env.BOT_API_KEY;
  if (!BOT_API_KEY) {
    res.json({ ok: true });
    return;
  }
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  res.json({ ok: token === BOT_API_KEY });
});

app.use("/api", (req, res, next) => {
  const BOT_API_KEY = process.env.BOT_API_KEY;
  if (!BOT_API_KEY) { next(); return; }
  if (req.path === "/auth/verify") { next(); return; }
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== BOT_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

app.use("/api", botRouter);
app.use("/api", dataRouter);

if (process.env.NODE_ENV === "production") {
  const staticDir = path.join(__dirname, "../../trading-bot/dist");
  app.use(express.static(staticDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

app.listen(PORT, "0.0.0.0", async () => {
  logger.info({ port: PORT }, "API server listening");

  try {
    let [config] = await db
      .select()
      .from(botConfigTable)
      .where(eq(botConfigTable.id, "singleton"));

    if (!config) {
      [config] = await db
        .insert(botConfigTable)
        .values({
          id: "singleton",
          mode: "paper",
          minEdge: 0.05,
          maxPositionSize: 50,
          maxOpenPositions: 5,
          signalWindowSeconds: 300,
          enabledCategories: "sports,crypto,weather",
          running: false,
          paperBalance: 1000,
        })
        .returning();
      logger.info("Bot config initialized with defaults");
    }

    await seedCredentialsFromEnv();

    if (config?.running) {
      logger.info("Bot was running before restart — resuming trading loop");
      startTradingLoop();
    }
  } catch (err) {
    logger.warn({ err }, "Could not initialize bot config on startup");
  }
});
