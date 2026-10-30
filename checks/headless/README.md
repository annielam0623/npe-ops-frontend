# headless 检查（模拟接口 + headless Chrome）

每个页面一套：`<套名>-mock.js` 是模拟后端（端口 8799），`<套名>-test.js` 用 Chrome DevTools 协议驱动
headless Chrome 打开 `http://localhost:3198` 上的页面逐项检查。**只连本机的模拟接口，不连真实后端。**

## 跑法

```
cd checks/headless
npm install          # 只有 users 套要 puppeteer-core，第一次装一次
node run-all.js              # 全部（约 10 分钟）
node run-all.js tt da        # 只跑几套
node run-all.js --keep-dev   # 跑完不关 next dev
```

- 3198 上没有 `next dev` 时会自己起一个（`API_PROXY_TARGET` 指向模拟接口），跑完关掉。
- 每套的逐项结果写在 `logs/<套名>.log`，最后打印汇总表。
- 需要本机装 Chrome：`C:/Program Files/Google/Chrome/Application/chrome.exe`。
- 端口默认 app 3198 / mock 8799 / Chrome 调试 9333。几个窗口同时跑时用环境变量错开，不要再复制脚本改端口：

  | 变量 | 默认 | 作用 |
  | --- | --- | --- |
  | `APP_PORT` | 3198 | 只给 `run-all.js`：next dev 的端口（没有就在这个端口自己起一个） |
  | `MOCK_PORT` | 8799 | 模拟接口端口（各套 mock 监听、test 连） |
  | `APP_URL` / `MOCK_URL` | `http://localhost:3198` / `http://localhost:8799` | 单独跑某套时 test 用的地址；`run-all.js` 会按上面两个自动设好 |
  | `CDP_PORT` | 9333（fod 9334） | 用固定调试端口的那些套的 Chrome 端口 |
  | `SUITE_TIMEOUT_S` | 480 | 只给 `run-all.js`：每套最长跑多少秒（da 接近 8 分钟，单独跑时可以设 720） |

  例：`MOCK_PORT=8899 APP_PORT=3298 CDP_PORT=9433 node run-all.js tp users teams`（Git Bash 写法）。
  `teams` 套的 Chrome 每次用临时目录、端口由 Chrome 自己挑；`tp` / `users` 用 puppeteer，也不占固定调试端口。
- `run-all.js` 收尾时只关**本目录**（本 worktree）起的 headless Chrome，不会关别的窗口正在跑的检查。

## 各套对应的页面

| 套 | 页面 |
| --- | --- |
| blog | /broadcasting-log |
| bugs、bugs401 | /bug-reports |
| catchup | /send-log、/order-log 日期范围、门票列设置 |
| cs | /settings/content-studio |
| dr | dashboard 改版阶段一：侧栏（收起 / 平铺 / 拖拽 / 钉住）、My shortcuts、Messages 每窗两张、Forms、占位页、Settings → Navigation |
| dor | Daily Operation Report：Dashboard 块、Log an incident 弹窗（三类必填、Accident 日期 / Unknown）、/daily-report 页、visible_to_me=false / 404 不渲染 |
| da | /dispatch（含 Morning Relay、离开提醒、Step 2 的 Import history 入口） |
| hr | /settings/hr |
| imp | /dispatch/imports |
| man | /manifests（新方案：两个标签、胶囊、字段弹窗、Cfm #） |
| mf | /dispatch/manifest、Tour manifests 面板 |
| mt | /morning-pickup/send、/morning-pickup/tracking、dashboard 链接 |
| ns | /settings/notifications（统一自动通知开关页：总状态条、打开前确认、周三确认时间、Auto Send 仅 Super Admin、未接线 / 未知项） |
| nav | 侧栏 |
| olog | /order-log |
| ops | /ops-summary |
| orders | /orders、/orders/[订单号] |
| pl | /settings/pickup-locations |
| products | /settings/products |
| qr | /settings/quick-replies（G98 司机快捷回复：增 / 改 / 开关 / ↑↓ 排序 / 页内确认删除 / 前端先挡 / 400 原话 / 403 / Action Log） |
| ptt | /settings/products 的 Tour type 列（单个 / 批量 / Action Log） |
| sales | /sales-report |
| sheet、sheetcmp | /dispatch/work-sheet、/dispatch/guide-sheet（sheetcmp 对比旧页面版式） |
| tb | /task-board |
| teams | /settings/teams、/promotion-stats |
| tk | /tickets-reminder/tracking（及发送页基本流程） |
| tour | /tour-confirmation/send |
| tsend | /tickets-reminder/send（防重发、比对 / Apply） |
| tt | /tour-confirmation/tracking |
| users | /settings/users |
| veh | /settings/vehicles |

改了页面行为（PROGRESS.md 里写成「与旧页面的差异」的那种）以后，对应的检查也要跟着改。
