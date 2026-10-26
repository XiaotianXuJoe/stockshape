
const Database = require('better-sqlite3');
const db = new Database('data/stockshape.db');

const fs = require('fs');
const path = require('path');

// Read the proxyFetch module to make HTTP requests
async function fetchSinaAllStocks() {
  const results = [];
  let page = 1;
  const pageSize = 100;
  const maxPages = 100;

  while (page <= maxPages) {
    const url = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=' + page + '&num=' + pageSize + '&sort=symbol&asc=1&node=hs_a&symbol=&_s_r_a=page';

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://vip.stock.finance.sina.com.cn/mkt/'
        }
      });

      if (!res.ok) break;
      const data = await res.json();
      if (!data || data.length === 0) break;

      for (const item of data) {
        const symbol = item.symbol || '';
        if (!symbol || symbol.length < 2) continue;
        const prefix = symbol.substring(0, 2);
        const code = item.code || symbol.substring(2);
        const market = prefix === 'sh' ? 'SH' : prefix === 'sz' ? 'SZ' : 'SH';
        results.push({code: code + '.' + market, name: item.name, pinyin: '', market});
      }

      if (data.length < pageSize) break;
      page++;
    } catch (e) {
      console.log('Fetch error page', page, e.message);
      break;
    }
  }

  return results;
}

async function main() {
  console.log('Fetching stocks from Sina...');
  const stocks = await fetchSinaAllStocks();
  console.log('Fetched', stocks.length, 'stocks');

  if (stocks.length === 0) {
    console.log('No stocks fetched, exiting');
    return;
  }

  const insertStmt = db.prepare('INSERT OR REPLACE INTO stocks (code, name, pinyin, market, updated_at) VALUES (?, ?, ?, ?, ?)');
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      insertStmt.run(item.code, item.name, item.pinyin, item.market, new Date().toISOString());
    }
  });

  try {
    insertMany(stocks);
    console.log('Inserted', stocks.length, 'stocks successfully');
  } catch (e) {
    console.log('Insert error:', e.message);
  }

  const count = db.prepare('SELECT COUNT(*) as c FROM stocks').get();
  console.log('Total stocks in DB:', count.c);
}

main().catch(console.error);
