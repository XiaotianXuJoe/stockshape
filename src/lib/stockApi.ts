import { useQuery } from "@tanstack/react-query";
import type { StockSearchResult, HistoricalData } from "@contracts/types";
import { FALLBACK_STOCKS } from "./fallbackStocks";

// ── 东方财富搜索API（纯前端调用，部分环境可能受CORS限制） ──

interface EastmoneySearchResult {
  QuotationCodeTable: {
    Data: Array<{
      Code: string;
      Name: string;
      PinYin: string;
      MktNum: string;
      SecurityTypeName: string;
    }>;
  };
}

export async function searchStocksApi(query: string): Promise<StockSearchResult[]> {
  if (!query.trim()) return [];
  
  // 优先尝试东方财富API（在本地dev或支持CORS的环境可用）
  // 添加3秒超时，避免请求挂起
  try {
    const encodedQuery = encodeURIComponent(query.trim());
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodedQuery}&type=14&count=15`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3秒超时
    
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://quote.eastmoney.com/",
      },
    });
    clearTimeout(timeoutId);
    
    if (res.ok) {
      const json = (await res.json()) as EastmoneySearchResult;
      const data = json.QuotationCodeTable?.Data || [];

      const aShareTypes = new Set([
        "沪A", "深A", "科创板", "创业板", "沪市", "深市",
        "上海", "深圳", "主板", "A股", "北交所",
      ]);

      const apiResults = data
        .filter((item) => {
          const secType = item.SecurityTypeName || "";
          return aShareTypes.has(secType) ||
                 secType.includes("A") ||
                 secType.includes("科创") ||
                 secType.includes("创业") ||
                 secType.includes("主板") ||
                 secType.includes("北京");
        })
        .map((item) => ({
          code: `${item.Code}.${item.MktNum === "1" ? "SH" : "SZ"}`,
          name: item.Name,
          pinyin: item.PinYin.toLowerCase(),
          market: item.MktNum === "1" ? "SH" : "SZ",
        }));
      
      if (apiResults.length > 0) return apiResults;
    }
  } catch (err) {
    // CORS error, network error, or timeout — fall through to local search
    console.warn("[StockApi] Eastmoney API unavailable (timeout/CORS/network), using local fallback:", err);
  }
  
  // Fallback: search in local stock list
  return searchStocksLocal(query);
}

function searchStocksLocal(query: string): StockSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  
  return FALLBACK_STOCKS.filter((stock) => {
    const code = stock.code.toLowerCase();
    const name = stock.name.toLowerCase();
    const pinyin = stock.pinyin.toLowerCase();
    return code.includes(q) || name.includes(q) || pinyin.includes(q);
  }).slice(0, 15);
}

export function useStockSearch(query: string) {
  return useQuery({
    queryKey: ["stockSearch", query],
    queryFn: () => searchStocksApi(query),
    enabled: query.trim().length >= 1,
    staleTime: 60_000,
  });
}

// ── 腾讯K线API（纯前端调用，无CORS限制） ──

interface TencentKlineResponse {
  code?: string;
  data?: Record<string, {
    qfqday?: string[][];
    day?: string[][];
    qt?: Record<string, string[]>;
  }>;
}

export async function getKlineApi(
  ticker: string,
  startDate: string,
  endDate: string
): Promise<HistoricalData[]> {
  try {
    const [code, market] = ticker.split(".");
    const tencentCode = market === "SH" ? `sh${code}` : `sz${code}`;
    // 腾讯接口单次最多返回约640根K线：以endDate为锚向前翻页，
    // 直到覆盖startDate或已无更早数据（上市首日）
    const PAGE = 640;
    const MAX_PAGES = 12;
    const lineMap = new Map<string, string[]>();
    let pageEnd = endDate;
    for (let p = 0; p < MAX_PAGES; p++) {
      const url =
        `https://ifzq.gtimg.cn/appstock/app/fqkline/get` +
        `?param=${tencentCode},day,,${pageEnd},${PAGE},qfq`;
      // 15秒超时保护：避免网络异常时加载遮罩永久卡住
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      let res: Response;
      try {
        res = await fetch(url, {
          signal: ctrl.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: "https://stockapp.finance.qq.com/",
          },
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(`Tencent HTTP ${res.status}`);
      const json = (await res.json()) as TencentKlineResponse;
      const stockData = json.data?.[tencentCode];
      const pageLines = stockData?.qfqday || stockData?.day || [];
      if (pageLines.length === 0) break;
      for (const line of pageLines) lineMap.set(line[0], line);
      const earliest = pageLines[0][0];
      if (earliest <= startDate || pageLines.length < PAGE) break;
      const d = new Date(earliest + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 1);
      pageEnd = d.toISOString().slice(0, 10);
    }
    const lines = [...lineMap.values()].sort((a, b) => a[0].localeCompare(b[0]));
    if (lines.length === 0) throw new Error("No kline data");

    const raw: HistoricalData[] = lines.map((line) => {
      const [date, open, close, high, low, volume] = line;
      return {
        date,
        open: parseFloat(open),
        high: parseFloat(high),
        low: parseFloat(low),
        close: parseFloat(close),
        volume: Math.round(parseFloat(volume) * 100),
        turnoverRate: 0,
        volumeRatio: 1,
      };
    });

    const filtered = raw
      .filter((d) => d.date >= startDate && d.date <= endDate)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (filtered.length === 0) throw new Error("No data in date range");

    for (let i = 0; i < filtered.length; i++) {
      if (i >= 5) {
        const avg = filtered.slice(i - 5, i).reduce((s, d) => s + d.volume, 0) / 5;
        filtered[i].volumeRatio = avg > 0 ? parseFloat((filtered[i].volume / avg).toFixed(2)) : 1;
      }
    }

    return filtered;
  } catch (err) {
    console.warn(`[StockApi] Kline fetch failed for ${ticker}:`, err);
    // Fallback to mock data
    return generateMockData(ticker, startDate, endDate);
  }
}

export function useKlineData(ticker: string, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ["kline", ticker, startDate, endDate],
    queryFn: () => getKlineApi(ticker, startDate, endDate),
    enabled: !!ticker && !!startDate && !!endDate,
    staleTime: 300_000,
    // 扩展窗口取数期间保留旧数据，避免图表闪烁/loading遮罩（仅限同一只股票）
    placeholderData: (prev, prevQuery) =>
      prevQuery && (prevQuery.queryKey as unknown[])[1] === ticker ? prev : undefined,
  });
}

// ── 模拟数据后备 ──

function generateMockData(
  ticker: string,
  startDate: string,
  endDate: string
): HistoricalData[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const data: HistoricalData[] = [];

  const seed = ticker.split("").reduce((s, c) => s + c.charCodeAt(0), 0);

  let basePrice: number;
  if (ticker.startsWith("600519")) {
    basePrice = 1500 + (seed % 200);
  } else if (ticker.startsWith("688")) {
    basePrice = 50 + (seed % 100);
  } else if (ticker.startsWith("60")) {
    basePrice = 10 + (seed % 90);
  } else if (ticker.startsWith("00")) {
    basePrice = 15 + (seed % 85);
  } else if (ticker.startsWith("30")) {
    basePrice = 20 + (seed % 80);
  } else {
    basePrice = 20 + (seed % 80);
  }

  let price = basePrice;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;

    const change = (Math.sin(d.getTime() / 86400000 + seed) * 2 + (Math.random() - 0.5) * 3) / 100;
    const open = price;
    const close = price * (1 + change);
    const high = Math.max(open, close) * (1 + Math.random() * 0.02);
    const low = Math.min(open, close) * (1 - Math.random() * 0.02);
    const volume = Math.floor(1000000 + Math.random() * 50000000);

    data.push({
      date: d.toISOString().split("T")[0],
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume,
      turnoverRate: parseFloat((Math.random() * 5).toFixed(2)),
      volumeRatio: 1,
    });

    price = close;
  }

  for (let i = 0; i < data.length; i++) {
    if (i >= 5) {
      const avg = data.slice(i - 5, i).reduce((s, d) => s + d.volume, 0) / 5;
      data[i].volumeRatio = avg > 0 ? parseFloat((data[i].volume / avg).toFixed(2)) : 1;
    }
  }

  return data;
}
