# 全站手机版 preview 工具（e6，2026-11-01，不合 main）

preview：https://claude.ai/artifact/QN1ZShgWKXFoeUSmjQgutY （v2 在最上面）。只是截图工具和临时样式，**不是功能代码**。

- `mobile-shoot.js`：390×844 手机尺寸逐页截图 + 量第一屏（起各页的 `<suite>-mock.js`，只连本机模拟接口）。
  前提：3411 上有 next dev，`API_PROXY_TARGET=http://localhost:8911 NEXT_DIST_DIR=.next-checks npx next dev --turbopack -p 3411`。
  用法：`node mobile-shoot.js <输出目录> [页面 key ...]`；`AFTER_DIR=after-b2` 时再截「改后」图（`<key>-after.png`）。
  脚本里 `DIR` 写死成 C:/Code/npe-ops-frontend/checks/headless，换电脑改这一行。
- `after-a/`：第一版方案 A 的临时样式；`after-b2/`：v2（方案 B + pill 缩小 + Tracking 只看今天）。
- `preview.html`：preview 页原文（图片在 artifact 上）。

动手后照 PROGRESS #44 的规则做共用组件（components/ui），不要搬这里的 DOM 改法。
