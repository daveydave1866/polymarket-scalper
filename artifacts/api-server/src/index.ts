import express from "express";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import botRouter from "./routes/bot.js";
import dataRouter from "./routes/data.js";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

app.use(pinoHttp({ logger }));
app.use(express.json());

app.use("/api", botRouter);
app.use("/api", dataRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.listen(PORT, "0.0.0.0", () => {
  logger.info({ port: PORT }, "API server listening");
});
