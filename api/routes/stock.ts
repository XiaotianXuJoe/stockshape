import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { searchStocks, getStockInfo, getHistoricalData } from "../lib/stockData";
import { getDb } from "../queries/connection";
import { stocks } from "@db/schema";
import { sql } from "drizzle-orm";

export const stockRouter = createRouter({
  search: publicQuery
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ input }) => {
      return searchStocks(input.query);
    }),

  getInfo: publicQuery
    .input(z.object({ ticker: z.string() }))
    .query(async ({ input }) => {
      const info = await getStockInfo(input.ticker);
      return info;
    }),

  getHistoricalData: publicQuery
    .input(
      z.object({
        ticker: z.string(),
        startDate: z.string(),
        endDate: z.string(),
      })
    )
    .query(async ({ input }) => {
      return getHistoricalData(input.ticker, input.startDate, input.endDate);
    }),

  count: publicQuery.query(async () => {
    const db = getDb();
    const result = db.select({ count: sql<number>`count(*)` }).from(stocks).get();
    return result?.count ?? 0;
  }),

  bulkInsert: publicQuery
    .input(
      z.array(
        z.object({
          code: z.string(),
          name: z.string(),
          pinyin: z.string(),
          market: z.string(),
        })
      )
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      let inserted = 0;
      for (const stock of input) {
        try {
          await db
            .insert(stocks)
            .values(stock)
            .onConflictDoUpdate({
              target: stocks.code,
              set: {
                name: stock.name,
                pinyin: stock.pinyin,
                market: stock.market,
              },
            });
          inserted++;
        } catch {
          // ignore
        }
      }
      return inserted;
    }),
});
