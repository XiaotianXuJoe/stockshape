import { createRouter, publicQuery } from "./middleware";
import { stockRouter } from "./routes/stock";
import { analysisRouter } from "./routes/analysis";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  stock: stockRouter,
  analysis: analysisRouter,
});

export type AppRouter = typeof appRouter;