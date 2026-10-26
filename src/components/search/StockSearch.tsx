import { useState, useRef, useEffect, useCallback } from "react";
import { Search, Loader2, ChevronDown } from "lucide-react";
import { useAppStore } from "@/stores/appStore";

export function StockSearch() {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [localResults, setLocalResults] = useState<any[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const setTargetStock = useAppStore((s) => s.setTargetStock);
  const targetStock = useAppStore((s) => s.targetStock);

  // 使用原生fetch调用后端API
  useEffect(() => {
    if (query.trim().length < 1) {
      setLocalResults([]);
      setLocalError(null);
      return;
    }
    
    setLocalLoading(true);
    setLocalError(null);
    
    const encodedInput = encodeURIComponent(JSON.stringify({ json: { query: query.trim() } }));
    fetch(`/api/trpc/stock.search?input=${encodedInput}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        setLocalResults(data.result?.data?.json ?? []);
        setLocalLoading(false);
      })
      .catch(err => {
        console.error("[StockSearch] fetch error:", err);
        setLocalError(err.message);
        setLocalLoading(false);
      });
  }, [query]);

  const results = localResults;

  useEffect(() => {
    setHighlightedIndex(0);
  }, [results.length]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = useCallback(
    (stock: { code: string; name: string; pinyin: string; market: string }) => {
      console.log("[StockSearch] handleSelect called:", stock);
      setTargetStock(stock);
      setQuery(stock.name);
      setIsOpen(false);
    },
    [setTargetStock]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < results.length - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : results.length - 1
        );
        break;
      case "Enter":
        e.preventDefault();
        if (results.length > 0 && highlightedIndex >= 0) {
          handleSelect(results[highlightedIndex]);
        }
        break;
      case "Escape":
        setIsOpen(false);
        inputRef.current?.blur();
        break;
    }
  };

  const showDropdown = isOpen && query.length >= 1;

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="输入股票代码、名称或拼音..."
          className="h-14 w-full rounded-xl border border-border bg-card pl-12 pr-10 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all"
          autoComplete="off"
        />
        {localLoading ? (
          <Loader2 className="absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : (
          <ChevronDown
            className={`absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground transition-transform cursor-pointer ${showDropdown ? "rotate-180" : ""}`}
            onClick={() => {
              setIsOpen(!isOpen);
              inputRef.current?.focus();
            }}
          />
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute top-full z-50 mt-2 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden">
          {localLoading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">搜索中...</span>
            </div>
          ) : localError ? (
            <div className="px-4 py-6 text-center text-sm text-red-500">
              搜索出错: {localError}
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              未找到匹配的股票
            </div>
          ) : (
            <ul className="py-1 max-h-72 overflow-y-auto">
              {results.map((stock, index) => (
                <li
                  key={stock.code}
                  onClick={() => handleSelect(stock)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`flex cursor-pointer items-center justify-between px-4 py-2.5 transition-colors ${
                    index === highlightedIndex
                      ? "bg-primary/10"
                      : "hover:bg-secondary"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {stock.code}
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {stock.name}
                    </span>
                    <span className="text-xs text-muted-foreground/60">
                      {stock.pinyin}
                    </span>
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      stock.market === "SH"
                        ? "bg-red-500/10 text-red-500"
                        : "bg-blue-500/10 text-blue-500"
                    }`}
                  >
                    {stock.market === "SH" ? "上证" : "深证"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Selected stock indicator */}
      {targetStock && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-secondary px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            当前选中:
          </span>
          <span className="text-sm font-semibold text-foreground">
            {targetStock.name}
          </span>
          <span className="text-xs text-muted-foreground">
            ({targetStock.code})
          </span>
        </div>
      )}
    </div>
  );
}
