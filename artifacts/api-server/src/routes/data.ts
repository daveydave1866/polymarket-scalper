import { Router, type IRouter } from "express";
import { db, signalsTable, positionsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/signals", async (_req, res): Promise<void> => {
  try {
    const signals = await db.select().from(signalsTable);
    res.json(signals);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/positions", async (_req, res): Promise<void> => {
  try {
    const positions = await db.select().from(positionsTable);
    res.json(positions);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
