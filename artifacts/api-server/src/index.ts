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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

app.use(pinoHttp({ logger }));
app.use(express.json());

app.use("/api", botRouter);
app.use("/api", dataRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

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

    if (config?.running) {
      logger.info("Bot was running before restart — resuming trading loop");
      startTradingLoop();
    }
  } catch (err) {
    logger.warn({ err }, "Could not initialize bot config on startup");
  }
});
