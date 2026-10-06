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

- 3198 上没有 `next dev` 时会自己起一个（`API_PROXY_TARGET`、`NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL` 指向模拟接口），跑完关掉。
- 每套的逐项结果写在 `logs/<套名>.log`，最后打印汇总表。
- 需要本机装 Chrome：`C:/Program Files/Google/Chrome/Application/chrome.exe`。
- 端口 3198 / 8799 被占用时先关掉占用的进程。

## 各套对应的页面

| 套 | 页面 |
| --- | --- |
| blog | /broadcasting-log |
| bugs、bugs401 | /bug-reports |
| catchup | /send-log、/order-log 日期范围、门票列设置 |
| cs | /settings/content-studio |
| da | /dispatch（含 Morning Relay、离开提醒） |
| hr | /settings/hr |
| imp | /dispatch/imports |
| mf | /dispatch/manifest、Tour manifests 面板 |
| mt | /morning-pickup/send、/morning-pickup/tracking、dashboard 链接 |
| nav | 侧栏 |
| olog | /order-log |
| ops | /ops-summary |
| orders | /orders、/orders/[订单号] |
| pl | /settings/pickup-locations |
| products | /settings/products |
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
