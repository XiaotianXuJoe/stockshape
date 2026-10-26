# StockShape 项目记忆文档

创建日期：2026-05-02 | 项目路径：`/mnt/agents/output/app` | 用途：新会话接续上下文

---

## 一、服务器部署信息

| 项目 | 详情 |
|------|------|
| **服务器IP** | `175.178.16.78` |
| **服务商** | 腾讯云 |
| **SSH** | `ubuntu` / `[已移除的服务器密码]`，端口22已放行 |
| **后端服务** | `http://175.178.16.78:3000`，端口3000已放行 |
| **Node.js** | v20.x |
| **数据库** | SQLite `~/app/data/stockshape.db` |

### 常用命令
```bash
ssh ubuntu@175.178.16.78   # 密码 [已移除的服务器密码]
cd ~/app && npm run start    # 启动后端
sqlite3 ~/app/data/stockshape.db "SELECT count(*) FROM stocks;"
```

---

## 二、技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite 6 |
| 样式 | Tailwind CSS |
| 状态管理 | Zustand（`src/stores/appStore.ts`） |
| 前后端通信 | tRPC v11 + `@trpc/react-query` |
| 图表 | ECharts 5 |
| 后端HTTP | Hono |
| 数据库 | SQLite + better-sqlite3 |
| ORM | Drizzle ORM |
| 代理 | undici ProxyAgent（Node 20内置） |

---

## 三、关键目录

```
src/components/search/StockSearch.tsx    # 股票搜索组件（前端）
src/components/chart/StockChart.tsx      # K线图表组件（前端）
src/hooks/useKlineData.ts                # 腾讯K线API调用（纯前端）
src/providers/trpc.ts                    # tRPC客户端配置
src/stores/appStore.ts                   # Zustand全局状态
src/lib/fallbackStocks.ts                # 84只热门股后备列表
api/routes/stock.ts                      # tRPC端点定义
api/lib/stockData.ts                     # 搜索/历史数据核心逻辑
api/lib/proxyFetch.ts                   # 代理感知fetch
api/queries/connection.ts               # SQLite连接（自动建表）
vite.config.ts                           # Vite配置（关键修复点！）
```

---

## 四、核心架构

### 搜索流程
```
用户输入 → StockSearch.tsx → trpc.stock.search.useQuery()
→ 后端searchStocks():
   1. 查SQLite（code/name/pinyin模糊匹配）
   2. 无结果 → 调东方财富搜索API兜底
```

### K线数据流
```
StockChart.tsx → useKlineData hook
→ 纯前端直接调腾讯K线API (web.ifzq.gtimg.cn)
→ 无CORS限制，返回qfqday前复权数据
```

### 候选池
```
getCandidateStocks() → 先读数据库stocks表 → 空则fallback到84只热门股
```

---

## 五、已解决的核心问题（必读）

### 问题1：vite.config.ts `@` 别名覆盖 `@trpc` 包（最严重，已修复）
- **现象**：前端白屏，`@trpc/react-query` 未被正确打包
- **根因**：`"@": path.resolve(__dirname, "./src")` 把 `@trpc` 解析成 `./src/trpc`
- **修复**：改用数组格式正则匹配 `find: /^@\//, replacement: ...`，只匹配 `@/` 路径别名
- **文件**：`vite.config.ts`

### 问题2：修改结束日期后黑屏（已修复）
- **根因**：React Query状态切换时isLoading判断导致覆盖层混乱
- **修复**：使用 `isFetching || isPending` 替代 `isLoading`，四层覆盖层严格分离：loading / error / dateError / noData
- **文件**：`src/components/chart/StockChart.tsx`

### 问题3：双横轴显示（已完成）
- 上方候选股票真实日期轴
- 下方主股票历史模板日期轴

---

## 六、当前状态与已知问题

| 项目 | 状态 |
|------|------|
| 搜索功能（84只热门股） | ✅ 正常 |
| K线图显示 | ✅ 正常 |
| 结束日期切换 | ✅ 不黑屏 |
| 双横轴 | ✅ 正常 |
| 东方财富API从腾讯云IP访问 | ❌ 被限制（ECONNREFUSED） |
| 全A股5000+搜索 | ⚠️ 需配置代理后才能同步 |

### 东方财富API限制
- `searchapi.eastmoney.com` 和 `push2.eastmoney.com` 从腾讯云IP访问被拒绝
- 搜索时数据库优先，所以84只热门股可正常搜
- 小众股票（如北方长龙301357.SZ）不在84只列表中，且API受限，所以搜不到

---

## 七、扩展全A股搜索的方案

| 方案 | 操作 | 成本 |
|------|------|------|
| A. HTTP代理 | 买国内代理，服务器设 `HTTP_PROXY=http://...` 环境变量后重启 | ~5-10元/月 |
| B. 前端同步 | 浏览器端（无IP限制）调东方财富API，通过tRPC `bulkInsert` 端点批量写入数据库 | 免费 |
| C. 维持现状 | 84只热门股覆盖主流蓝筹 | 免费 |

---

## 八、关键代码片段速查

### 后端tRPC端点（`api/routes/stock.ts`）
```typescript
// 已有端点：
stock.search       → searchStocks()          # 双路搜索
stock.getInfo      → getStockInfo()          # 股票信息
stock.getHistoricalData → getHistoricalData() # 历史K线
stock.count        → 返回数据库股票总数
stock.bulkInsert   → 批量插入股票（用于前端同步全A股）
```

### 代理配置（`api/lib/proxyFetch.ts`）
```typescript
// 自动读取 HTTP_PROXY / HTTPS_PROXY 环境变量
// Node 20+ 使用 undici 内置 ProxyAgent
// 未配置代理时直接走正常 fetch
```

### 腾讯K线URL格式
```
https://web.ifzq.gtimg.cn/appstock/app/fqkline/get
  ?param={sh/sz}000001,day,{startDate},{endDate},{limit},qfq
```

### 东方财富搜索URL格式
```
https://searchapi.eastmoney.com/api/suggest/get
  ?input={query}&type=14&count=15
```

### 东方财富全A股列表URL格式
```
https://push2.eastmoney.com/api/qt/clist/get
  ?pn=1&pz=5000&po=1&np=1&fltt=2&invt=2&fid=f12&fs={市场参数}&fields=f12,f13,f14,f18
```

---

## 九、数据库表结构

```sql
-- 股票基础信息表
CREATE TABLE stocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,      -- e.g. "000001.SZ"
  name TEXT NOT NULL,              -- e.g. "平安银行"
  pinyin TEXT,                     -- e.g. "pinganyinhang"
  sector TEXT,                     -- 行业
  market TEXT NOT NULL,            -- "SH" or "SZ"
  market_cap REAL,
  latest_price REAL,
  change_percent REAL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 股价历史数据表
CREATE TABLE stock_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL, high REAL, low REAL, close REAL,
  volume REAL, turnover_rate REAL, volume_ratio REAL
);
CREATE UNIQUE INDEX idx_prices_code_date ON stock_prices(code, date);

-- 分析结果表
CREATE TABLE analysis_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_code TEXT NOT NULL,       -- 主股票
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  match_days INTEGER NOT NULL,
  candidate_code TEXT NOT NULL,    -- 候选股票
  candidate_name TEXT,
  similarity_score REAL,
  reasons TEXT,
  sector TEXT,
  volume REAL, turnover_rate REAL, volume_ratio REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## 十、接续开发检查清单

在新会话中打开本项目后，建议按以下顺序恢复上下文：

1. ✅ 读取本记忆文档（当前文件）
2. ✅ 检查服务器后端是否在运行（`curl http://175.178.16.78:3000/api/trpc/stock.count`）
3. ✅ 如未运行，SSH登录启动：`cd ~/app && npm run start`
4. ✅ 查看 `vite.config.ts` 确认 `@` 别名修复仍然存在（数组格式正则）
5. ✅ 查看 `api/lib/proxyFetch.ts` 确认代理配置未丢失
6. ✅ 如有需要，执行 `syncAllStocks()` 同步全A股（需先解决代理或IP限制）
7. 继续开发新功能...

---

## 十一、环境变量备忘

```bash
# 服务器后端（~/.bashrc 或启动脚本中设置）
export HTTP_PROXY=http://your-proxy:port      # 如需代理
export HTTPS_PROXY=http://your-proxy:port     # 如需代理
export DATABASE_URL=sqlite:./data/stockshape.db  # 默认已配置
```
