import { Router, type IRouter } from "express";
import { db, signalsTable, positionsTable, marketsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

    const marketIds = [...new Set(positions.map((p) => p.marketId))];
    const questionMap = new Map<string, string>();

    for (const mid of marketIds) {
      try {
        const [market] = await db
          .select({ question: marketsTable.question })
          .from(marketsTable)
          .where(eq(marketsTable.id, mid));
        if (market) questionMap.set(mid, market.question);
      } catch {
        // leave undefined
      }
    }

    const enriched = positions.map((p) => ({
      ...p,
      question: questionMap.get(p.marketId),
    }));

    res.json(enriched);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
