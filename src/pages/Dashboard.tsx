import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { StockSearch } from "@/components/search/StockSearch";
import { StockChart } from "@/components/charts/StockChart";
import { ControlPanel } from "@/components/panels/ControlPanel";
import { ResultsTable } from "@/components/results/ResultsTable";
import { useAppStore } from "@/stores/appStore";
import { Search, TrendingUp, BarChart3, Loader2 } from "lucide-react";

// ── 前端自动同步全A股列表到后端数据库 ──
// 浏览器调用东方财富API不受IP限制，服务器端受限
function useStockSync() {
  const [syncing, setSyncing] = useState(false);
  const [syncedCount, setSyncedCount] = useState(0);
  const [stockCount, setStockCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      setSyncing(true);
      try {
        // 先检查后端数据库中股票数量
        const countRes = await fetch('/api/trpc/stock.count?input=%7B%22json%22%3A%7B%7D%7D');
        const countData = await countRes.json();
        const currentCount = countData.result?.data?.json ?? 0;
        setStockCount(currentCount);

        if (currentCount >= 1000) {
          setSyncing(false);
          return;
        }

        // 前端直接fetch东方财富API（浏览器不受限）
        const markets = [
          { fs: "m:0+t:6,m:0+t:13,m:0+t:80,m:0+t:81,m:0+t:82", prefix: "sz" },
          { fs: "m:1+t:2,m:1+t:23,m:1+t:21,m:1+t:26", prefix: "sh" },
        ];

        const allStocks: { code: string; name: string; pinyin: string; market: string }[] = [];

        for (const market of markets) {
          const url =
            `https://push2.eastmoney.com/api/qt/clist/get` +
            `?pn=1&pz=5000&po=1&np=1&fltt=2&invt=2` +
            `&fid=f12&fs=${market.fs}` +
            `&fields=f12,f13,f14,f18`;

          const res = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Referer: "https://quote.eastmoney.com/",
            },
          });

          if (!res.ok) continue;
          const json = await res.json();
          const diff = json.data?.diff || [];

          for (const item of diff) {
            const code = item.f12;
            const name = item.f14;
            const pinyin = String(item.f18 || "").toLowerCase();
            const mktNum = item.f13;
            const mkt = mktNum === "1" ? "SH" : "SZ";
            allStocks.push({ code: `${code}.${mkt}`, name, pinyin, market: mkt });
          }
        }

        if (allStocks.length > 0 && !cancelled) {
          // 批量传给后端存入数据库
          const insertRes = await fetch('/api/trpc/stock.bulkInsert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ json: allStocks }),
          });
          const insertData = await insertRes.json();
          const inserted = insertData.result?.data?.json ?? 0;
          setSyncedCount(inserted);
          setStockCount(currentCount + inserted);
        }
      } catch (err) {
        console.warn("[StockSync] failed:", err);
      } finally {
        if (!cancelled) setSyncing(false);
      }
    }

    sync();
    return () => { cancelled = true; };
  }, []);

  return { syncing, syncedCount, stockCount };
}

export default function Dashboard() {
  const targetStock = useAppStore((s) => s.targetStock);
  const selectedCandidate = useAppStore((s) => s.selectedCandidate);
  const dateRange = useAppStore((s) => s.dateRange);
  const { syncing, syncedCount, stockCount } = useStockSync();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-14">
        {/* Hero / Search Section */}
        <section className="relative overflow-hidden border-b border-border px-6 py-12">
          {/* 氛围光 */}
          <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative mx-auto max-w-4xl text-center">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              通过形态发现机会
            </h1>
            <p className="mt-3 text-base text-muted-foreground">
              输入股票代码，设定历史走势区间，AI 为您扫描全市场相似形态
            </p>
            <div className="mt-8 flex justify-center">
              <StockSearch />
            </div>
            {/* 同步状态提示 */}
            {syncing && (
              <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>正在同步全市场股票列表...</span>
              </div>
            )}
            {!syncing && syncedCount > 0 && (
              <div className="mt-2 text-center text-xs text-emerald-500">
                已同步 {syncedCount} 只股票到数据库
              </div>
            )}
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <div className="flex items-center gap-2 rounded-full bg-secondary px-4 py-2">
                <Search className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground">形态匹配</span>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-secondary px-4 py-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground">趋势对比</span>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-secondary px-4 py-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground">多维排序</span>
              </div>
            </div>
          </div>
        </section>

        {/* Dashboard */}
        {targetStock && (
          <section className="px-6 py-6">
            <div className="mx-auto max-w-7xl">
              {/* Chart + Controls row */}
              <div className="flex flex-col gap-5 lg:flex-row lg:h-[560px]">
                {/* Left: Control Panel */}
                <div className="w-full shrink-0 lg:w-[340px] h-auto lg:h-full">
                  <ControlPanel />
                </div>
                {/* Right: Chart area */}
                <div className="flex-1 flex flex-col h-[360px] lg:h-full">
                  {/* Chart 工具条 — 独立在图表外部，避免重叠 */}
                  <div className="mb-3 flex h-10 items-center gap-2.5 rounded-lg border border-border bg-card px-4 text-xs">
                    <span className="text-sm font-semibold text-foreground">{targetStock.name}</span>
                    <span className="tnum text-muted-foreground">({targetStock.code})</span>
                    <span className="h-3.5 w-px bg-border" />
                    <span className="tnum text-muted-foreground">
                      {dateRange.start} ~ {dateRange.end}
                    </span>
                    {selectedCandidate && (
                      <>
                        <span className="h-3.5 w-px bg-border" />
                        <span className="inline-block h-0.5 w-3 rounded-full bg-[#2DD4BF]" />
                        <span className="tnum text-[#2DD4BF]">{selectedCandidate}</span>
                        <span className="text-[10px] text-[#2DD4BF]/70">近期叠加</span>
                      </>
                    )}
                  </div>
                  <StockChart />
                </div>
              </div>

              {/* Results Table */}
              <div className="mt-6">
                <ResultsTable />
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
