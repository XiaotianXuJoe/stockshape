import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Loader2, Search, Filter, CalendarIcon, AlertCircle } from "lucide-react";
import { format, differenceInCalendarDays } from "date-fns";
import { zhCN } from "date-fns/locale";
import PatternSelector from "./PatternSelector";
import StrategyPanel from "./StrategyPanel";

const MAX_DAYS = 1825; // 约5年

/** 统一转换后端返回的分析结果，确保字段类型正确 */
export function normalizeResults(data: any[]) {
  return (data || []).map((r: any) => ({
    ticker: r.ticker || r.code || "",
    code: r.code || r.ticker || "",
    name: r.name || "",
    similarityScore: typeof r.similarityScore === "number" ? r.similarityScore : typeof r.similarity === "number" ? r.similarity : 0,
    reasons: Array.isArray(r.reasons) ? r.reasons : r.reasons ? [String(r.reasons)] : [],
    detailedReasons: Array.isArray(r.detailedReasons) ? r.detailedReasons : [],
    detectedPattern: r.detectedPattern || null,
    volume: typeof r.volume === "number" ? r.volume : 0,
    turnoverRate: typeof r.turnoverRate === "number" ? r.turnoverRate : 0,
    volumeRatio: typeof r.volumeRatio === "number" ? r.volumeRatio : 0,
    sector: r.sector || r.industry || "",
    industry: r.industry || r.sector || "",
    concept: r.concept || "",
    marketCap: typeof r.marketCap === "number" ? r.marketCap : 0,
    change: typeof r.change === "number" ? r.change : 0,
  }));
}

/** 直接 fetch 调用 tRPC mutation 端点（绕过 tRPC client 避免兼容性问题） */
export async function callAnalysisAPI(endpoint: string, body: Record<string, unknown>) {
  const resp = await fetch(`/api/trpc/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: body }),
  });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`无法解析服务器响应: ${text.slice(0, 200)}`);
  }
  if (!resp.ok || data.error) {
    const msg = data.error?.message || data.error?.json?.message || `请求失败 (${resp.status})`;
    throw new Error(msg);
  }
  return data.result?.data?.json;
}

export function ControlPanel() {
  const targetStock = useAppStore((s) => s.targetStock);
  const dateRange = useAppStore((s) => s.dateRange);
  const loading = useAppStore((s) => s.loading);
  const patternMode = useAppStore((s) => s.patternMode);
  const patternFilter = useAppStore((s) => s.patternFilter);

  const setDateRange = useAppStore((s) => s.setDateRange);
  const setResults = useAppStore((s) => s.setResults);
  const setLoading = useAppStore((s) => s.setLoading);
  const setError = useAppStore((s) => s.setError);
  const setSelectedCandidate = useAppStore((s) => s.setSelectedCandidate);
  const setTargetPatterns = useAppStore((s) => s.setTargetPatterns);

  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  const startDateObj = dateRange.start ? new Date(dateRange.start) : undefined;
  const endDateObj = dateRange.end ? new Date(dateRange.end) : undefined;

  const isValidStart = !!startDateObj && !isNaN(startDateObj.getTime());
  const isValidEnd = !!endDateObj && !isNaN(endDateObj.getTime());

  const matchDays = isValidStart && isValidEnd
    ? Math.max(1, differenceInCalendarDays(endDateObj, startDateObj))
    : 0;

  // ── 日期校验 ──
  const isDateInvalid = isValidStart && isValidEnd && startDateObj >= endDateObj;
  const isTooLong = matchDays > MAX_DAYS;
  const dateError = !isValidStart || !isValidEnd
    ? "日期格式无效，请重新选择"
    : isDateInvalid
      ? "开始日期必须早于结束日期，请重新选择"
      : isTooLong
        ? `时间跨度不能超过 ${MAX_DAYS} 天（约5年），请缩短选择范围`
        : null;

  const handleAnalyze = async () => {
    if (!targetStock || dateError) return;
    setLoading(true);
    setError(null);
    setSelectedCandidate(null);

    try {
      if (patternMode) {
        // 形态模式：先检测目标股票形态，再扫描相似股票
        const patternData = await callAnalysisAPI("analysis.detectPatterns", {
          ticker: targetStock.code,
          startDate: dateRange.start,
          endDate: dateRange.end,
        });
        if (patternData?.patterns && patternData.patterns.length > 0) {
          setTargetPatterns(patternData.patterns.map((p: any) => ({
            type: p.type,
            name: p.name,
            confidence: p.confidence,
            signal: p.signal,
            description: p.description,
          })));
        } else {
          setTargetPatterns([]);
        }

        const data = await callAnalysisAPI("analysis.findSimilarStocksWithPatterns", {
          ticker: targetStock.code,
          startDate: dateRange.start,
          endDate: dateRange.end,
          patternFilter: patternFilter.length > 0 ? patternFilter : undefined,
        });

        if (data.error) {
          setError(data.error);
          setResults([]);
        } else {
          const converted = normalizeResults(data.results || data);
          setResults(converted);
          if (converted.length > 0) {
            setSelectedCandidate(converted[0].ticker);
          }
        }
      } else {
        // 基础模式：直接扫描相似股票
        const data = await callAnalysisAPI("analysis.findSimilarStocks", {
          targetTicker: targetStock.code,
          startDate: dateRange.start,
          endDate: dateRange.end,
        });
        const converted = normalizeResults(data.results || []);
        setResults(converted);
        if (converted.length > 0) {
          setSelectedCandidate(converted[0].ticker);
        }
      }
    } catch (err: any) {
      setError(err.message || "分析请求失败");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 lg:h-full lg:overflow-y-auto">
      {/* ── 参数配置（形态模板） ── */}
      <div className="rounded-lg border border-border bg-background/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Filter className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">参数配置</h3>
      </div>

      {/* ── 日期选择器 ── */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          参考形态时间段（历史模板）
        </label>
        <p className="text-[10px] text-muted-foreground/60 leading-tight">
          选择一段历史走势作为形态模板，系统将扫描全市场近期走势与之相似的股票
        </p>

        <div className="flex items-center gap-1.5">
          {/* 开始日期 */}
          <Popover open={startOpen} onOpenChange={setStartOpen}>
            <PopoverTrigger asChild>
              <button
                className={`h-9 flex-1 rounded-lg border px-2.5 text-left text-xs flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-1 focus:ring-primary whitespace-nowrap ${
                  dateError
                    ? "border-red-500/50 bg-red-500/5 text-red-400"
                    : "border-border bg-background text-foreground hover:bg-secondary/30"
                }`}
              >
                <CalendarIcon className={`h-3 w-3 shrink-0 ${dateError ? "text-red-400" : "text-muted-foreground"}`} />
                <span className={dateRange.start ? "" : "text-muted-foreground"}>
                  {isValidStart && startDateObj ? format(startDateObj, "yyyy/MM/dd") : "开始日期"}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-card border-border shadow-xl" align="start">
              <div className="p-3 pb-1">
                <span className="text-sm font-semibold text-foreground">选择开始日期</span>
              </div>
              <Calendar
                mode="single"
                selected={startDateObj}
                onSelect={(date) => {
                  if (date) {
                    setDateRange({ ...dateRange, start: format(date, "yyyy-MM-dd") });
                    setStartOpen(false);
                  }
                }}
                locale={zhCN}
                captionLayout="dropdown"
                fromYear={1990}
                toYear={2030}
                className="[&_.rdp-day_button]:text-foreground [&_.rdp-day_button]:h-9 [&_.rdp-day_button]:w-9 [&_.rdp-day_button]:text-sm"
              />
            </PopoverContent>
          </Popover>

          <span className="text-[10px] text-muted-foreground shrink-0">至</span>

          {/* 结束日期 */}
          <Popover open={endOpen} onOpenChange={setEndOpen}>
            <PopoverTrigger asChild>
              <button
                className={`h-9 flex-1 rounded-lg border px-2.5 text-left text-xs flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-1 focus:ring-primary whitespace-nowrap ${
                  dateError
                    ? "border-red-500/50 bg-red-500/5 text-red-400"
                    : "border-border bg-background text-foreground hover:bg-secondary/30"
                }`}
              >
                <CalendarIcon className={`h-3 w-3 shrink-0 ${dateError ? "text-red-400" : "text-muted-foreground"}`} />
                <span className={dateRange.end ? "" : "text-muted-foreground"}>
                  {isValidEnd && endDateObj ? format(endDateObj, "yyyy/MM/dd") : "结束日期"}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-card border-border shadow-xl" align="end">
              <div className="p-3 pb-1">
                <span className="text-sm font-semibold text-foreground">选择结束日期</span>
              </div>
              <Calendar
                mode="single"
                selected={endDateObj}
                onSelect={(date) => {
                  if (date) {
                    setDateRange({ ...dateRange, end: format(date, "yyyy-MM-dd") });
                    setEndOpen(false);
                  }
                }}
                locale={zhCN}
                captionLayout="dropdown"
                fromYear={1990}
                toYear={2030}
                className="[&_.rdp-day_button]:text-foreground [&_.rdp-day_button]:h-9 [&_.rdp-day_button]:w-9 [&_.rdp-day_button]:text-sm"
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* 日期错误提示 */}
        {dateError && (
          <div className="flex items-center gap-1.5 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{dateError}</span>
          </div>
        )}
      </div>

      {/* ── 形态模板时长 ── */}
      <div className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
        <span className="text-xs text-muted-foreground">形态模板时长</span>
        <span className={`text-xs font-semibold ${dateError ? "text-red-400" : "text-primary"}`}>
          {dateError ? "日期无效" : `${matchDays} 天`}
        </span>
      </div>

      <Button
        onClick={handleAnalyze}
        disabled={!targetStock || loading || !!dateError || !dateRange.start || !dateRange.end}
        className="h-10 w-full gap-2 bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            分析中...
          </>
        ) : (
          <>
            <Search className="h-4 w-4" />
            开始分析
          </>
        )}
      </Button>
      </div>

      {/* ── 形态识别 ── */}
      <PatternSelector />

      {/* ── 策略组合筛选 + 回测 ── */}
      <StrategyPanel />

    </div>
  );
}
