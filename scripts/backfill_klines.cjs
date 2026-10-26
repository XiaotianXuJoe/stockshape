#!/usr/bin/env node
/**
 * 历史K线回填脚本（一次性/可重复运行）
 * - 为 stock_prices 表回填 ~640 根日线（约2.5年），供策略筛选/形态识别使用
 * - 低并发(4) + WAF感知（检测到拦截自动休眠后重试），可断点续跑
 * 用法: node scripts/backfill_klines.js [--conc 4] [--min-bars 300]
 */
const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DATABASE_URL?.replace("sqlite:", "") ||
  path.join(__dirname, "..", "data", "stockshape.db");
const db = new Database(DB_PATH);
db.pragma("busy_timeout = 10000");

const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const CONC = argVal("--conc", 4);
const MIN_BARS = argVal("--min-bars", 300);
const PAGE = 640;
const REQ_TIMEOUT = 15000;
const BATCH_DELAY = 250;

const HOSTS = [
  "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get",
  "https://ifzq.gtimg.cn/appstock/app/fqkline/get",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(" ")}`;
  console.log(line);
  require("fs").appendFileSync("/tmp/backfill.log", line + "\n");
}

async function fetchPage(tencentCode, pageEnd) {
  const qs = `?param=${tencentCode},day,,${pageEnd},${PAGE},qfq`;
  for (const host of HOSTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT);
      let res;
      try {
        res = await fetch(host + qs, {
          signal: ctrl.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: "https://stockapp.finance.qq.com/",
          },
        });
      } finally { clearTimeout(timer); }
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.startsWith("{")) return "BLOCKED"; // WAF HTML
      const json = JSON.parse(text);
      const sd = json.data?.[tencentCode];
      return sd?.qfqday || sd?.day || [];
    } catch { /* next host */ }
  }
  return null; // 两个host都失败（网络错误）
}

async function fetchKline(code) {
  // code 格式 000001.SZ → sz000001
  const [num, mkt] = code.split(".");
  const tencentCode = (mkt === "SH" ? "sh" : "sz") + num;
  const lineMap = new Map();
  let pageEnd = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  for (let p = 0; p < 2; p++) { // 2页×640 ≈ 1280根 ≈ 5年，足够
    const r = await fetchPage(tencentCode, pageEnd);
    if (r === "BLOCKED") return { status: "blocked" };
    if (r === null) return { status: "error" };
    if (r.length === 0) break;
    for (const line of r) lineMap.set(line[0], line);
    const earliest = r[0][0];
    if (r.length < PAGE) break;
    const d = new Date(earliest + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    pageEnd = d.toISOString().slice(0, 10);
  }
  const rows = [...lineMap.values()].sort((a, b) => a[0].localeCompare(b[0]));
  return { status: "ok", rows };
}

const insert = db.prepare(`INSERT OR IGNORE INTO stock_prices
  (code, date, open, high, low, close, volume, turnover_rate, volume_ratio)
  VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`);
const insertMany = db.transaction((code, rows) => {
  for (const [date, o, c, h, l, v] of rows) {
    insert.run(code, date, +o, +h, +l, +c, Math.round(parseFloat(v) * 100));
  }
});

async function main() {
  const targets = db.prepare(`
    SELECT s.code, COUNT(p.id) AS bars
    FROM stocks s LEFT JOIN stock_prices p ON p.code = s.code
    GROUP BY s.code HAVING bars < ?
    ORDER BY s.code`).all(MIN_BARS);
  log(`回填目标: ${targets.length} 只股票 (当前不足${MIN_BARS}根)`);

  let done = 0, ok = 0, err = 0, blockedCount = 0;
  for (let i = 0; i < targets.length; i += CONC) {
    const batch = targets.slice(i, i + CONC);
    const results = await Promise.all(batch.map(async (t) => {
      const r = await fetchKline(t.code);
      if (r.status === "ok" && r.rows.length > 0) {
        insertMany(t.code, r.rows);
        return { s: "ok", n: r.rows.length };
      }
      return { s: r.status, n: 0 };
    }));
    for (const r of results) {
      done++;
      if (r.s === "ok") ok++;
      else if (r.s === "blocked") { blockedCount++; err++; }
      else err++;
    }
    if (done % 100 < CONC) {
      log(`进度 ${done}/${targets.length} 成功${ok} 失败${err} 已拦截${blockedCount}`);
    }
    // WAF拦截处理：连续被拦则休眠退避
    if (results.filter((r) => r.s === "blocked").length >= CONC) {
      blockedCount++;
      log(`检测到WAF拦截，休眠60s...`);
      await sleep(60000);
    }
    await sleep(BATCH_DELAY);
  }
  const total = db.prepare("SELECT COUNT(*) c FROM stock_prices").get().c;
  log(`完成: 成功${ok} 失败${err}，stock_prices 共 ${total} 行`);
}

main().catch((e) => { log("FATAL:", e.message); process.exit(1); });
