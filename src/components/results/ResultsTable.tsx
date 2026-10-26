import { useState, useEffect, useRef } from "react";
import { useAppStore } from "@/stores/appStore";
import { useKlineData } from "@/lib/stockApi";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronUp, BarChart3, Percent, Droplets, Loader2, ArrowUpDown, Filter } from "lucide-react";
import { createChart, CandlestickSeries, HistogramSeries, ColorType } from "lightweight-charts";

const sectors = [
  "all",
  "电子", "计算机", "通信", "医药", "汽车", "机械设备",
  "电力设备", "化工", "有色金属", "军工", "环保", "家电",
  "半导体", "消费电子", "光学光电子", "软件开发", "IT服务Ⅱ",
  "通信设备", "汽车零部件", "专用设备", "电池", "光伏设备",
  "化学制药", "生物制品", "医疗器械", "医疗服务",
];

export function ResultsTable() {
  const getSortedResults = useAppStore((s) => s.getSortedResults);
  const selectedCandidate = useAppStore((s) => s.selectedCandidate);
  const setSelectedCandidate = useAppStore((s) => s.setSelectedCandidate);
  const loading = useAppStore((s) => s.loading);
  const error = useAppStore((s) => s.error);
  const sortBy = useAppStore((s) => s.sortBy);
  const sortOrder = useAppStore((s) => s.sortOrder);
  const filterSector = useAppStore((s) => s.filterSector);
  const filterMarketCap = useAppStore((s) => s.filterMarketCap);
  const setSortBy = useAppStore((s) => s.setSortBy);
  const setSortOrder = useAppStore((s) => s.setSortOrder);
  const setFilterSector = useAppStore((s) => s.setFilterSector);
  const setFilterMarketCap = useAppStore((s) => s.setFilterMarketCap);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const results = getSortedResults();

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">正在扫描全市场相似形态...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-card p-8 text-center">
        <p className="text-sm text-red-400">分析出错: {error}</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">
          暂无分析结果，请选择股票并点击「开始分析」
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">相似股票分析结果</h3>
        <p className="text-xs text-muted-foreground mt-0.5">共找到 {results.length} 只相似股票</p>
      </div>

      {/* ── 筛选栏（独立在表格上方，避免与ControlPanel重叠） ── */}
      <div className="px-5 py-3 border-b border-border bg-secondary/20">
        <div className="flex flex-wrap items-center gap-3">
          {/* 排序 */}
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="h-8 w-32 bg-background border-border text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="similarity">相似度得分</SelectItem>
                <SelectItem value="volume">成交量</SelectItem>
                <SelectItem value="turnoverRate">换手率</SelectItem>
                <SelectItem value="volumeRatio">量比</SelectItem>
                <SelectItem value="marketCap">市值</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
              className="h-8 px-2 border-border bg-background text-foreground hover:bg-secondary text-xs"
            >
              {sortOrder === "desc" ? "降序" : "升序"}
            </Button>
          </div>

          <div className="h-5 w-px bg-border" />

          {/* 板块筛选 */}
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <Select value={filterSector} onValueChange={setFilterSector}>
              <SelectTrigger className="h-8 w-36 bg-background border-border text-xs">
                <SelectValue placeholder="全部板块" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border max-h-60">
                <SelectItem value="all">全部板块</SelectItem>
                {sectors.filter((s) => s !== "all").map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="h-5 w-px bg-border" />

          {/* 市值范围 */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground shrink-0">市值(亿):</span>
            <input
              type="number"
              min={0}
              placeholder="最小"
              value={filterMarketCap.min ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setFilterMarketCap({ ...filterMarketCap, min: v === "" ? null : Number(v) });
              }}
              className="h-8 w-16 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-xs text-muted-foreground">—</span>
            <input
              type="number"
              min={0}
              placeholder="最大"
              value={filterMarketCap.max ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setFilterMarketCap({ ...filterMarketCap, max: v === "" ? null : Number(v) });
              }}
              className="h-8 w-16 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {/* 市值快捷按钮 */}
            {[
              { label: "<100亿", min: 0, max: 100 },
              { label: "100-500亿", min: 100, max: 500 },
              { label: "500-1000亿", min: 500, max: 1000 },
              { label: ">1000亿", min: 1000, max: null },
            ].map((preset) => {
              const isActive = filterMarketCap.min === preset.min && filterMarketCap.max === preset.max;
              return (
                <Button
                  key={preset.label}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  className={`h-6 px-2 text-[10px] ${isActive ? "bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-secondary/50"}`}
                  onClick={() => setFilterMarketCap(isActive ? { min: null, max: null } : { min: preset.min, max: preset.max })}
                >
                  {preset.label}
                </Button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent [&>th]:whitespace-nowrap [&>th]:py-3">
              <TableHead className="text-xs text-muted-foreground w-12">排名</TableHead>
              <TableHead className="text-xs text-muted-foreground">股票</TableHead>
              <TableHead className="text-xs text-muted-foreground text-right">相似度</TableHead>
              <TableHead className="text-xs text-muted-foreground">板块</TableHead>
              <TableHead className="text-xs text-muted-foreground text-right">成交量</TableHead>
              <TableHead className="text-xs text-muted-foreground text-right">换手率</TableHead>
              <TableHead className="text-xs text-muted-foreground text-right">量比</TableHead>
              <TableHead className="text-xs text-muted-foreground">原因</TableHead>
              <TableHead className="text-xs text-muted-foreground w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((stock, index) => (
              <RowWithExpand
                key={stock.ticker}
                stock={stock}
                index={index}
                isExpanded={expandedRow === stock.ticker}
                isSelected={selectedCandidate === stock.ticker}
                onToggleExpand={() =>
                  setExpandedRow(expandedRow === stock.ticker ? null : stock.ticker)
                }
                onSelect={() => setSelectedCandidate(stock.ticker)}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface RowWithExpandProps {
  stock: {
    ticker: string;
    name: string;
    similarityScore: number;
    sector: string;
    industry: string;
    concept: string;
    volume: number;
    turnoverRate: number;
    volumeRatio: number;
    reasons: string[];
    detailedReasons: { dimension: string; description: string }[];
  };
  index: number;
  isExpanded: boolean;
  isSelected: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
}

function RowWithExpand({
  stock,
  index,
  isExpanded,
  isSelected,
  onToggleExpand,
  onSelect,
}: RowWithExpandProps) {
  return (
    <>
      {/* Main data row */}
      <TableRow
        className={`border-border cursor-pointer transition-colors ${
          isSelected ? "bg-primary/10" : "hover:bg-secondary/50"
        }`}
        onClick={onSelect}
      >
        <TableCell className="text-xs font-medium text-muted-foreground">{index + 1}</TableCell>
        <TableCell>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">{stock.name}</span>
            <span className="text-xs text-muted-foreground">{stock.ticker}</span>
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex flex-col items-end gap-1">
            <span className={`tnum text-sm font-bold ${stock.similarityScore >= 80 ? "text-primary" : stock.similarityScore >= 60 ? "text-yellow-400" : "text-muted-foreground"}`}>
              {stock.similarityScore}
            </span>
            <div className="h-1 w-12 overflow-hidden rounded-full bg-secondary">
              <div
                className={`h-full rounded-full ${stock.similarityScore >= 80 ? "bg-primary" : stock.similarityScore >= 60 ? "bg-yellow-400" : "bg-muted-foreground"}`}
                style={{ width: `${Math.min(100, stock.similarityScore)}%` }}
              />
            </div>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-1">
            <Badge variant="secondary" className="text-xs bg-secondary text-muted-foreground w-fit">
              {stock.sector || stock.industry || "—"}
            </Badge>
            {stock.concept && (
              <span className="text-[10px] text-muted-foreground/70 truncate max-w-[160px]" title={stock.concept}>
                {stock.concept}
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="tnum text-xs text-foreground">{(stock.volume / 10000).toFixed(0)}万</span>
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <Percent className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="tnum text-xs text-foreground">{stock.turnoverRate.toFixed(2)}%</span>
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <Droplets className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="tnum text-xs text-foreground">{stock.volumeRatio.toFixed(2)}</span>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {stock.reasons.slice(0, 2).map((reason, i) => (
              <Badge key={i} variant="outline" className="text-xs border-primary/30 text-primary">{reason}</Badge>
            ))}
          </div>
        </TableCell>
        <TableCell>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="rounded p-1 hover:bg-secondary transition-colors"
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-primary" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </TableCell>
      </TableRow>

      {/* Expanded detail row — inline, right below the clicked row */}
      {isExpanded && (
        <TableRow className="border-0 hover:bg-transparent">
          <TableCell colSpan={9} className="p-0">
            <div className="border-t border-border bg-secondary/20 animate-in slide-in-from-top-1 duration-200">
              {/* Chart area */}
              <div className="h-[320px] border-b border-border">
                <ExpandedRowChart ticker={stock.ticker} name={stock.name} />
              </div>
              {/* Detail reasons */}
              <div className="p-4">
                <h4 className="mb-3 text-sm font-semibold text-foreground">
                  {stock.name}（{stock.ticker}）近期走势 · 相似度分析详情
                </h4>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {stock.detailedReasons.map((reason, i) => (
                    <div key={i} className="rounded-lg border border-border bg-card p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-primary" />
                        <span className="text-xs font-semibold text-primary">{reason.dimension}</span>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">{reason.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function ExpandedRowChart({ ticker, name }: { ticker: string; name: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const trackedSeriesRef = useRef<unknown[]>([]);

  // ── 计算与参考时间段等长的"近期"时间段 ──
  const dateRange = useAppStore((s) => s.dateRange);
  const refStart = new Date(dateRange.start);
  const refEnd = new Date(dateRange.end);
  const refDays = Math.ceil(
    (refEnd.getTime() - refStart.getTime()) / (1000 * 60 * 60 * 24)
  );
  const today = new Date();
  const recentEnd = today.toISOString().split("T")[0];
  const recentStart = new Date(
    today.getTime() - refDays * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .split("T")[0];

  const dataQuery = useKlineData(ticker, recentStart, recentEnd);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const rect = el.getBoundingClientRect();

    const chart = createChart(el, {
      width: Math.max(rect.width, 400),
      height: Math.max(rect.height, 300),
      layout: {
        background: { type: ColorType.Solid, color: "#0B0E11" },
        textColor: "#8B9DB0",
        fontSize: 12,
      },
      grid: {
        vertLines: { color: "#1E2530" },
        horzLines: { color: "#1E2530" },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: "#2DD4BF", width: 1, style: 2 },
        horzLine: { color: "#2DD4BF", width: 1, style: 2 },
      },
      rightPriceScale: { borderColor: "#1E2530", scaleMargins: { top: 0.1, bottom: 0.25 } },
      timeScale: { borderColor: "#1E2530", timeVisible: false },
    });
    chartRef.current = chart;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && chartRef.current) {
          chartRef.current.applyOptions({ width, height });
        }
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      trackedSeriesRef.current = [];
    };
  }, [ticker]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !dataQuery.data || dataQuery.data.length === 0) return;

    try {
      // Remove all tracked series first
      trackedSeriesRef.current.forEach((s) => {
        try { chart.removeSeries(s as Parameters<typeof chart.removeSeries>[0]); } catch { /* ignore */ }
      });
      trackedSeriesRef.current = [];

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#22C55E",
        downColor: "#EF4444",
        borderUpColor: "#22C55E",
        borderDownColor: "#EF4444",
        wickUpColor: "#22C55E",
        wickDownColor: "#EF4444",
      });
      trackedSeriesRef.current.push(candleSeries);

      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "",
      });
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
      trackedSeriesRef.current.push(volumeSeries);

      candleSeries.setData(
        dataQuery.data.map((d) => ({
          time: d.date,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        }))
      );

      volumeSeries.setData(
        dataQuery.data.map((d) => ({
          time: d.date,
          value: d.volume,
          color: d.close >= d.open ? "#22C55E80" : "#EF444480",
        }))
      );

      chart.timeScale().fitContent();
    } catch (err) {
      console.error("ExpandedRowChart data error:", err);
    }
  }, [dataQuery.data]);

  if (dataQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-[#0B0E11]">
      <div className="absolute left-3 top-2 z-10 pointer-events-none">
        <span className="text-xs font-semibold text-[#E1E8ED]">{name}</span>
        <span className="ml-1 text-xs text-[#8B9DB0]">({ticker})</span>
        <span className="ml-2 text-[10px] text-[#2DD4BF]/70">近期走势</span>
      </div>
      {/* 纵轴单位标注 */}
      <div className="absolute right-1 top-2 z-10 pointer-events-none">
        <span className="text-[10px] text-[#8B9DB0]/60">价格(元)</span>
      </div>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
