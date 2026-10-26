# Agent 维护说明

## 项目

- 名称：StockShape 股票形态选股
- 技术栈：React + TypeScript + tRPC + SQLite
- 生产端口：3000
- 服务器目录：/home/ubuntu/app
- 运行方式：PM2：stockshape
- 检查／构建：npm install；npm run build

## 维护约束

保持现有 React/tRPC 架构；数据库不得上传或被部署覆盖。

- GitHub 是源码权威；生产服务器只保留运行环境、密钥和业务数据。
- 修改应在新分支完成，检查后合并到 `main`，再按提交或标签部署。
- 不得把真实配置、密码、API Key、Cookie、用户数据、数据库、上传文件或日志提交到本公开仓库。
- 不得为了调试而放开静态文件、代理或管理接口的访问控制。
- 不要直接在服务器生产目录手工改代码后不回写仓库。

## 不得进入仓库的运行内容

data/stockshape.db、本地环境变量和日志。

详细生产边界见 `docs/PRODUCTION.md`。执行部署前同时参考项目原有 README 和交接文档；如文档冲突，先确认现状再操作。
