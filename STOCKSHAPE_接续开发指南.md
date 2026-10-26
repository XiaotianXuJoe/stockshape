# StockShape（股票形态选股）— 新会话接续开发指南

> **本文档用途**：供新对话的 AI 直接接手继续开发本项目。写于 2026-09-21，基于对服务器的实际勘察。
> **旧文档** `STOCKSHAPE_MEMORY.md`（2026-05-02）部分信息已过时，以本文档为准。

---

## 一、服务器连接信息

| 项目 | 详情 |
|------|------|
| 服务器 IP | `175.178.16.78`（腾讯云轻量，主机名 VM-0-4-ubuntu） |
| SSH | 用户名 `ubuntu`，密码 `[已移除的服务器密码]`，端口 22 |
| 系统 | Ubuntu 24.04，内核 6.8，Node.js v20.20.2 |
| **项目路径** | `/home/ubuntu/app/` |
| 数据库 | SQLite：`/home/ubuntu/app/data/stockshape.db`（10MB，只读查表用 better-sqlite3） |
| 项目当前状态 | **服务已停止**（最后活跃 2026-05-07，server.log 停在 5 月 7 日） |

连接方式：
```bash
ssh ubuntu@175.178.16.78   # 密码 [已移除的服务器密码]
cd ~/app
```

> 注意：服务器上没有装 sqlite3 命令行，查库可用项目自带的 better-sqlite3：
> ```bash
> node -e "const db=require('better-sqlite3')('data/stockshape.db',{readonly:true}); console.log(db.prepare('SELECT count(*) c FROM stocks').get())"
> ```

---

## 二、项目概述

**StockShape 形态选股**：股票 K 线形态分析工具，两大核心能力：

1. **形态识别（patternRecognition）**：自动检测经典 K 线形态 —— W底、M顶、头肩顶、头肩底、三角形、旗形、楔形、通道
2. **K线相似度匹配（similarity）**：给定一段目标走势，在全 A 股（5517 只）中找出形态最相似的股票。9 维评分：价格走势(Pearson)、形态节奏、成交量、波动率、趋势、均线、量价配合、支撑阻力、K线阴阳排列。最终 score 0-100。

附加能力：
- 股票搜索（SQLite 模糊匹配 + 东方财富 API 兜底）
- 历史 K 线（腾讯行情 API，纯前端调用，qfqday 前复权）
- 定时同步（node-cron，每天 15:30 收盘后同步日线，启动时自动补全）
- 行业/概念板块同步（industrySync）

---

## 三、技术栈与目录结构

**技术栈**：React 18 + TypeScript + Vite 6 + Tailwind + shadcn/ui（40+ 组件）｜tRPC v11 + Hono + superjson ｜SQLite + better-sqlite3 + Drizzle ORM ｜ECharts 5 ｜Zustand

**关键目录**（`~/app/` 下）：

```
api/
  boot.ts                  # 入口：Hono 服务 + tRPC + 静态文件 + 启动自检/调度
  router.ts                # appRouter（ping / stock / analysis）
  middleware.ts            # createRouter / publicQuery
  routes/
    stock.ts               # search / getInfo / getHistoricalData / count / bulkInsert
    analysis.ts            # findSimilarStocks(218行) / detectPatterns(356行) / getAllStocks / bulkInsert
  lib/
    patternRecognition.ts  # zigzagPoints + detectPatterns（25KB，核心形态识别）
    similarity.ts          # pearsonCorrelation / fastDtwDistance / calculateMultiDimensionalSimilarity（核心）
    stockData.ts           # 搜索/历史数据核心逻辑
    dailySync.ts           # 收盘日线同步
    industrySync.ts        # 行业/概念同步
    scheduler.ts           # node-cron 定时器
    proxyFetch.ts          # undici ProxyAgent 代理感知 fetch
    env.ts                 # 环境变量（APP_ID/APP_SECRET/DATABASE_URL）
src/
  pages/Dashboard.tsx      # 主页面
  components/
    search/StockSearch.tsx # 股票搜索
    chart/StockChart.tsx   # K线图表（双横轴：上方真实日期轴，下方模板日期轴）
    panels/PatternSelector.tsx  # 形态多选（bullish/bearish）
    panels/ControlPanel.tsx     # 控制面板
    results/ResultsTable.tsx    # 选股结果表（含相似度评分和中文描述）
    layout/Header.tsx      # "StockShape 形态选股"
  stores/appStore.ts       # Zustand 全局状态
  hooks/useKlineData.ts    # 腾讯K线API（纯前端，web.ifzq.gtimg.cn）
data/stockshape.db        # SQLite 数据库
db/schema.ts               # Drizzle schema
dist/                      # 已构建产物（boot.js 1.6MB + public/），2026-05-06 构建
```

**数据库 4 张表**：`stocks`（5517 只全 A 股：code/name/pinyin/market + 行业概念字段）、`stock_prices`（日线）、`analysis_results`（分析结果）、`sqlite_sequence`

---

## 四、启动方式

### 开发模式（vite dev server，前后端一体，端口 3000）
```bash
cd ~/app
npm run dev        # 若有该 script；vite.config.ts 中 server.port=3000，@hono/vite-dev-server
```

### 生产模式
```bash
cd ~/app
npm run build      # 构建到 dist/
npm run start      # NODE_ENV=production node dist/boot.js，默认端口 3000（PORT 环境变量可改）
```

生产模式下 Hono 同时服务 API（`/api/trpc/*`）和静态前端（`dist/public`）。

启动时 boot.ts 会自动：① 检查 stocks 表为空则 syncAllStocks；② 启动 15:30 定时同步；③ 后台异步同步行业/概念数据。

---

## 五、已知问题与坑（必读）

1. **东方财富 API 从腾讯云 IP 被拒绝**（ECONNREFUSED）：`searchapi.eastmoney.com`、`push2.eastmoney.com` 不可直连。股票搜索靠本地 SQLite（5517 只全 A 股已入库，所以搜索不受影响）；dailySync 用腾讯行情源。若需东财数据要走 `proxyFetch.ts` 配置的代理（`auto_proxy.py` / `setup_proxy.sh` 在主目录，是当年为解决这个问题写的）。
2. **vite 别名坑（已修复）**：`"@"` 别名会误伤 `@trpc` 包，必须用正则 `find: /^@\//` 只匹配 `@/` 开头。改动 vite.config.ts 时注意保持。
3. **React Query 加载态坑（已修复）**：StockChart.tsx 用 `isFetching || isPending` 而非 `isLoading`，四层覆盖层分离（loading/error/dateError/noData），改图表代码时别回退这个写法。
4. **tRPC content-type 头**：Node 20 fetch 要求小写 `content-type`，boot.ts 里已做兼容转换，勿删。
5. **服务目前没在跑**：服务器现监听端口只有 80(nginx)、3001(learning-plan)、8300(notefactory-docker)、22(ssh)。端口 3000 未占用，启动 StockShape 不会冲突。没有 pm2 托管，重启服务器后不会自启；如需常驻建议 `pm2 start dist/boot.js --name stockshape`。

---

## 六、调试技巧

- **日志**：`~/app/server.log`（旧）、`~/app/server_new.log`。相似度计算会输出 `[DEBUG KE]` 行（含 9 维分数和中文描述），是调试相似度算法的入口。
- **前端截图调试**：主目录有 `inspect_login.mjs`、`dbg*.mjs`、`flow_test.mjs` 等 Playwright 脚本可参考（是当年调 notefactory 留下的，模式可复用）。
- **测试脚本**：`~/app/test_*.mjs` 共 50+ 个，是各功能点的独立验证脚本（test_api / test_cache / test_multi / test_sim 等），改完代码可找对应的跑一下。
- **改代码后**：`npm run build && npm run start` 验证生产构建；dev 模式热更新更快。

---

## 七、继续开发建议方向

1. 先 `npm run start` 把服务跑起来，浏览器打开 `http://175.178.16.78:3000` 验证当前功能完好（记得腾讯云控制台放行 3000 端口）。
2. 形态识别目前基于 zigzag 拐点 + 规则匹配（`patternRecognition.ts`），可在 `detectPatterns` 里增加新形态或调参。
3. 相似度引擎（`similarity.ts`）的权重在 `calculateMultiDimensionalSimilarity`（122行起），9 维权重可调，评分描述文案在同文件。
4. `analysis_results` 表目前似乎未被持久化利用，可以考虑把选股结果存库做复盘。

---

## 八、2026-09-21 会话更新记录（本次接续）

1. **服务已恢复运行**：pm2 托管（`pm2 start dist/boot.js --name stockshape`，必须带 `NODE_ENV=production`，否则 boot.ts 不监听端口）。已 `pm2 save`。
2. **package.json 补齐 scripts**：`dev`=vite、`build`=`vite build && esbuild api/boot.ts --bundle --platform=node --format=esm --outfile=dist/boot.js --packages=external`、`start` 不变。注意新构建方式产出的 boot.js 约 70KB（依赖运行时解析），与旧的全量打包 1.6MB 不同，属正常。
3. **修复严重 BUG：drizzle insert 未执行**。`dailySync.ts` / `stockData.ts` 共 3 处 `db.insert(...).onConflictDoNothing()` 缺少 `.run()`，drizzle better-sqlite3 是惰性执行，导致日线同步和 K 线缓存**从未真正写库**（这就是价格数据停在 2026-04-30 的原因）。已全部补 `.run()`。
4. **修复日期错位 BUG**：dailySync 原用 `toISOString()`（UTC 日期），北京时间 0-8 点运行会错标为前一天；现改为从腾讯行情响应 `parts[30]` 时间戳解析真实交易日，兜底用北京时间。
5. **数据现状**：stock_prices 已写入最近交易日数据（停牌股日期为其最后交易日）。5-9 月历史缺口不影响选股功能（分析时实时拉腾讯 K 线并缓存），如需全量回补需另写脚本。
6. 已验证：搜索 / findSimilarStocks / detectPatterns / 公网 3000 端口均正常。dist 旧产物备份为 `dist/boot.js.bak.20260921`、`dist/public.bak.20260921`，dailySync.ts 备份为 `.bak`。
7. **修复形态识别模式报错**（`No procedure found on path "analysis.findSimilarStocksWithPatterns"`）：前端 ControlPanel（5月6日源码）调用了一个后端从未实现的 procedure。已在 `api/routes/analysis.ts` 新增 `findSimilarStocksWithPatterns`（input: ticker/startDate/endDate/patternFilter?），逻辑 = 全市场相似度扫描 + 每只候选跑 detectPatterns；patternFilter 非空时命中形态的股票加分（置信度/10，上限15）并优先返回，返回字段含 detectedPattern/baseSimilarity/patternBonus。原 `findSimilarStocks` 未动。改动前备份 `analysis.ts.bak`。实测：全市场 5516 只扫描 + 形态检测约 43s，W底过滤 TOP5 均为真实命中。
8. **新增 K 线框选日期功能**（2026-09-21）：`StockChart.tsx` 新增「框选日期」按钮（图表右上角，Crop 图标）。点击后进入框选模式（十字光标覆盖层），按住左键拖拽出 teal 高亮矩形，实时显示起止日期标签，松开即 `setDateRange` 并自动重载 K 线；ESC 或点按钮取消。实现要点：覆盖层 `div.cursor-crosshair` 拦截鼠标事件（不与图表平移冲突，因为只在框选模式挂载）；像素坐标 → `chart.timeScale().coordinateToLogical(x)` → 取整 clamp → 映射 `targetQuery.data[idx].date`；<8px 视为误触忽略；反向拖拽自动交换顺序。改动前备份 `StockChart.tsx.bak`。已用 Playwright 端到端验证（正拖/反拖/ESC）。注意：本文件用的是 lightweight-charts v5，不是指南前文说的 ECharts。
9. **图表动态加载 + 分析区间虚线**（2026-09-21）：`StockChart.tsx` 大改。① 显示窗口(viewRange)与分析区间(dateRange)解耦：初始 = 分析区间左扩max(span,120)天、右扩max(span/2,30)天；平移/缩放到左边缘(from<5)自动向前加载180天（上限850天≈腾讯单次640根限制），按时间锚定恢复视野不跳动；**不做右扩**（分析区间末端贴近数据末尾是常态，右扩会误触发死循环）。② pendingRestore 带 key 校验，防止非扩展查询返回时错误恢复视野。③ loading 遮罩改为 `(isFetching||isPending) && !data`（配合 useKlineData 的 placeholderData 保留旧数据），动态加载时不再闪遮罩。④ 候选叠加线改为按 j0（分析区间起点在显示数据中的索引）对齐，顶部日期轴同步减去该偏移。⑤ 分析区间用自定义 AnalysisRangePrimitive（attachPrimitive）画两条 teal 虚线+淡色填充。注意：腾讯K线接口从部分网络环境首载可能需 10-25 秒。

---

**10. 缩放边界钳制 + 解除365天跨度限制 + K线分页加载（2026-09-21）**

- **腾讯K线接口分页**：腾讯 `fqkline` 接口单次最多返回约640根K线，超出部分会被静默截断。现 `src/lib/stockApi.ts` 的 `getKlineApi` 和 `api/lib/stockData.ts` 的 `fetchTencentKline` 均已改为**以endDate为锚向前自动翻页**（每页640根，最多12页≈30年），按日期去重合并，直到覆盖startDate或到达上市首日（返回不足一页）。
- **接口域名变更（重要）**：服务器（腾讯云IP）访问 `web.ifzq.gtimg.cn` 会被腾讯WAF拦截（返回501 HTML页面）。已统一改用 `ifzq.gtimg.cn`（无web前缀），浏览器和服务器均可直连。另外注意：腾讯接口的股票代码格式是 `sz000001`（**不带点**）。
- **缩放边界钳制**（StockChart.tsx）：① 右边界——可视范围右缘不能超过最新数据日期，超出时保持窗口宽度钳制回 `len-1`；② 左边界——未耗尽历史时，滑到左缘自动向前扩展加载180天；扩展返回的数据首日没有变得更早（到达上市日期）时置 `noMoreHistoryRef=true`，此后左缘钳制在 `from=0`，不再发请求；③ 缩放到全量数据时钳制为 `{from:0, to:len-1}`，两侧不留空白。
- **边缘处理器订阅位置**：`subscribeVisibleLogicalRangeChange` 必须放在**创建chart的useEffect内部**（chartRef.current赋值之后）。原先独立 useEffect(deps:[]) 存在时序风险——StockChart 在 targetStock 为null时提前return占位符，若挂载时chart尚未创建则永不订阅，导致懒加载/钳制整体失效。
- **pendingRestore防卡死**：扩展取数失败时React Query默认重试3次（含15秒超时，最坏70秒），期间pendingRestore不清除会阻塞所有边缘处理。现pendingRestore带时间戳，超过20秒自动解除阻塞。
- **fetch超时保护**：客户端K线fetch增加15秒AbortController超时，避免网络异常时加载遮罩永久卡住（超时后走mock兜底，图表仍可交互）。
- **解除365天限制**：ControlPanel.tsx `MAX_DAYS` 365→1825（约5年），提示文案同步更新；`MAX_VIEW_DAYS` 850→5000（配合分页加载）。
- 备份文件：StockChart.tsx.bak3、ControlPanel.tsx.bak、stockApi.ts.bak2、stockData.ts.bak2。
- 已知待办：mock数据兜底会在腾讯接口不可达时静默显示假K线（价格量级明显不对），后续可考虑改为显式错误提示或仅首次加载使用mock。


**11. 修复形态识别面板溢出重叠（2026-09-21）**

- 问题：勾选「启用形态模式」后，ControlPanel 内容超出 Dashboard 图表行固定高度（lg:h-[520px]），面板向下溢出并压在下方的「相似股票分析结果」区域上，文字重叠。
- 修复：ControlPanel.tsx 根容器加 `lg:h-full lg:overflow-y-auto`——桌面端面板限高并内部滚动；同时移除了与 PatternSelector 内部重复的「形态识别」标题（及未使用的 ScanEye 图标导入）。


---

## 12. 选股策略 / 量化因子系统（①②⑨⑬⑭，2026-09-21）

### 架构
- **因子库** `api/lib/factors.ts`：`FactorKline{date,close,volume,high?,low?}` → `FactorResult{pass,detail,strength(0-100)}`。
  - ① `checkMaAlignment(kline, consecutiveDays=3)`：MA5>MA10>MA20>MA60 连续 N 日且 MA5/MA20 向上
  - ② `checkPlatformBreakout(kline, platformDays=30, maxRangePct=15, volumeSurge=1.5)`：窄幅震荡平台 + 放量突破上沿
  - ⑨ `checkNDayHigh(kline, days=250)` / `checkPullbackFromHigh(kline, days, minPullbackPct=20, maxPullbackPct=60)`
- **tRPC 过程**（`api/routes/analysis.ts`）：
  - `analysis.screenByStrategy`（mutation）：`{conditions:[{type,params?,patterns?}], asOfDate?, saveRun?}`，⑬ 多条件 AND 取交集（因子+形态可叠加，形态作为 `type:"pattern"` 条件）。返回 `results/totalScanned/realDataCount/asOfDate/runId`。
  - `analysis.backtestStrategy`（mutation）：`{conditions, asOfDate(必填,历史), horizonDays=20(≤120)}`，⑭ 对前 100 只命中股取前瞻 K 线算 T+N 收益，返回 `summary{sampleCount,completeCount,winRate,avgReturn,medianReturn,maxReturn,minReturn}`，per-stock `change`=前瞻收益、reasons 附入场/出场价。
- **扫描核心** `runStrategyScan`：startDate=asOfDate-520d，MIN_BARS=60/CACHE_MIN=120；先 `batchGetHistoricalData` 批量读缓存，不足的直接 `fetchTencentKline` 补（**不用 mock**，避免假信号），CONC=50+100ms 延迟+saveToCache 回填。similarityScore=各因子 strength 均值，change=近20日涨跌幅。
- **持久化**：`strategy_runs(id,conditions_json,as_of_date,matched_count,created_at)` + `strategy_results(id,run_id,code,name,close_price)`（db/schema.ts + queries/connection.ts 自动建表）。注意 drizzle better-sqlite3 insert 必须 `.run()`，`lastInsertRowid` 用 `Number(ret.lastInsertRowid)`。
- **前端** `src/components/panels/StrategyPanel.tsx`：因子勾选+参数输入、形态 chips（与因子 AND 叠加）、信号日（留空=最新）、回测区（信号日+持有5/10/20/60日+汇总卡片）。复用 ControlPanel 导出的 `normalizeResults`/`callAnalysisAPI`，结果写入全局 `setResults` 复用 ResultsTable。

### 数据基建（关键）
- **一次性历史回填** `scripts/backfill_klines.cjs`（.cjs 因 package.json type:module）：`node scripts/backfill_klines.cjs --conc 4 --min-bars 300`，对 <300 根的股票补 2 页×640 根；`busy_timeout=10000`；WAF 检测退避 60s。已全量跑完：4433 只 100% 成功，stock_prices 5,909,132 行、5205 codes、2018-03→今、5136 只 ≥300 根。日常由 dailySync 维护（UNIQUE(code,date)+INSERT OR IGNORE）。
- **WAF 免疫 host**：`proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get` 在并发下不被封（`web.ifzq.gtimg.cn` 与 `ifzq.gtimg.cn` 均会 501 封 IP）。`fetchTencentKline` 双 host 回退：响应文本不以 `{` 开头 = WAF HTML → 换 host。回填空 turnover_rate → 结果表换手率显示 0.00% 属预期（腾讯 K 线接口无换手率字段）。
- **数据库真实路径**：`data/stockshape.db`（DATABASE_URL 默认 `./data/stockshape.db`，pm2 cwd=/home/ubuntu/app）。误连 `./stockshape.db` 会新建空库报 no such table。

### 验证记录
- UI E2E：N日新高 75 命中、均线多头 275 命中（理由文案正确）、MA+平台突破 / MA+N日新高+旗形 = 0（严格组合合理）；回测 2026-08-01→T+20：样本12/满期12/胜率58.3%/均值-0.72%/中位1.78%。strategy_runs 6 行、strategy_results 按 run_id 正确关联。
- 后续可做：D/E（需财务/资金流数据源）、回测多信号日批量、换手率回填（需行情快照接口）。


---

## 13. 前端界面美化重设计（2026-09-22）

### 设计系统
- **全局暗色细滚动条**（`src/index.css`）：`:root{color-scheme:dark}` + `*::-webkit-scrollbar` 8px 圆角深色 thumb（`hsl(220 14% 22%)`，hover 变亮）+ Firefox `scrollbar-width:thin` —— 彻底消灭暗色主题下的白色原生滚动条。另加 `::selection` teal、`input[type=number]` 去上下箭头、`.tnum` 等宽数字工具类。
- 统一卡片语言：`rounded-lg border border-border bg-background/40 p-4`（面板内分区卡）/ `rounded-xl border border-border bg-card`（大卡片）；主色 teal（--primary 166 72% 50%），**禁止再出现硬编码蓝色/灰色**。

### 各文件改动（均有 .bak_ui1 备份）
- **PatternSelector.tsx**：整文件重写。旧版硬编码 `bg-gray-900`+蓝色标题与全局风格冲突 → 改为设计系统卡片 + 自制 switch 开关（role="switch" 圆形滑块）+ 信号色圆点 chips（红涨绿跌 CN 惯例）。
- **ControlPanel.tsx**：参数配置区也包成分区卡；删除两条 `h-px bg-border` 分隔线（卡片本身提供分隔）；根容器 p-4 gap-3。
- **StrategyPanel.tsx**：return JSX 全部重写（逻辑不变）。因子卡带选中高亮（border-primary/30 bg-primary/5）、label/desc 分行、参数输入 h-6→居中 focus ring、形态 chips 加大、回测汇总改为 grid gap-px 分割线卡片、meta/error 改为圆角色条。
- **ResultsTable.tsx**：表头 `whitespace-nowrap`；相似度列改为 数字+迷你进度条（w-12 h-1，≥80 teal / ≥60 黄）；成交量/换手率/量比加 `tnum`；移除未用的 Activity 图标 import。
- **Dashboard.tsx**：删除 console.log；Hero 加 `bg-primary/10 blur-3xl` 氛围光；左面板 w-80→`lg:w-[340px]`、行高 520→560、gap-4→5；图表标题行改为 h-10 工具条卡片（竖线分隔符）。
- **StockChart.tsx**：删除图内标题覆盖层（与工具条重复显示两次），保留「框选日期」按钮与候选股迷你走势图容器（topContainerRef 26px 占位条不能删——它驱动候选股顶部迷你图，删了功能静默失效）。

### 验收
tsc 零错误、build 通过、Playwright 1600/2560 双视口截图：无白滚动条、无文字重叠、无 pageerror；策略扫描 88 命中正常渲染、选中行 teal 高亮、相似度进度条正常。

