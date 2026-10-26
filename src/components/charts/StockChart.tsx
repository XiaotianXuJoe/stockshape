import { useEffect, useRef, useMemo, useState, useCallback, type MouseEvent as ReactMouseEvent } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
} from "lightweight-charts";
import { useKlineData } from "@/lib/stockApi";
import { useAppStore } from "@/stores/appStore";
import { Loader2, Crop } from "lucide-react";

// ── 显示窗口辅助 ──
const MAX_VIEW_DAYS = 5000; // K线已支持分页加载，放宽到约20年显示窗口

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}
function shiftDays(d: string, n: number): string {
  const t = new Date(d);
  t.setDate(t.getDate() + n);
  return t.toISOString().split("T")[0];
}
function daySpan(a: string, b: string): number {
  return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}
// 显示窗口 = 分析区间向前扩 max(span,120) 天，向后扩 max(span/2,30) 天（不超前于今天）
function computeViewRange(start: string, end: string): { start: string; end: string } {
  const span = Math.max(daySpan(start, end), 30);
  const right = shiftDays(end, Math.max(Math.floor(span / 2), 30));
  return {
    start: shiftDays(start, -Math.max(span, 120)),
    end: right > todayStr() ? todayStr() : right,
  };
}

// ── 分析区间虚线标记（lightweight-charts 自定义 primitive）──
class AnalysisRangePrimitive {
  private _chart: any = null;
  private _d1: string | null = null;
  private _d2: string | null = null;
  private _requestUpdate: (() => void) | null = null;

  attached(param: any) {
    this._chart = param.chart;
    this._requestUpdate = param.requestUpdate || null;
  }
  detached() {
    this._chart = null;
    this._requestUpdate = null;
  }
  setRange(d1: string | null, d2: string | null) {
    this._d1 = d1;
    this._d2 = d2;
    try {
      this._requestUpdate?.();
    } catch { /* ignore */ }
  }
  updateAllViews() { /* 视图无状态，渲染时实时取坐标 */ }
  paneViews() {
    const self = this;
    return [
      {
        renderer: () => ({
          draw: (target: any) => {
            target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: any) => {
              if (!self._chart) return;
              const ts = self._chart.timeScale();
              const x1 = self._d1 ? ts.timeToCoordinate(self._d1) : null;
              const x2 = self._d2 ? ts.timeToCoordinate(self._d2) : null;
              ctx.save();
              if (x1 !== null && x2 !== null) {
                ctx.fillStyle = "rgba(45, 212, 191, 0.045)";
                ctx.fillRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), mediaSize.height);
              }
              ctx.strokeStyle = "rgba(45, 212, 191, 0.85)";
              ctx.lineWidth = 1;
              ctx.setLineDash([6, 4]);
              for (const x of [x1, x2]) {
                if (x === null) continue;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, mediaSize.height);
                ctx.stroke();
              }
              ctx.restore();
            });
          },
        }),
      },
    ];
  }
}

export function StockChart() {
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const topContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const topChartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleRef = useRef<any>(null);
  const volumeRef = useRef<any>(null);
  const lineRef = useRef<any>(null);
  const overlayVolRef = useRef<any>(null);
  const topLineRef = useRef<any>(null);
  const rangePrimRef = useRef<AnalysisRangePrimitive | null>(null);
  const pendingRestoreRef = useRef<{ range: { from: any; to: any }; key: string; ts: number } | null>(null);
  const viewRangeRef = useRef<{ start: string; end: string } | null>(null);
  const dataLenRef = useRef(0);
  const candidateOffsetRef = useRef(0);
  const prevTargetDataRef = useRef<any>(null);
  const noMoreHistoryRef = useRef(false); // 已加载到上市首日，左侧无更早数据
  const prevFirstDateRef = useRef<string | null>(null); // 扩展前的数据首日，用于判断历史是否耗尽
  const dataFirstDateRef = useRef<string | null>(null);

  const targetStock = useAppStore((s) => s.targetStock);
  const dateRange = useAppStore((s) => s.dateRange);

  // ── 显示窗口：独立于分析区间，支持缩放/平移时动态扩展加载 ──
  const [viewRange, setViewRange] = useState(() =>
    computeViewRange(dateRange.start, dateRange.end)
  );
  viewRangeRef.current = viewRange;

  // 股票或分析区间变化时，重置显示窗口
  useEffect(() => {
    noMoreHistoryRef.current = false;
    prevFirstDateRef.current = null;
    setViewRange(computeViewRange(dateRange.start, dateRange.end));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetStock?.code, dateRange.start, dateRange.end]);
  const selectedCandidate = useAppStore((s) => s.selectedCandidate);

  // ── 防御性日期计算 ──
  const recentRange = useMemo(() => {
    try {
      const refS = new Date(dateRange.start);
      const refE = new Date(dateRange.end);
      if (isNaN(refS.getTime()) || isNaN(refE.getTime())) {
        return { start: dateRange.start, end: dateRange.end, error: "无效日期" };
      }
      const refDays = Math.max(1, Math.ceil(
        (refE.getTime() - refS.getTime()) / (1000 * 60 * 60 * 24)
      ));
      const today = new Date();
      const recentEnd = today.toISOString().split("T")[0];
      const rs = new Date(today.getTime() - refDays * 24 * 60 * 60 * 1000);
      const recentStart = isNaN(rs.getTime())
        ? dateRange.start
        : rs.toISOString().split("T")[0];
      return { start: recentStart, end: recentEnd, error: null };
    } catch {
      return { start: dateRange.start, end: dateRange.end, error: "日期计算错误" };
    }
  }, [dateRange.start, dateRange.end]);

  // 主股票 K线查询
  const targetQuery = useKlineData(
    targetStock?.code || "",
    viewRange.start,
    viewRange.end
  );

  // 候选股票 K线查询
  const candidateQuery = useKlineData(
    selectedCandidate || "",
    recentRange.start,
    recentRange.end
  );

  // 判断是否在加载中（更可靠的判断）
  const isMainLoading = (targetQuery.isFetching || targetQuery.isPending) && !targetQuery.data;
  const hasMainData = !!targetQuery.data && targetQuery.data.length > 0;
  const mainError = targetQuery.error;

  const setDateRange = useAppStore((s) => s.setDateRange);

  // ── 框选日期区间 ──
  const [selectMode, setSelectMode] = useState(false);
  const [dragRect, setDragRect] = useState<{ x1: number; x2: number } | null>(null);
  const dragStartX = useRef<number | null>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);

  // 像素 x 坐标 -> K线日期（通过 logical 索引映射到最近交易日）
  const xToDate = useCallback(
    (x: number): string | null => {
      const chart = chartRef.current;
      const data = targetQuery.data;
      if (!chart || !data || data.length === 0) return null;
      const logical = chart.timeScale().coordinateToLogical(x);
      if (logical === null || logical === undefined) return null;
      const idx = Math.max(0, Math.min(data.length - 1, Math.round(logical as number)));
      return data[idx]?.date ?? null;
    },
    [targetQuery.data]
  );

  // ESC 退出框选模式
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectMode(false);
        dragStartX.current = null;
        setDragRect(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectMode]);

  const handleSelectStart = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!selectMode || e.button !== 0) return;
    const rect = chartAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    dragStartX.current = x;
    setDragRect({ x1: x, x2: x });
  };

  const handleSelectMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!selectMode || dragStartX.current === null) return;
    const rect = chartAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    setDragRect({ x1: dragStartX.current, x2: x });
  };

  const handleSelectEnd = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!selectMode || dragStartX.current === null) return;
    const rect = chartAreaRef.current?.getBoundingClientRect();
    const x2 = rect ? Math.max(0, Math.min(rect.width, e.clientX - rect.left)) : dragStartX.current;
    const x1 = dragStartX.current;
    dragStartX.current = null;
    setDragRect(null);
    setSelectMode(false);
    if (Math.abs(x2 - x1) < 8) return; // 误触忽略
    const d1 = xToDate(Math.min(x1, x2));
    const d2 = xToDate(Math.max(x1, x2));
    if (d1 && d2 && d1 < d2) {
      setDateRange({ start: d1, end: d2 });
    }
  };

  const handleSelectCancel = () => {
    dragStartX.current = null;
    setDragRect(null);
  };

  // 拖拽过程中的实时日期标签
  const dragDates = useMemo(() => {
    if (!dragRect) return null;
    const d1 = xToDate(Math.min(dragRect.x1, dragRect.x2));
    const d2 = xToDate(Math.max(dragRect.x1, dragRect.x2));
    return d1 && d2 ? { d1, d2 } : null;
  }, [dragRect, xToDate]);

  // ── 创建/销毁主 chart（只执行一次）──
  useEffect(() => {
    const el = mainContainerRef.current;
    if (!el || chartRef.current) return;

    try {
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
        rightPriceScale: {
          borderColor: "#1E2530",
          scaleMargins: { top: 0.1, bottom: 0.25 },
        },
        leftPriceScale: {
          visible: false,
          borderColor: "#1E2530",
          scaleMargins: { top: 0.1, bottom: 0.25 },
        },
        timeScale: { borderColor: "#1E2530", timeVisible: true },
      });

      candleRef.current = chart.addSeries(CandlestickSeries, {
        upColor: "#22C55E",
        downColor: "#EF4444",
        borderUpColor: "#22C55E",
        borderDownColor: "#EF4444",
        wickUpColor: "#22C55E",
        wickDownColor: "#EF4444",
      });

      volumeRef.current = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "",
      });
      volumeRef.current.priceScale().applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });

      rangePrimRef.current = new AnalysisRangePrimitive();
      candleRef.current.attachPrimitive(rangePrimRef.current);

      chartRef.current = chart;

      // ── 边缘检测：缩放/平移边界钳制 + 左侧动态加载历史K线 ──
      // （订阅放在创建处，确保必然绑定到当前 chart 实例）
      const edgeHandler = () => {
        try {
          if (pendingRestoreRef.current) {
            // 取数失败/超时（React Query会重试较长时间）：20秒后自动解除阻塞，避免边缘处理永久卡死
            if (Date.now() - pendingRestoreRef.current.ts > 20000) {
              pendingRestoreRef.current = null;
            } else {
              return; // 上一次扩展还在取数
            }
          }
          const range = chart.timeScale().getVisibleLogicalRange();
          const len = dataLenRef.current;
          if (!range || len === 0) return;

          // 右边界钳制：最右侧不能超过最新数据日期
          if (range.to > len - 1) {
            const w = range.to - range.from;
            chart.timeScale().setVisibleLogicalRange(
              w >= len - 1 ? { from: 0, to: len - 1 } : { from: len - 1 - w, to: len - 1 }
            );
            return;
          }

          // 左边界
          if (range.from < 5) {
            if (noMoreHistoryRef.current) {
              // 历史已耗尽（到达上市首日）：钳制，不允许继续向左滑出空白
              if (range.from < 0) {
                const w = range.to - range.from;
                chart.timeScale().setVisibleLogicalRange(
                  w >= len - 1 ? { from: 0, to: len - 1 } : { from: 0, to: w }
                );
              }
              return;
            }
            // 向左扩展加载更早的历史K线
            setViewRange((v) => {
              const ns = shiftDays(v.start, -180);
              if (daySpan(ns, v.end) > MAX_VIEW_DAYS) {
                noMoreHistoryRef.current = true; // 到达显示窗口上限，按耗尽处理
                return v;
              }
              const saved = chart.timeScale().getVisibleRange();
              if (!saved) return v;
              prevFirstDateRef.current = dataFirstDateRef.current;
              pendingRestoreRef.current = { range: saved, key: ns, ts: Date.now() };
              return { ...v, start: ns };
            });
          }
        } catch { /* ignore */ }
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(edgeHandler);

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
        try {
          chart.timeScale().unsubscribeVisibleLogicalRangeChange(edgeHandler);
        } catch { /* ignore */ }
        chart.remove();
        chartRef.current = null;
        rangePrimRef.current = null;
        candleRef.current = null;
        volumeRef.current = null;
        lineRef.current = null;
        overlayVolRef.current = null;
      };
    } catch (err) {
      console.error("[StockChart] chart creation error:", err);
    }
  }, []);

  // ── 创建/销毁顶部日期轴 chart ──
  useEffect(() => {
    if (!selectedCandidate) {
      if (topChartRef.current) {
        topChartRef.current.remove();
        topChartRef.current = null;
        topLineRef.current = null;
      }
      return;
    }

    const el = topContainerRef.current;
    if (!el || topChartRef.current) return;

    try {
      const chart = createChart(el, {
        width: el.clientWidth || 400,
        height: 26,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#2DD4BF",
          fontSize: 10,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { visible: false },
        },
        crosshair: {
          mode: 0,
          vertLine: { visible: false },
          horzLine: { visible: false },
        },
        rightPriceScale: { visible: false },
        leftPriceScale: { visible: false },
        timeScale: {
          borderColor: "transparent",
          timeVisible: true,
        },
        handleScroll: false,
        handleScale: false,
      });

      topLineRef.current = chart.addSeries(LineSeries, {
        color: "transparent",
        lineWidth: 0,
        lastValueVisible: false,
        priceLineVisible: false,
      });

      topChartRef.current = chart;

      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width } = entry.contentRect;
          if (width > 0 && topChartRef.current) {
            topChartRef.current.applyOptions({ width });
          }
        }
      });
      ro.observe(el);

      return () => {
        ro.disconnect();
        chart.remove();
        topChartRef.current = null;
        topLineRef.current = null;
      };
    } catch (err) {
      console.error("[StockChart] top chart creation error:", err);
    }
  }, [selectedCandidate]);

  // ── 同步主 chart 与顶部 chart 的可见范围 ──
  useEffect(() => {
    const mainChart = chartRef.current;
    const topChart = topChartRef.current;
    if (!mainChart || !topChart) return;

    const handler = () => {
      try {
        const range = mainChart.timeScale().getVisibleLogicalRange();
        if (range) {
          const off = candidateOffsetRef.current;
          topChart.timeScale().setVisibleLogicalRange({
            from: range.from - off,
            to: range.to - off,
          } as any);
        }
      } catch {
        // ignore
      }
    };

    mainChart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    handler();

    return () => {
      try {
        mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
      } catch {
        // ignore
      }
    };
  }, [selectedCandidate]);


  // ── 数据更新：只更新 series 数据，不重建 chart ──
  useEffect(() => {
    const chart = chartRef.current;
    const data = targetQuery.data;
    if (!chart || !data || data.length === 0) return;

    try {
      // 更新主 K 线
      candleRef.current?.setData(
        data.map((d) => ({
          time: d.date,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        }))
      );

      volumeRef.current?.setData(
        data.map((d) => ({
          time: d.date,
          value: d.volume,
          color: d.close >= d.open ? "#22C55E50" : "#EF444450",
        }))
      );

      dataLenRef.current = data.length;
      dataFirstDateRef.current = data[0].date;

      // 分析区间在显示数据中的起止索引（虚线标记 & 候选对齐用）
      const j0raw = data.findIndex((d) => d.date >= dateRange.start);
      const j0 = j0raw >= 0 ? j0raw : 0;
      const j1raw = data.findIndex((d) => d.date > dateRange.end);
      const j1 = j1raw > 0 ? j1raw - 1 : data.length - 1;
      candidateOffsetRef.current = j0;

      // 更新分析区间虚线
      rangePrimRef.current?.setRange(dateRange.start, dateRange.end);

      // 候选叠加线
      const candData = candidateQuery.data;
      const hasCandidate = !!selectedCandidate && !!candData && candData.length > 0;

      if (hasCandidate) {
        const minLen = Math.min(data.length - j0, candData.length);

        if (!lineRef.current) {
          lineRef.current = chart.addSeries(LineSeries, {
            color: "#2DD4BF",
            lineWidth: 2,
            priceScaleId: "left",
          });
        }
        lineRef.current.setData(
          candData.slice(0, minLen).map((d, i) => ({
            time: data[j0 + i].date,
            value: d.close,
          }))
        );

        const avgTargetVol =
          data.slice(j0, j0 + minLen).reduce((sum, d) => sum + d.volume, 0) / minLen;
        const avgCandVol =
          candData
            .slice(0, minLen)
            .reduce((sum, d) => sum + d.volume, 0) / minLen;
        const volScale = avgTargetVol / Math.max(avgCandVol, 1);

        if (!overlayVolRef.current) {
          overlayVolRef.current = chart.addSeries(HistogramSeries, {
            priceFormat: { type: "volume" },
            priceScaleId: "overlay-vol",
          });
          overlayVolRef.current.priceScale().applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
          });
        }
        overlayVolRef.current.setData(
          candData.slice(0, minLen).map((d, i) => ({
            time: data[j0 + i].date,
            value: Math.round(d.volume * volScale),
            color: "#2DD4BF35",
          }))
        );

        chart.applyOptions({
          leftPriceScale: { visible: true },
        });

        // 更新顶部日期轴数据（候选真实日期）
        const topChart = topChartRef.current;
        if (topChart && topLineRef.current) {
          topLineRef.current.setData(
            candData.slice(0, minLen).map((d) => ({
              time: d.date,
              value: 0,
            }))
          );
        }
      } else {
        // 移除候选线
        if (lineRef.current) {
          try {
            chart.removeSeries(lineRef.current);
          } catch {
            /* ignore */
          }
          lineRef.current = null;
        }
        if (overlayVolRef.current) {
          try {
            chart.removeSeries(overlayVolRef.current);
          } catch {
            /* ignore */
          }
          overlayVolRef.current = null;
        }
        chart.applyOptions({
          leftPriceScale: { visible: false },
        });

        // 清空顶部 chart 数据
        if (topLineRef.current) {
          try {
            topLineRef.current.setData([]);
          } catch {
            /* ignore */
          }
        }
      }

      // ── 视野控制 ──
      const targetChanged = prevTargetDataRef.current !== data;
      prevTargetDataRef.current = data;

      if (
        pendingRestoreRef.current &&
        viewRangeRef.current &&
        viewRangeRef.current.start === pendingRestoreRef.current.key
      ) {
        // 边缘扩展加载完成：恢复用户之前的视野（按时间锚定，内容不跳动）
        const saved = pendingRestoreRef.current.range;
        pendingRestoreRef.current = null;
        // 扩展后数据首日没有变得更早 → 已到达上市日期，停止后续扩展
        if (prevFirstDateRef.current && data[0].date >= prevFirstDateRef.current) {
          noMoreHistoryRef.current = true;
        }
        prevFirstDateRef.current = null;
        try {
          chart.timeScale().setVisibleRange(saved);
        } catch {
          chart.timeScale().fitContent();
        }
      } else if (pendingRestoreRef.current) {
        // 非本次扩展的数据返回：丢弃过期的恢复标记，不动视野
        pendingRestoreRef.current = null;
      } else if (targetChanged) {
        // 新股票/新分析区间：聚焦分析窗口（两侧留少量余量）
        const pad = Math.max(Math.round((j1 - j0) * 0.08), 3);
        chart.timeScale().setVisibleLogicalRange({ from: j0 - pad, to: j1 + pad });
      }
      // 仅候选叠加更新：保持用户当前视野不变
    } catch (err) {
      console.error("[StockChart] data update error:", err);
    }
  }, [targetQuery.data, candidateQuery.data, selectedCandidate, dateRange.start, dateRange.end]);

  if (!targetStock) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-border bg-card">
        <p className="text-lg font-medium text-muted-foreground">
          请先选择一只股票
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full rounded-xl border border-border bg-[#0B0E11] overflow-hidden">
      {/* 框选日期按钮 */}
      {hasMainData && (
        <button
          onClick={() => setSelectMode((v) => !v)}
          className={`absolute right-3 top-2 z-20 flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
            selectMode
              ? "border-[#2DD4BF] bg-[#2DD4BF]/20 text-[#2DD4BF]"
              : "border-border bg-[#14181F] text-muted-foreground hover:text-foreground hover:border-[#2DD4BF]/50"
          }`}
          title="在K线图上按住左键拖拽框选一段区间，自动设为分析日期范围"
        >
          <Crop className="h-3.5 w-3.5" />
          {selectMode ? "取消框选" : "框选日期"}
        </button>
      )}

      <div className="flex flex-col h-full w-full">
        <div
          ref={topContainerRef}
          className={`w-full transition-all duration-200 overflow-hidden pointer-events-none ${
            selectedCandidate ? "h-[26px]" : "h-0"
          }`}
        />
        <div ref={chartAreaRef} className="relative flex-1 w-full">
          <div ref={mainContainerRef} className="h-full w-full" />

          {/* 框选日期覆盖层 */}
          {selectMode && hasMainData && (
            <div
              className="absolute inset-0 z-10 cursor-crosshair select-none"
              onMouseDown={handleSelectStart}
              onMouseMove={handleSelectMove}
              onMouseUp={handleSelectEnd}
              onMouseLeave={handleSelectCancel}
            >
              <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-[#0B0E11]/85 px-2 py-1 text-[10px] text-[#2DD4BF]">
                按住左键拖拽框选日期区间，松开确认，ESC 取消
              </div>
              {dragRect && (
                <>
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 border-x border-[#2DD4BF] bg-[#2DD4BF]/15"
                    style={{
                      left: Math.min(dragRect.x1, dragRect.x2),
                      width: Math.abs(dragRect.x2 - dragRect.x1),
                    }}
                  />
                  {dragDates && (
                    <div
                      className="pointer-events-none absolute top-2 whitespace-nowrap rounded bg-[#2DD4BF] px-2 py-0.5 text-[10px] font-medium text-[#0B0E11]"
                      style={{
                        left: Math.max(
                          4,
                          Math.min(dragRect.x1, dragRect.x2) +
                            Math.abs(dragRect.x2 - dragRect.x1) / 2 -
                            80
                        ),
                      }}
                    >
                      {dragDates.d1} ~ {dragDates.d2}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Loading 覆盖层 — 关键修复：使用 isMainLoading 替代 isLoading */}
      {isMainLoading && !recentRange.error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0B0E11]/90 gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">正在加载 K 线数据...</span>
        </div>
      )}

      {/* 错误覆盖层 */}
      {mainError && !isMainLoading && !recentRange.error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0B0E11] gap-2">
          <span className="text-sm text-red-400">数据加载失败</span>
          <span className="text-xs text-muted-foreground">
            {mainError.message}
          </span>
        </div>
      )}

      {/* 日期错误覆盖层 */}
      {recentRange.error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0B0E11] gap-2">
          <span className="text-sm text-red-400">{recentRange.error}</span>
          <span className="text-xs text-muted-foreground">
            请检查日期选择是否正确
          </span>
        </div>
      )}

      {/* 暂无数据覆盖层 — 关键修复：只在非 loading 且确实没有数据时显示 */}
      {!hasMainData && !isMainLoading && !mainError && !recentRange.error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0B0E11] gap-2">
          <span className="text-sm text-muted-foreground">暂无数据</span>
          <span className="text-xs text-muted-foreground/60">
            {dateRange.start} ~ {dateRange.end}
          </span>
        </div>
      )}
    </div>
  );
}
