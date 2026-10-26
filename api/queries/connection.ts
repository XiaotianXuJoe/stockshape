import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

const DB_PATH = process.env.DATABASE_URL?.replace("sqlite:", "") || "./data/stockshape.db";

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;

export function getDb() {
  if (!instance) {
    const client = new Database(DB_PATH);
    // Auto-create tables on first connection
    client.exec(`
      CREATE TABLE IF NOT EXISTS stocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        pinyin TEXT,
        sector TEXT,
        market TEXT NOT NULL,
        market_cap REAL,
        latest_price REAL,
        change_percent REAL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_stocks_code ON stocks(code);
      CREATE INDEX IF NOT EXISTS idx_stocks_name ON stocks(name);
      CREATE INDEX IF NOT EXISTS idx_stocks_pinyin ON stocks(pinyin);
      CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector);

      CREATE TABLE IF NOT EXISTS stock_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        date TEXT NOT NULL,
        open REAL,
        high REAL,
        low REAL,
        close REAL,
        volume REAL,
        turnover_rate REAL,
        volume_ratio REAL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_prices_code_date ON stock_prices(code, date);

      CREATE TABLE IF NOT EXISTS analysis_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_code TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        match_days INTEGER NOT NULL,
        candidate_code TEXT NOT NULL,
        candidate_name TEXT,
        similarity_score REAL,
        reasons TEXT,
        sector TEXT,
        volume REAL,
        turnover_rate REAL,
        volume_ratio REAL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_target ON analysis_results(target_code, start_date, end_date);
      CREATE INDEX IF NOT EXISTS idx_analysis_candidate ON analysis_results(candidate_code);

      CREATE TABLE IF NOT EXISTS strategy_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conditions_json TEXT NOT NULL,
        as_of_date TEXT NOT NULL,
        matched_count INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS strategy_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL,
        code TEXT NOT NULL,
        name TEXT,
        close_price REAL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_strategy_results_run ON strategy_results(run_id);
    `);
    instance = drizzle(client, { schema: fullSchema });
  }
  return instance;
}
