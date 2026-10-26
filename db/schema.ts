import {
  sqliteTable,
  integer,
  text,
  real,
  index,
} from "drizzle-orm/sqlite-core";

// 股票基础信息表（存储全A股列表）
export const stocks = sqliteTable(
  "stocks",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    code: text("code", { length: 20 }).notNull().unique(),
    name: text("name", { length: 100 }).notNull(),
    pinyin: text("pinyin", { length: 50 }),
    sector: text("sector", { length: 100 }),
    concept: text("concept", { length: 200 }),
    market: text("market", { length: 10 }).notNull(),
    marketCap: real("market_cap"),
    latestPrice: real("latest_price"),
    changePercent: real("change_percent"),
    updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_sector").on(table.sector),
    index("idx_name").on(table.name),
    index("idx_pinyin").on(table.pinyin),
    index("idx_code").on(table.code),
  ]
);

// 历史行情缓存表
export const stockPrices = sqliteTable(
  "stock_prices",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    code: text("code", { length: 20 }).notNull(),
    date: text("date", { length: 10 }).notNull(),
    open: real("open"),
    high: real("high"),
    low: real("low"),
    close: real("close"),
    volume: real("volume"),
    turnoverRate: real("turnover_rate"),
    volumeRatio: real("volume_ratio"),
  },
  (table) => [index("idx_code_date").on(table.code, table.date)]
);

// 分析结果缓存表
export const analysisResults = sqliteTable(
  "analysis_results",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    targetCode: text("target_code", { length: 20 }).notNull(),
    startDate: text("start_date", { length: 10 }).notNull(),
    endDate: text("end_date", { length: 10 }).notNull(),
    matchDays: integer("match_days").notNull(),
    candidateCode: text("candidate_code", { length: 20 }).notNull(),
    candidateName: text("candidate_name", { length: 100 }),
    similarityScore: real("similarity_score"),
    reasons: text("reasons", { length: 500 }),
    sector: text("sector", { length: 50 }),
    volume: real("volume"),
    turnoverRate: real("turnover_rate"),
    volumeRatio: real("volume_ratio"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_target_dates").on(table.targetCode, table.startDate, table.endDate),
    index("idx_candidate").on(table.candidateCode),
  ]
);

// 策略筛选运行记录（⑭ 回测闭环：每次条件筛选落库，供后续收益追踪）
export const strategyRuns = sqliteTable("strategy_runs", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  conditionsJson: text("conditions_json").notNull(),
  asOfDate: text("as_of_date", { length: 10 }).notNull(),
  matchedCount: integer("matched_count"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});

export const strategyResults = sqliteTable(
  "strategy_results",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    runId: integer("run_id").notNull(),
    code: text("code", { length: 20 }).notNull(),
    name: text("name", { length: 100 }),
    closePrice: real("close_price"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_strategy_results_run").on(table.runId)]
);
