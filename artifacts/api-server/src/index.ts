import express, { type Request, type Response, type NextFunction } from "express";
import { pinoHttp } from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./lib/logger.js";
import botRouter from "./routes/bot.js";
import dataRouter from "./routes/data.js";
import authRouter, { getJwtSecret } from "./routes/auth.js";
import adminRouter from "./routes/admin.js";
import { db, botConfigTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { startTradingLoop } from "./lib/engine.js";
import { seedCredentialsFromEnv } from "./lib/credentials.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

app.use(pinoHttp({ logger }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use("/api", authRouter);

interface AuthRequest extends Request {
  userId?: string;
  role?: string;
}

app.use("/api", (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.path.startsWith("/auth/")) { next(); return; }

  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as { userId: string; username: string; role: string };
    req.userId = payload.userId;
    req.role = payload.role;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
});

app.use("/api", adminRouter);
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
    const allUsers = await db.select().from(usersTable);

    if (allUsers.length === 0) {
      const adminUsername = (process.env.ADMIN_USERNAME ?? "admin").toLowerCase();
      const adminPassword = process.env.ADMIN_PASSWORD ?? "changeme123";
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      const adminId = randomUUID();

      const [admin] = await db.insert(usersTable).values({
        id: adminId,
        username: adminUsername,
        passwordHash,
        role: "admin",
      }).returning();

      let botConfig = await db.select().from(botConfigTable).where(eq(botConfigTable.id, "singleton")).then(r => r[0]);

      if (botConfig) {
        await db.update(botConfigTable).set({ id: adminId, userId: adminId }).where(eq(botConfigTable.id, "singleton"));
        logger.info({ adminId, username: adminUsername }, "Migrated singleton config to first admin user");
      } else {
        await db.insert(botConfigTable).values({
          id: adminId,
          userId: adminId,
          mode: "paper",
          minEdge: 0.05,
          maxPositionSize: 50,
          maxOpenPositions: 5,
          signalWindowSeconds: 300,
          enabledCategories: "sports,crypto,weather",
          running: false,
          paperBalance: 1000,
        });
      }

      await seedCredentialsFromEnv(adminId);
      logger.info({ username: adminUsername }, "First admin created — change the default password immediately");

      if (botConfig?.running) {
        logger.info({ userId: adminId }, "Bot was running before restart — resuming trading loop");
        startTradingLoop(adminId);
      }
    } else {
      const runningConfigs = await db.select().from(botConfigTable).where(eq(botConfigTable.running, true));
      for (const cfg of runningConfigs) {
        logger.info({ userId: cfg.userId }, "Resuming trading loop for user");
        startTradingLoop(cfg.userId);
      }
    }
  } catch (err) {
    logger.warn({ err }, "Could not complete startup initialization");
  }
});
