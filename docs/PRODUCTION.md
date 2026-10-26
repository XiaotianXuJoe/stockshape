# 生产环境边界

- 项目：StockShape 股票形态选股
- 端口：3000
- 目录：/home/ubuntu/app
- 进程：PM2：stockshape

## 推荐检查

`npm install；npm run build`

## 不上传、不覆盖

data/stockshape.db、本地环境变量和日志。这些内容只应通过独立的生产备份机制保存，不属于 Git 源码。

本仓库公开可见。任何真实凭据都不应写入代码、Issue、Actions 日志或 Git 历史。
