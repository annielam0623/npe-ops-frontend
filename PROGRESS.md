# 前端迁移进度

> 每完成一步就更新本文件。新开窗口先读 [CLAUDE.md](CLAUDE.md)，再读本文件。

## 已完成

- `/promotion-stats`
- `/settings/teams`、`/settings/users`、`/dashboard`（首页 `/` 307 跳 `/dashboard`）——
  Annie 2026-09-30 三页一起验收通过，`task/dashboard-page` 已合进 main。备忘：
  - teams 列表调 `GET /api/admin/teams`，**不是** `/api/teams`（后者被旧接口占用）。
  - users 的邀请链接用 `invite_token` 拼 `NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL/register/<token>`，
    不用后端返回的 `invite_url`（经代理时主机名是代理目标）。
  - dashboard 的快捷卡、消息卡片暂时链到旧后台的发送 / 追踪页；那几页迁过来以后改成站内路径
    （`components/dashboard/quick-cards.tsx`、`components/dashboard/config.ts` 的 `legacyUrl`）。
  - 共用组件在 `components/ui/`（Modal、ConfirmDialog、Panel、ErrorBanner、按钮样式），
    错误文案 `lib/api-errors.ts`。
- `/send-log`、`/tickets-reminder/send`、`/morning-pickup/send`，外加 dashboard Messages 说明改成 6 条子弹——
  Annie 2026-10-03 确认三页验收通过，`task/morning-send-page`（含前两个分支）已合进 main。各页备忘见下。

### `/send-log`

- 接口：列表 `GET /api/notifications/send-log`（`date`、`module`、`channel`=EMAIL|SMS、`status`、
  `page`、`page_size`=50）；导出 `GET /api/send-log/export`（CSV，按洛杉矶日期 + 模块）。
- ⚠️ **旧页面其实是坏的**：它调的是 `/api/send-log`，却按另一个接口的参数写（`channel`、`status`、
  `page`、`page_size` 都被忽略，也不返回 `total`，所以分页和「N records」一直是 0）；
  日期范围（This Week / This Month / Custom）只把起始日传给后端，实际只查一天；
  MTLV 卡片把模块下拉设成一个不存在的选项，等于没筛。新页面改用参数对得上的
  `/api/notifications/send-log`。
- 与旧页面的差异：
  - 日期改成单日：日期框 + Today / Yesterday。两个接口都只支持单日，范围要等后端（见「需要后端」）。
  - 暂时没有 MTLV 卡片、MTLV 列（新接口不返回 `mtlv_eligible`，见「需要后端」）。
  - 统计卡片：Total Sent + 三个模块，数字来自接口，跟着日期 / 渠道 / 状态筛选变化；点卡片 = 按模块筛选。
  - 换筛选条件自动查询（没有 Filter 按钮），回到第 1 页。
  - Errors 区的 Channel 列：邮件的 `failed: <原因>`、bounce、spam 也算失败（旧页面只认精确的
    `failed`，带原因的失败显示成 “—”）。
  - Export 只按日期和模块导出（后端接口只支持这两个），按钮上有提示。
  - 已知后端口径：`status` 是 `ILIKE %值%`，选 Delivered 也会带出 Undelivered 的行——照旧，未改。

### `/tickets-reminder/send`

- 接口：消息预览 `GET /api/notifications/tickets-reminder/message-preview`；
  上传查重 `POST /api/tickets-reminder/check-duplicates`（multipart：`manifest`、`tour_type`、`service_date`）；
  发送 `POST /api/tickets-reminder/send-bulk`（`{send_type, guests}`）。
- 流程与旧页面一致：选团型和日期（消息预览自动刷新，SMS / Email / Guest Page 三个标签，邮件和确认页放
  `sandbox` iframe）→ 上传 Excel（文件名不含所选日期时先确认）→ 预览，重复单默认跳过、可逐个或全部
  「Send anyway」→ 选发送方式 → 发送 → 结果。
- 顺带改的共用部分：`apiFetch` 支持 FormData 上传；`next.config.ts` 的 `/api` 转发超时从 30 秒放宽到 5 分钟。
- 与旧页面的差异：
  - **分小批发送**：每批 10 人依次调 `send-bulk`，显示进度，发送中离开页面会提示。旧页面一次性发整批，
    超过 30 秒（本地转发）或约 100 秒（线上 Cloudflare）浏览器就报错、后端却还在发，
    staff 以为失败再点一次就会**重复发给客人**。
  - 某一批出错就停：写明哪一批「可能已发、先去 Send Log 核对」、哪些确定没发，不自动重试。
  - 副作用：失败告警邮件按批发（原来一次发送一封），一次 25 人最多 3 封。
  - 发送前多一个确认框：人数、团型、日期、发送方式、跳过几张重复单。旧页面点了直接发。
  - 文件名 / 日期不符的提示从 `window.confirm` 改成弹窗（旧代码注释说要和巴士发送页一起换；
    巴士发送页迁过来时用同一个做法）。
  - Excel 解析失败（缺列等）显示原因；旧页面这时显示一张空预览。
  - 结果表：没选的渠道显示 “—”，客人没有号码 / 邮箱显示 “No address”（旧页面一律写 failed）；
    Skipped 显示实际跳过的重复单数（旧页面恒为 0）。
  - 团型下拉照抄旧页面的分组和文案（没用 `/api/tickets-reminder/tour-types`：它的两个 Brenda 同名）。
    后端新增团型时这里要跟着加。
  - 客人姓名仍按旧页面的做法，把 name 按第一个空格拆成 first / last（影响客人收到的称呼，没改）。

### `/morning-pickup/send`

- 接口：消息预览 `GET /api/notifications/morning-pickup/message-preview`；
  上传预览 `POST /api/notifications/morning-pickup/preview`（multipart：`file`）；
  发送 `POST /send/morning-pickup`（multipart：`file`、`send_type`、`selected_orders`=JSON 数组）。
- ⚠️ 发送接口不在 `/api` 下，`next.config.ts` 只给 `/send/morning-pickup` 这**一条**路径加了转发。
- ⚠️ 后端 `selected_orders` 缺失或不是合法 JSON 时会**发给文件里的所有人**。前端每次都传非空的 JSON 数组
  （`lib/morning-send-api.ts` 里空数组直接报错，不发请求）。
- 流程与旧页面一致：上传今天的 manifest → 没发过的按上车地点分组、默认全选，地点按钮 / Select all /
  Deselect all / 逐个勾选；今天已发过的放在下面深色区块，默认不勾，Select all 和地点按钮碰不到它们，
  Deselect all 连它们一起清 → 选发送方式（默认 SMS Only）→ 发送 → 结果。
- 顺带：Tickets 页的消息预览面板和分批工具抽成共用（`components/ui/message-preview-panel.tsx`、
  `lib/send-batches.ts`），Tickets 页行为不变，39 项检查重跑通过。
- 与旧页面的差异：
  - **分小批发送**（每批 10 单，每批都重新上传同一个文件，只带这一批的订单号），显示进度；某一批出错就停，
    写明哪些「可能已发、先去 Send Log 核对」、哪些确定没发。原因同 Tickets 页。
  - 副作用：失败告警、上车地点未匹配告警按批发（原来一次发送各一封）。
  - 发送前多一个确认框：单数、发送方式；勾了已发过的单时用红字写明「N 单会收到第二条」。
  - 结果表只列选中的单（旧页面把没选的也列成 skipped），状态写成 Sent / Failed: 原因（旧页面显示原值，
    例如 `sent:SM…`）；统计是 Sent / Failed / Not selected / To send。
  - 使用说明保留要点；「Network Error 等 1–2 分钟刷新后重发」那条删了——分批以后出错会列出状态不明的单，
    不应该整批重发。

## 进行中

> 不设验收上限（见 CLAUDE.md「待验收页面」）。分支链（后一个从前一个拉出）：
> `task/dashboard-links` → `task/morning-tracking-page` → `task/tickets-tracking-page` → `task/pickup-locations-page` → `task/products-page` → `task/broadcasting-log-page` → `task/bug-reports-page` → `task/ops-summary-page` → `task/order-log-page` → `task/sales-report-page` → `task/task-board-page` → `task/orders-page` → `task/content-studio-page` → `task/hr-page` → `task/vehicles-page` → `task/dispatch-sheets` → `task/ops-api-catchup` → `task/dispatch-manifest` → `task/dispatch-assignments` → `task/app-nav` → `task/ops-api-catchup-2` → `task/tour-send-page` → `task/tour-tracking-page` → `task/morning-relay` → `task/date-picker-click` → `task/log-search-compact` → `task/log-order-search` → `task/dispatch-steps` → `task/ops-api-catchup-3` → `task/morning-send-guard` → `task/ops-login-cancel` → `task/manifests-v2`。
> **最新：`task/manifests-v2`**（2026-10-07 晚），
> 验收在这个分支上看全部。⚠️ 推 main 会自动部署。
>
> 2026-10-07 晚：后端 Manifests 包上线了（main `3629925` / `6162287`，v76 已在生产执行），原来的旁支 `task/manifests-v2` 合进了链尾
> `task/ops-login-cancel`（含另一个窗口的 `81d5f1c`：检查脚本改用 `.next-checks`），**接成新的链尾**。从现在起验收修正修在 `task/manifests-v2` 上。
> `task/ops-login-cancel` 仍可单独合，它不含 Manifests。
>
> ⚠️ **`task/manifests-page`、`task/ops-api-catchup-4` 两个分支已废弃，不在链上，别碰、别合并**（2026-10-06 深夜，Annie 转达后端核对结果）：
> `task/manifests-page` 做的 `/manifests` 页是按当晚早些时候上线的旧接口做的，Annie 当晚后来定的新方案（8 条决定，见下面
> 「`/manifests` 暂停」小节）要等后端 `task/manifests-fields` 包落地才能改；`task/ops-api-catchup-4`（登录回跳 + 门票 Cancel）
> 当时是从 `task/manifests-page` 拉出的，会把还没就绪的 Manifests 代码带上 main，所以把那部分改动原样搬到了新分支
> `task/ops-login-cancel`（从 `task/morning-send-guard` 拉出，不含 Manifests），**这才是真正的链尾**。
>
> ⚠️ **2026-10-06 合过一次分叉**：10-05 晚家里没拉到公司白天的三个分支，接着在 `task/morning-relay` 上提交了全链审查修正和 `checks/headless`；
> 10-06 已把它合进 `task/log-order-search`。所以 `task/date-picker-click`、`task/log-search-compact` **不含**全链审查修正，不能单独合，要合就合链尾。
> 开工先 `git fetch`，**确认链尾是哪个分支再动手**，别在链中间的分支上提交。
>
> 🔀 **2026-10-08：`task/forecast-30day-page` 是从 `task/manifests-v2` 拉出的旁支**（本仓库原则上不用 worktree，这次是两个窗口要并行干活
> 才临时开的），独立 worktree `C:\Code\npe-ops-frontend-forecast`，做 30 Days Forecast 页（见「待做」第 1b 条）。
> 跟主目录没有文件冲突（不同目录、不同 `npm run dev` 端口），但**共享同一个远端仓库**：两边各自提交推自己的分支，
> 别在对方的分支上提交。做完验收通过后合回链尾（到时候链尾是哪个看当时的「进行中」顶部）。

**下一步（2026-10-07 深夜更新）**：

1. 开工先 `git fetch --prune`，切到链尾 `task/manifests-v2`。
2. 🔴 **新规矩（Annie 2026-10-07 晚，已写进 CLAUDE.md「已定的决策」）：页面对着旧版做到一模一样，不自己发挥。**
   之前做的页面都是浅色（`bg-stone-100`），旧后台全是深色（`base.html` 的 `--bg:#06101c`）⇒ **所有已迁页面要照旧模板改样子**
   （配色、版式、字体、文字）。dashboard 已改（见本节最后一小节，做法可照抄：IBM Plex Sans、半透明白卡片、彩色边框）；
   **其他页面一页都还没改**，下一步就做这个，逐页打开旧模板对照。共用组件（`components/ui/` 的 Panel、按钮、筛选条、弹窗、
   `step-box` 等）先改深色，能一次带动很多页；侧栏本来就是深色。旧页面没有的新功能（Dispatch Assign / Send）也用深色。
3. **功能上的不同，Annie 选了「逐页过一遍再定」**：清单在 [docs/旧页面差异清单.md](docs/旧页面差异清单.md)（131 条，从各页「与旧页面的差异」抽的），
   等 Annie 每条勾「保留 / 改回」。**勾回来之前不动功能**，只改样子；勾回来以后按她的选择改。
4. 🔴 **dashboard 漏了 Multi Orders 窗口**（见「待做」第 5 条），切换前必须补，照旧 `dashboard.html` 搬（不用再问需求）。
5. 等 Annie 验收：全部页面都在等（样子改完后再看效果更好）。最新几项在本节最后几小节：10-05、10-06 的七项，10-07 的 **`/manifests` 新页 + Products 的 Tour type 列**，
   10-07 晚的「Dispatch 司机名后不挂语言」（后端 main 已核对到 `f3ae356`）、**Dispatch 拆 Assign / Send 两个标签**、**dashboard 深色 + Dispatch 说明放大**。
   ✅ **10-08：`/manifests` 已连真接口实际看过**（本地前端转发线上 confirm，Annie 账号登录），结果见本节最后一小节「`/manifests` 真接口核对」——
   两个标签、胶囊、字段弹窗六组、Legacy 行提示、Cfm # 输入框、CSV 导出、Products Tour type 列都正常，控制台无报错。
   Money 组 Annie 已改成所有 staff 都能看，等后端放开（见「需要后端」第一条，admin 账号现在仍能看到，符合当前后端行为）。
6. 验收通过的按分支链合进 main（只过了前面几页就合对应的分支）。
7. G29 第二批（Seat guests）合进 main 后照着跟（放进 Assign）；Messages 等 Annie；Morning Relay「复制 1st Round」等 Annie 细化（见「待做」第 3 条）。

**交接（2026-10-07 深夜收工）**：链尾 `task/manifests-v2`，已推远端，工作区干净。今晚做了：跟后端 dispatch-lang-label；
Manifests 价格放开记进「需要后端」；Dispatch 拆 Assign / Send；Dispatch 说明放大；dashboard 改回旧版深色；
CLAUDE.md 加「页面对着旧版做一模一样」；整理差异清单。PROGRESS 里 10-06 合分叉留下的一行 `<<<<<<< HEAD` 已删。

**交接（2026-10-07 晚，收工线 19:00）**：链尾 `task/manifests-v2`，已推远端。
`/manifests` 和 Tour type 等 Annie 验收（第一次真机查看）。今天另一个窗口在主目录上修了检查脚本的 `.next` 冲突（`81d5f1c`，已合进链尾）。

### `/manifests` 真接口核对（2026-10-08，只读查看，没有改数据）

- 做法：本地前端转发线上 `confirm.nationalparkexpress.com`（PROGRESS「验收环境：一条命令」那条），Annie 账号在浏览器里登录，
  用 Claude in Chrome 实际打开页面核对（不是模拟接口）。
- `/manifests`：Bus Tour 171·330 pax / Tickets - SelfDrive 290·765 pax（2026-10-08 真实数据）；Bus 胶囊按 Group（Antelope / BZ / CHD /
  Hoover Dam / Private / South Rim / West Rim / No group yet），Tickets 胶囊按门票 tour type（Antelope Canyon X – Taadidiin Tours、
  Lower/Upper Antelope Canyon 几家、No tour type yet），切标签 / 切胶囊后地址栏 `tab=`、`pill=` 跟着变，和契约一致。
  ☰ Columns 弹窗六组（Guest / Trip / Booking / Our records / Booking questions / Money）字段数对得上接口契约；
  Annie 账号是 admin，Money 组能看到（后端还没把它放开给所有 staff，这是已知的「需要后端」事项，不是前端问题）。
  Tickets 标签的 Antelope Canyon X 胶囊里真的出现了一行 Legacy 提示（8/16 前的老数据），提示文案符合设计。
  Cfm # 列勾选后正确渲染成可编辑输入框；Export CSV 点击无报错。两次都检查了浏览器控制台，没有报错。
- `/settings/products`：真实 181 个产品，TOUR TYPE 列已经出现在表头，接口没有报错。
- **没测**：没有实际写入过 Cfm #（找不到安全的 `ZZ Test` 单可以改，不想碰真实订单的确认号）——这部分 Annie 验收时可以用她自己挑的单试，
  或者告诉 Max 一个可以用来测 Cfm # 写入的单号 / 日期。
- 结论：接口形状和前端实现一致，`/manifests` 可以进入正常验收流程（样子还是浅色，等深色改版轮到它）。

**交接（2026-10-06 深夜收工）**：链尾 `task/ops-login-cancel`，已推远端，工作区干净。

- ⚠️ 下次开工先 `git fetch`，**在链尾上接着做**（10-07 起链尾是 `task/manifests-v2`）（别在 `task/manifests-page` / `task/ops-api-catchup-4` 上提交，
  那两个分支废弃了；也别在链中间的分支上提交，10-05 就是这样分叉的）。
- 后端今天上线、ops 要跟的四处（HR Samsara Driver ID、门票发送收 Rezdy 原始 CSV、早班发送服务端防重发、**登录回跳 G32 + 门票 Cancel**）
  **已跟完**，见本节最后三小节。`/manifests` 列表接口也上线了，但接的那一版已经过时，见「`/manifests` 暂停」小节。
- 10-06 晚补：后端 10-05 的 samsara-live-share（规则文档 5c）之前漏跟了——Morning Tracking 的 Bus #、Vehicles 的 Open map 改走 `/tracking/vehicle-live` 当天临时链接，见「后端 10-06 跟进」小节。
- **后端已上线、ops 不用改的**：Sales Report 改读 Rezdy 那一侧（`aa0b079`，数字会变多，接口不变）；Ops Summary 回复统计只连 tour 行（`f2a3d87`，数字会变）；
  早班发送人数检查只算选中的单（`c2653fe`）；Order Log 列表加 `, al.id DESC`（`f90c746`，稳定排序，ops 导出已按 id 去重、不用改）；
  Dispatch 版面改版（`39465d7`，纯样式，接口不变）；Rezdy API 只读客户端 + 每晚对账未来 30 天（`9216f0d`，**等 Annie 在 Railway 放 key**）。
- **后端下一步**：`task/manifests-fields`（Manifests 新方案，8 条决定见下面小节）；key 到了：对账日志 → 补漏 → A9（执行前和 Annie 再确认）。
- 开工时照例先看后端 main 的新提交（`git -C <后端> log origin/main --since=<上次>`），有改到 ops 已迁页面的就跟。

**验收环境：一条命令**（Annie 2026-10-07 要求：每次提醒验收都附上这条命令。2026-10-07 在公司那台电脑上实测过：登录页能打开，没登录时接口回 401）。
只开本地前端，转发到线上 confirm，**数据是生产数据，发送页点了就真发**。在 PowerShell 里粘贴：

```powershell
cd C:\Code\npe-ops-frontend; git fetch --prune; git switch task/manifests-v2; git pull --ff-only; npm install; $env:API_PROXY_TARGET='https://confirm.nationalparkexpress.com'; $env:NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL='https://confirm.nationalparkexpress.com'; npm run dev
```

然后浏览器打开 `http://localhost:3100/auth/login` 登录，登录后会进 `/dashboard`。家里那台把路径换成家里的前端仓库位置；链尾换了以后，把命令里的分支名一起换掉。
从 `task/ops-login-cancel` 起，登录页走 ops 自己的转发，**不用再临时改 `next.config.ts`**。
没转发的只剩旧后台的样式（`/static`）和 `/admin/*`、`/tracking/*`：登录页可能没有样式，但能用；侧栏标 old ↗ 的链接打开的是线上 confirm，那边要另外登录。
如果命令报端口被占用，先关掉之前开的那个 `npm run dev` 窗口。

**本地验收环境的另两种搭法**（数据都是生产数据）：

- 本地后端 + 本地前端（README「本地登录」）：后端 `.env` 里**一定要设 `DISABLE_SCHEDULER=1`**（后端 2026-10-05 加的），
  不然本地后端会和线上一起跑邮件队列 / 23:59 日报，可能给客人重复发。
- 只开本地前端、转发到线上 confirm（公司那台没装后端依赖时用过）：`.env.local` 设
  `API_PROXY_TARGET=https://confirm.nationalparkexpress.com`、`NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL=http://localhost:3100`，
  并在 `next.config.ts` 的 rewrites 末尾**临时**加 `/auth/:path*`、`/admin/:path*`、`/static/:path*` 三条转发到同一目标（要试 Vehicles 的 Open map 再加 `/tracking/:path*`）
  （登录 cookie 才落在 localhost 上）。**这段不要提交**，用完撤掉。先打开 `http://localhost:3100/auth/login` 登录。

### dashboard 快捷卡链接改到站内

- 分支：`task/dashboard-links`（从 main 拉出）。
- 状态：已完成，lint / typecheck / build 通过；用模拟接口 + headless Chrome 检查 8 个按钮的链接都对；等 Annie 验收。
- 改动：快捷卡 Morning Pickup、Ticket Reminder 的 **Send** 改成站内 `/morning-pickup/send`、
  `/tickets-reminder/send`。三个 **Track**、Bus Tour 的 Send、Broadcast 仍链旧后台（页面还没迁）。
  消息卡片点进去是 tracking 页，也还链旧后台；tracking 页迁过来时一起改。
- 以后每迁一页，记得回来改 `components/dashboard/quick-cards.tsx` 里对应的链接。

**验收步骤**（只读，不会写数据）：

1. 切到 `task/dashboard-links`，同 CLAUDE.md 的本地登录方式启动前后端，打开 `http://localhost:3100/dashboard`。
2. 点 Morning Pickup 的 Send：在 ops 里打开 `/morning-pickup/send`（地址栏还是 localhost:3100）。
3. 返回，点 Ticket Reminder 的 Send：打开 ops 的 `/tickets-reminder/send`。
4. 其余按钮（Tickets / Tour 的 Track、Bus Tour Send、Broadcast 两个）照旧打开旧后台对应页面
   （Morning 的 Track 在下一个分支改成了站内，见下一节）。

### `/morning-pickup/tracking`

- 分支：`task/morning-tracking-page`（从 `task/dashboard-links` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查结果见下；**没有连真实后端发过消息**；等 Annie 验收。
- 接口：列表 `GET /api/notifications/morning-pickup/tracking?date=`（含 `tracking_window`）；
  导出 `GET /api/notifications/morning-pickup/export?date=`（xlsx，数据来自 send_log）；
  对话 `GET/POST /booking-notes/by-order/{order}`（`line=morning`）；
  Take action `PUT /api/bookings/{id}/take-action`（开关）；列顺序 `GET/PUT /api/user-prefs/morning_col_order`。
- ⚠️ `/booking-notes/*` 不在 `/api` 下，`next.config.ts` 只给 `/booking-notes/by-order/:order` 加了转发。
- ⚠️ 对话框的 **Send →** 会真实发短信 / 邮件给客人（SMS 默认勾选，同旧页面）。
- 共用出来的（后面 Tickets / Tour tracking 直接用）：对话弹窗 `components/ui/conversation-modal.tsx`、
  渠道图标和 WhatsApp 窗口 `components/ui/channel-icon.tsx` + `lib/channels.ts`（dashboard 也改用它，外观不变）、
  洛杉矶日期 `lib/la-date.ts`、短信字数 `lib/sms-limit.ts`、账号偏好 `lib/user-prefs-api.ts`。
- 顺带：dashboard 快捷卡 Morning 的 Track、早班消息卡片、Morning 发送页的 View Tracking 都改到站内
  （消息卡片按 `components/dashboard/config.ts` 的 `MIGRATED_TRACKING` 换路径，保留 `?date=`）。
- 与旧页面一致：列和表头、默认列顺序、短信 / 邮件状态归类、WhatsApp 未处理的置顶（绿条）、
  Notes / WhatsApp 预览和 Take action 位置、司机按钮、四个统计、搜索、对话框的标签 / 字数提示 / 勾选框、
  列顺序存账号偏好（**和旧页面同一个偏好**，两边拖过的顺序互通）、追踪窗口过了停止自动刷新（不写死 10:30）。
- 与旧页面的差异：
  - 浅色页面（旧页面是深蓝底），和其他 ops 页面一致。
  - **自动刷新整张表**（签到状态、短信状态、新单都会更新）；旧页面的轮询只更新对话预览，签到要手动 Refresh。
    搜索和司机筛选在刷新后保留。
  - 没有拖列宽、自动列宽（表格按内容自动排版）；列顺序拖拽保留。
  - 地址栏带 `?date=`，dashboard 的消息卡片点进来直接是那一天；刷新页面不丢日期。
  - 修旧页面的 bug：‹ › 在东半球浏览器会差一天；Refresh 后 All 亮着却仍按旧司机筛选；
    Take action 后显示用户名、刷新后才变显示名（现在都显示显示名）。
  - 对话框的提示从 `alert` 改成框内红 / 黄条，内容不变（太长、没送达、出错时保留原文）。
  - 两个渠道都不能用（没电话没邮箱或都没勾）时点 Send 会提示改用 Save note，不发请求。
  - 发送 / 保存中不能关对话框（防止以为没发又发一次）。

**headless 检查**（模拟接口，2026-10-03）：**73 / 73 通过**。覆盖：列顺序读账号偏好（未知键丢弃、新列补齐）；
行顺序（WhatsApp 未处理置顶 + 绿条）；短信 / 邮件状态归类；PAX 0 显示 —；签到列和时间；WhatsApp 窗口
（剩 22h / 已关改用 SMS）；空 WhatsApp 格不可点、空 Notes 是 💬 Chat；Take action 位置、切换和撤销
（重拉后显示显示名、不打开对话框）；Notes 表头数字；四个统计、司机筛选、搜索、No records found.；
对话框（line=morning、正序、投递标签、默认勾选、字数和中文分段、Save note / Send 的请求体、没送达提示、
超长拦截不发请求、Mark as actioned、Esc / × 关闭、无电话无邮箱时禁用并拦截）；列拖拽后存偏好和本机；
‹ / Today / `?date=` / 无效日期；Export 链接；窗口内 60 秒自动刷新且保留筛选、过了窗口不再刷新；
dashboard 和 Morning 发送页链接；未登录跳旧后台登录页带 next。

**验收步骤**（⚠️ 第 5 步会真实发短信；只发到 Annie 自己的号码）：

1. 切到 `task/morning-tracking-page`，同 CLAUDE.md 的本地登录方式启动前后端，打开 `http://localhost:3100/morning-pickup/tracking`。
2. 和旧后台 `/admin/notifications/morning-pickup/tracking` 并排看今天（或最近一个有早班的日期）：行数、顺序、
   各列内容、司机按钮的数字、四个统计一致。
3. 点司机按钮、搜索订单号 / 姓名 / 电话，结果合理；‹ › / 日期框 / Today 换日期，地址栏 `?date=` 跟着变。
4. 拖一个列头换位置，刷新页面顺序还在；打开旧页面，顺序也一样（共用账号偏好）。
5. 找 Annie 自己的那单（或用 Annie 提供的测试单）点 Notes 打开对话：内容和旧页面一致；写一条 Save note，
   出现 ★ Note；再勾 SMS 点 Send →，Annie 手机收到，对话里显示 SMS sent。
6. 在表格或对话框里点 Take action / Mark as actioned，再点一次撤销；旧页面刷新后状态一致。
7. 点 Export：下载 `morning-pickup_<日期>.xlsx`，和旧页面导出的一样。
8. dashboard 的 Morning Pickup Track、Today's Pickup 消息卡片、Morning 发送页的 View Tracking 都打开这一页。
9. 退出后端登录后刷新：跳到旧后台登录页。

### `/tickets-reminder/tracking`

- 分支：`task/tickets-tracking-page`（从 `task/morning-tracking-page` 拉出）。顺带改了共用的对话弹窗
  （支持按门票行 id 取对话）、预览格，早班页同步改用，早班检查要在这个分支上重跑一次。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查结果见下；**没有连真实后端发过消息、没有真的群发过**；等 Annie 验收。
- 接口：列表 `GET /api/notifications/tickets-reminder/tracking?date=`；当天群发记录 `GET /api/broadcasting-log?date=&module=tickets`；
  改状态 `POST /api/tickets-reminder/update-status`；导出 `GET /api/notifications/tickets-reminder/export-csv?date=`；
  对话 `GET/POST /booking-notes/{门票行 id}?source=tickets`（**不是** by-order，门票单在 tickets_reminders 表）；
  Take action `PUT /api/bookings/{门票行 id}/take-action?source=tickets`；
  补录 `POST /api/tickets-reminder/tracking-import-preview` / `tracking-import-commit`；
  群发模板 `GET /api/broadcast-templates`（用 `tix`）、群发 `POST /booking-notes/broadcast/send`。
- ⚠️ `next.config.ts` 新加两条转发：`/booking-notes/:id(\d+)`、`/booking-notes/broadcast/send`。
- ⚠️ 会真实发送的：对话框 **Send →**（单人）、**📣 Broadcast**（群发，一次发给几十上百人）。
- 共用出来的：群发弹窗 `components/ui/broadcast-dialog.tsx` + `lib/broadcast-api.ts`（Tour tracking 直接用）、
  预览格 `components/ui/conversation-preview.tsx`。
- 与旧页面一致：日期（Today / Tomorrow / ‹ ›）、产品按钮（YES 人数 / 总人数）、六个统计和公式（含 Response Rate
  看表里原始邮件状态）、搜索、15 列和 Email / SMS 标签、Notes / WhatsApp 预览和 Take action、Submit Time 的 ★、
  ☰ Columns（隐藏页面列、显示上传名单列，只存本浏览器）、拖列头排序、Download CSV、⬆ Upload 的整个流程和提示、
  📣 Broadcast 的四步、人群口径（只有 YES + 未回复能收，改期 / 取消的不发）、签名自动追加、
  短信按展开后的最坏长度算并拦超长、群发模板接口挂了用内置兜底并提示、当天群发记录、使用说明、60 秒自动刷新。
- 状态下拉：**Annie 2026-10-03 定保留 YES / Pending / Cancel，等后端支持 Cancel**（见「需要后端」）。
  现在选 Cancel 后端会拒，页面改回原值并提示「can't save Cancel yet」（旧页面是悄悄跳回）。
  客人申请改期的单，下拉显示只读的「↻ Reschedule」（旧页面错显示成 YES）。
- 与旧页面的差异：
  - 浅色页面，没有星空页头和 Logout。
  - 自动刷新是静默的（旧页面每分钟闪一次 Loading，还另外多拉一次接口做提示条）。
  - 新消息提示条：第一次加载只记基线，不会把所有有消息的单都列出来；关掉后等下一次有新消息再出现；
    点单号打开的对话带上确认页留言（旧页面这几处是坏的）。
  - 列设置存的是列名（旧页面存列序号），所以旧页面存过的设置不会带过来；没有拖列宽、自动列宽。
  - 不在固定清单里的产品（如 Brenda 免 permit fee）也有自己的按钮（旧页面只能在 Total 里看到）。
  - 群发：点发送后先出确认（人数、短信 / 邮件条数、有几人取消勾选），确认后才发；后端报错时提示先去 Send Log 核对，
    不再显示「Broadcast sent! 0 sent」；结果显示在弹窗里。名字前有空格时 `{first_name}` 也取得到名字。
  - 补录：结果（插入几单、哪些失败及原因）显示在弹窗里；同一单号多行时「Insert anyway」按行勾选。
  - 对话框沿用早班页的样式和文案（标签写 Guest via SMS / Guest，不是 SMS / webPage；处理按钮是
    Mark as actioned，不是勾选框），三个 tracking 页保持一致。
  - 状态改失败时会提示原因（旧页面悄悄改回）。

**headless 检查**（模拟接口，2026-10-03）：**61 / 61 通过**。覆盖：WhatsApp 置顶、15 列、Tour 全名（含不在清单的产品）、
Email / SMS 标签、★、状态下拉（改期只读、Cancel 选项）、确认页留言的预览、Notes 表头数字；产品按钮的人数、六个统计、
按产品筛选、搜索、record 单复数、当天群发记录；改状态的请求体和统计、Cancel 被拒后改回并提示；
对话（`?source=tickets`、确认页留言并进对话、投递结果、Mark as actioned、Send 不带 line）、表格 Take action；
☰ Columns 隐藏 / 上传列 / 存本浏览器 / Reset、拖列头；群发（产品短名、人群计数不含改期单、套模板、发送前统计、
字数、先确认后发、请求体含签名 / 产品名 / 模板名、first_name 去空格、结果、重拉记录、超长拦截、取消勾选的提示）；
补录（没选产品不能选文件、解析失败原因、预览请求、计数和编码提示、默认跳过 / 全部勾选、提交原样传回、重拉、
算不出人数整批禁止）；Download CSV；Tomorrow / Today；60 秒静默刷新后出新消息提示条、点单号开对话；
门票发送页的 View Tracking；未登录跳登录页。

**验收步骤**（⚠️ 第 5、7 步会真实发送；只发到 Annie 自己）：

1. 切到 `task/tickets-tracking-page`，同 CLAUDE.md 的本地登录方式启动前后端，打开 `http://localhost:3100/tickets-reminder/tracking`。
2. 和旧后台 `/admin/notifications/tickets-reminder/tracking` 并排看同一天：行数、顺序、各列、产品按钮的数字、六个统计一致。
3. 点产品按钮、搜索、Today / Tomorrow / ‹ ›，结果合理；☰ Columns 隐藏一列、勾一个上传列，刷新后还在；Reset to default 复原。
4. 找一张 `ZZ Test` 开头的门票单（没有就先用第 6 步补录一张）：Status 改成 YES 再改回 Pending，旧页面刷新后一致；
   选 Cancel 会提示「can't save Cancel yet」并改回。
5. 点那张单的 Notes 打开对话：内容和旧页面一致（含确认页留言）；Save note 出现 ★ Note；
   **只对 Annie 自己的单**勾 SMS 点 Send →，手机收到；Mark as actioned / 撤销，旧页面一致。
6. ⬆ Upload：选产品、选 Annie 提供的测试名单（只含 ZZ Test 的单）：预览数字对、已在列表的默认跳过；Insert 后表格出现新行。**不发消息**。
7. 📣 Broadcast：**只选 Annie 自己那单所在的产品、取消勾选其他所有人**，确认框写明「N selected recipient(s) will NOT receive」，
   确认后只有 Annie 收到；弹窗显示结果，页面上「Broadcasts sent for this date」多一条。
8. Download CSV：和旧页面导出的一样。
9. dashboard 的 Ticket Reminder Track、Tickets 消息卡片、门票发送页的 View Tracking 都打开这一页。
10. 退出后端登录后刷新：跳到旧后台登录页。

### `/settings/pickup-locations`

- 分支：`task/pickup-locations-page`（从 `task/tickets-tracking-page` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **37 / 37 通过**；**没有连真实后端改过数据**；等 Annie 验收。
- 只有 admin 能用（staff 显示 Admin access required）。
- 接口：列表 `GET /api/pickup-locations`；新增 `POST`；修改 `PUT /api/pickup-locations/{id}`（覆盖全部 6 项，每次都传全）；
  停用 / 恢复 `PATCH /api/pickup-locations/{id}/active`；删除 `DELETE /api/pickup-locations/{id}`（还在 Dispatch 排班里 409）；
  改动记录 `GET /api/pickup-locations/log?limit=50`。
- ⚠️ **这页的改动立刻影响线上**：酒店名 / Aliases 决定订单匹配到哪个接客点（早班、Tour 发送、客人页、语音），
  Short 进短信，Details 进邮件和客人页。新增一个名字里含别的酒店名的酒店（例如「ZZ Test MGM Grand」），
  会让「MGM Grand」变得有歧义，那些客人就收不到接客点信息。
- 与旧页面一致：说明文字、新增表单的字段 / 占位 / 提示、地图图片 ＋ / ✕（最多 2 张）、列表各列和缩略图、
  搜索范围（不含 Photo URL）、行内编辑（可同时开几行，搜索时草稿保留）、停用确认文案、恢复不确认、Action Log 的内容和格式。
- 与旧页面的差异（多是修旧页面的 bug）：
  - 酒店名 / Photo URL / Details 照原样显示，不会被当成 HTML；编辑框里有引号也不会被截断（旧页面会截断后存回去）；
    Photo URL、地图地址只有 http(s) 才做成链接。
  - 保存失败的原因写在那一行下面（旧页面弹 alert）；新增的错误照旧写在表单下面。
  - 删除确认多写了后果：客人会收不到这个酒店的接客信息、会从 Dispatch 的团默认站点里去掉，劝改用 Deactivate。
  - 列表拉不到时显示原因和 Retry（旧页面显示「0 locations」）；Add 防连点；计数 1 时写 location；搜索时显示「N of M」。
  - 浅色页面；表单排版改成自适应网格（旧页面 4 列放 7 项，排得乱）；没有窗口底部的横向滚动条，表格自己横向滚动。

**验收步骤**（⚠️ 会改线上数据；只动名字以 `ZZ Test Qzx` 开头的酒店——名字里不要带任何真实酒店名，避免影响匹配）：

1. 切到 `task/pickup-locations-page`，同 CLAUDE.md 的本地登录方式启动前后端，用 admin 账号打开 `http://localhost:3100/settings/pickup-locations`。
2. 和旧后台 `/admin/settings/pickup-locations` 并排看：酒店数、每行内容、缩略图一致。
3. 新增 `ZZ Test Qzx Hotel`：Short 填 `ZZ test`，Aliases 填一个已属于别的酒店的别名（例如 `ResortsWLD`）→ 提示被拒；
   改成 `ZZQZX` → ✓ Added，列表出现这一行。
4. ✏ Edit 这一行：改 Short、加第二张地图图片地址，Save；旧页面刷新后一致；Action Log 展开看到 Added / Changed。
5. Deactivate（确认框文案对）→ 行变灰带 Inactive；Reactivate → 恢复。
6. Delete `ZZ Test Qzx Hotel` → 确认后消失；Action Log 有 Deleted。对一个真实酒店点 Delete 只看确认框文案，**点 Cancel**。
7. 用 staff 账号打开：显示 Admin access required。退出后端登录后刷新：跳到旧后台登录页。

### `/settings/products`

- 分支：`task/products-page`（从 `task/pickup-locations-page` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **40 / 40 通过**；**没有连真实后端改过数据**；等 Annie 验收。
- 只有 admin 能用。页面是两块：商品表（含「还没加进列表」的卡片和 Action Log），以及 **Manifest setup** 面板
  （2026-10-03 后端新加的，迁移文档里没写，接口 `/api/settings/manifest-setup*`）。
- 接口：`GET /api/settings/products`、`/groups`（分类清单由后端下发，前端不写死）、`/missing`、`/log`；
  新增 `POST`；单个改 `PUT /{id}`（**整体覆盖**，内部名 / 组 / 分类三项每次都传）；批量 `PATCH /bulk`（只带要改的键）；
  停用 `PATCH /{id}/active`；Manifest setup：`GET`、`PUT /groups/{id}`（颜色 + 午餐行）、`PUT /groups/{id}/counters`（整组替换）、
  `PUT /products/{id}`（节名 + 类型）。**本页没有删除**（后端也没有）。
- ⚠️ **分类决定订单算进哪些报表**（Dashboard、Orders、Sales Report、Daily Report），改了**过去的订单也跟着变**；
  Manifest setup 改了，下一次打开 / 打印的巴士 manifest 就变。「还没加进列表」点 Add 加进去的行**删不掉**。
- 与旧页面一致：说明文字、各列和组标题、即改即存（内部名离开输入框才存）、缺分类的橙色左边和提示条、Show only these、
  搜索范围、批量工具条（保持不变 / 清空 / 改成某值）、「还没加进列表」卡片（加完变绿不重画、过去的折叠）、
  Manifest setup 的全部字段和说明、Action Log。
- 与旧页面的差异：
  - 保存失败的原因显示在页面上方的红条里（旧页面弹 alert），值改回原来的；Manifest setup 保存失败也改回原值（旧页面不改回，看起来像存上了）。
  - 批量改 / 批量加的确认用页面里的确认框；改分类时红字写明「过去的订单也跟着变」。
  - 「还没加进列表」的清单拉不到时，商品表照常显示（旧页面整张表变成错误）。
  - 商品换了组以后 Manifest setup 面板自动重拉（旧页面要刷新整页）；计数框改了没存会提示「Not saved yet」。
  - 组标题的数字在搜索时写「N of M」；库里有、但后端清单里没有的旧分类值照实显示，不会被下拉悄悄改掉。
  - 浅色页面；没有窗口底部的横向滚动条，表格自己横向滚动。

**验收步骤**（⚠️ 会改线上数据。**不要改分类**——会影响报表的历史数字；只改内部名 / Manifest setup 并改回去）：

1. 切到 `task/products-page`，同 CLAUDE.md 的本地登录方式启动前后端，用 admin 账号打开 `http://localhost:3100/settings/products`。
2. 和旧后台 `/admin/settings/products` 并排看：商品数、分组、每行的组 / 分类 / 内部名、缺分类提示、「还没加进列表」卡片一致。
3. 搜索、Show only these，结果合理。
4. 挑一个商品，把内部名改成 `ZZ test`，点到框外：框变绿；旧页面刷新后一致；再改回原值。Action Log 有两条 Changed。
5. 勾两三个商品，工具条出现；**不要点 Apply**，点 Clear。
6. Manifest setup：选一个**今天没有出团**的巴士团，午餐行加上 ` ZZ`、点到框外 → Saved；旧页面一致；再改回原值。
   （颜色、计数框、节名同理，改了都要改回。）
7. 「还没加进列表」：只看，不点 Add（加进去删不掉）。如果确实要给真实的新产品分类，那就是正式操作，按旧页面的做法来。
8. 用 staff 账号打开：显示 Admin access required。退出后端登录后刷新：跳到旧后台登录页。

### `/broadcasting-log`

- 分支：`task/broadcasting-log-page`（从 `task/products-page` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **23 / 23 通过**；只读页面；等 Annie 验收。
- 接口：列表 `GET /api/broadcasting-log`（`sent_from` / `sent_to` 按**发送日期**（洛杉矶）筛，`module`、`group`）；
  收件人 `GET /api/broadcasting-log/{id}/recipients`。没有分页（后端也没有）。
- **这页不能发群发**（旧页面也不能）：群发在 Tickets tracking 页（Tour tracking 等接口）的 📣 Broadcast 里。
  dashboard 的 Broadcast 卡片 Send / Track 两个按钮都改成链到这一页（同旧页面）；页面上写明了去哪里发。
- 与旧页面一致：发送时间预设（All / Today / This Week（从周日算）/ This Month / Custom）、模块和人群筛选、各列和颜色、
  消息截 60 字（悬停看全文）、展开看收件人、导出的列。
- 与旧页面的差异：
  - **导出是 CSV**（旧页面是 .xlsx，靠外部脚本库）：列相同，带 BOM，Excel 直接打开。不引入新依赖。
  - 门票线群发的人群照实显示 All / Pending / Confirmed（旧页面一律显示 General）；没选模板写 Custom message（旧页面写 custom）。
  - 选了 Custom 但没点 Apply 时写明「Not applied yet」；起止日期颠倒会提示（旧页面静默查不到）。
  - 列表 / 收件人拉不到时显示原因和重试（旧页面显示「No records found.」/「No recipients recorded.」且不再重试）；
    换筛选时旧结果变淡而不是清空，晚到的旧请求不会盖掉新的。
  - 日期预设用下拉框（旧页面是自绘的下拉层）。

**验收步骤**（只读，不会写数据）：

1. 切到 `task/broadcasting-log-page`，同 CLAUDE.md 的本地登录方式启动前后端，打开 `http://localhost:3100/broadcasting-log`。
2. 和旧后台 `/admin/activities/broadcasting-log` 并排看：默认 All 的条数、每行内容一致。
3. 试 Today / This Week / This Month / Custom、模块、人群，结果和旧页面同样条件一致。
4. 点 ▶ Details：收件人和旧页面一致。
5. ⬇ Export：下载 CSV，Excel 打开列和内容对。
6. dashboard 的 Broadcast 卡片两个按钮都打开这一页。退出后端登录后刷新：跳到旧后台登录页。

### `/bug-reports`

- 分支：`task/bug-reports-page`（从 `task/broadcasting-log-page` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **33 / 33 通过**；**没有连真实 ClickUp 写过东西**；等 Annie 验收。
- 这页是 **ClickUp 的代理**，没有本地数据：每个 bug 是 TripGuru-Dev「Bug list」里的真任务。
  ⚠️ **新建 bug、评论、附件都写进线上 ClickUp，本系统删不掉**，要去 ClickUp 手动删；有负责人 / 关注人时 ClickUp 会通知他们。
  评论用共用的 ClickUp 账号发，所以正文前加「当前用户名: 」（同旧页面）。
- 接口：`GET /api/bug-reports/tasks`（含 `truncated`）、`GET /api/bug-reports/task/{id}`（只用附件）、`POST /api/bug-reports/tasks`、
  `GET/POST /api/bug-reports/task/{id}/comment`、`POST /api/bug-reports/task/{id}/attachment`。ClickUp 出错时后端回 502
  `{err, upstream_status, upstream_err}`，页面显示 ClickUp 给的原因。**评论和附件接口 Task Board 也在用**，评论区做成了可复用的
  `components/bug-reports/task-comments.tsx`，迁 Task Board 时直接用。
- 与旧页面一致：中英双语、默认中文（Annie 2026-09-17 定）、六个统计、状态按钮、各筛选和排序、卡片内容、
  展开看描述 / 最新一条（日报标记）/ 评论历史、附件按「同一上传人 + 90 秒内」配到评论上、先传附件再发评论、新建 Bug 弹窗（英文）。
- 与旧页面的差异（多是修旧页面的 bug）：
  - ClickUp 来的标题、描述、名字都照原样显示（旧页面直接塞进 HTML）；只有 http(s) 的链接 / 头像才显示。
  - 截止日按本地零点算（旧页面按 UTC，早一天）。
  - 负责人 / 提交人下拉每次按当前数据重算，不再越刷新越重复。
  - 状态按钮和统计卡的高亮跟实际筛选一致；选状态按钮会清掉状态下拉、反之亦然；「已从该项移出」只在没有别的筛选时显示。
  - 新建 Bug：Reported By 默认填当前登录的人（可改）；任务建好但附件传失败时，再点 Submit 只补传附件，不会建出第二条
    （旧页面会重复建）；错误显示在弹窗里。
  - 评论：发失败保留原文并写原因；只有附件且都传失败时不发「上传了 0 张附件」的空评论。
  - 浅色页面；评论区放大图片用弹窗。
- 新建 Bug 的严重程度改成直接选「Bug Severity」（P0 / P1 / P2…，选项从 ClickUp 字段读）——**Annie 2026-10-03 定**。
  旧页面写的是 ClickUp 自带的 priority（Urgent / High…），而列表、统计、P0–P2 筛选读的是 Bug Severity，所以旧页面新建的 bug
  不显示 P 标签、不算进 P0 / P1；新页面建的会。ClickUp 自带的 priority 不再设。

**验收步骤**（⚠️ 第 5、6 步会写进线上 ClickUp，删不掉；可以跳过，或做完去 ClickUp 手动删）：

1. 切到 `task/bug-reports-page`，同 CLAUDE.md 的本地登录方式启动前后端，打开 `http://localhost:3100/bug-reports`。
2. 和旧后台 `/admin/system/bug-reports` 并排看：统计数字、状态按钮数字、卡片顺序一致。点 EN / 中文 切换。
3. 试各筛选、搜索、排序、统计卡、状态按钮，结果合理。
4. 展开一个 bug：描述、评论、缩略图和旧页面一致；点缩略图放大。
5. （可选）新建一个 `ZZ Test` 开头、**不选负责人**、Severity 选 P2 的 bug，带一张图：列表里出现、带 P2 标签、P2 数字 +1；去 ClickUp 确认后**手动删掉**。
6. （可选）在那条 ZZ Test bug 上发一条评论：出现在评论里，正文前是你的名字。
7. 退出后端登录后刷新：跳到旧后台登录页。

### `/ops-summary`

- 分支：`task/ops-summary-page`（从 `task/bug-reports-page` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **11 / 11 通过**；只读页面；等 Annie 验收。
- 接口：`GET /api/ops-summary/send-stats`、`/response-stats`、`/tickets-response-stats`、`/morning-response-stats`，
  都带 `range=today|week|month|custom`（custom 再带 `date_from` / `date_to`），按**发送日期**算。
- 与旧页面一致：四块内容和全部数字、默认 Today、Custom 要点 Apply、发送统计的卡片 / 渠道表 / 成功率条、各块的标签和颜色、使用说明。
- 与旧页面的差异：
  - 四块各自加载、各自报错（旧页面一个接口失败四块都显示 Failed to load）；错误写出原因。
  - Custom 两个日期没填齐不发请求、提示「Fill in both dates.」（旧页面会悄悄改查本月）；起止颠倒提示；
    选了 Custom 还没 Apply 时写明下面还是上一个范围的数字。所以说明里那条「Custom 填一个日期会显示本月」的警告去掉了。
  - 平均回复小时数是 0 时照写 0h（旧页面 0 会被当成没有）；成功率条按百分比画（旧页面把百分比当像素）。
  - 数字的统计口径全部沿用后端，**没有改**（后端口径的问题见「需要后端」）。

**验收步骤**（只读）：

1. 切到 `task/ops-summary-page`，同 CLAUDE.md 的本地登录方式启动前后端，打开 `http://localhost:3100/ops-summary`。
2. 和旧后台 `/admin/system/ops-summary` 并排看：Today / This Week / This Month 下四块的数字一致。
3. Custom 选一段日期点 Apply，和旧页面同样日期一致。
4. 退出后端登录后刷新：跳到旧后台登录页。

### `/order-log`

- 分支：`task/order-log-page`（从 `task/ops-summary-page` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **16 / 16 通过**；只读页面；等 Annie 验收。
- 接口：`GET /api/activities/order-log`（`date` 按**操作日期**（洛杉矶）筛、只能一天，`order_number`、`event_type`、`actor_type`、
  `page`、`page_size`）。后端固定不含系统事件和 guest_confirmed。
- 与旧页面一致：三个统计、各列和颜色、事件 / 人员筛选、分页、Reset、导出的列。
- 与旧页面的差异：
  - **日期改成单天**（日期框 + Today / Yesterday）：后端只支持一天，旧页面的 This Week / This Month / 多天 Custom
    其实只查第一天（旧页面说明里写着「Not working yet」）。范围要等后端（见「需要后端」）。
  - **导出全部行**（按当前筛选把所有页拉下来，CSV，Excel 直接打开）；旧页面只导出屏幕上的 50 行、是 .xlsx。
  - 事件下拉去掉 Guest Confirmed（后端固定排除，选了永远是空的）；Orders 页写的 Field Updated / Price Override Set / Removed
    补上名字和下拉选项，并算进 Staff Actions（旧页面显示原始代码、不算进任何一组，三个数字加不起来）。
  - 改任何筛选都回到第 1 页（旧页面点 Filter 不回，可能查出空页）；订单号输入后按 Enter 或点 Filter。
  - Detail（含客人留言）、名字照原样显示，不当 HTML；出错显示原因（旧页面显示 No records found.）。
  - 说明文字按新行为改写，去掉了「Not working yet」那条。

**验收步骤**（只读）：

1. 切到 `task/order-log-page`，同 CLAUDE.md 的本地登录方式启动前后端，打开 `http://localhost:3100/order-log`。
2. 和旧后台 `/admin/activities/order-log` 并排看今天：条数、三个统计、每行内容一致（旧页面 Field Updated 那几行显示的是代码）。
3. 选别的日期、事件、人员、订单号，结果和旧页面同样条件一致；翻页正常。
4. ⬇ Export：CSV 里是这组筛选下的全部行。
5. 退出后端登录后刷新：跳到旧后台登录页。

### `/sales-report`

- 分支：`task/sales-report-page`（从 `task/order-log-page` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **13 / 13 通过**；只读页面；等 Annie 验收。
- 接口：`GET /api/sales-report/monthly?year=&product_type=&metric=`、`/weekly?year=&month=&product_type=&metric=`。
  按**团期**算、不含取消；没有代理算 Direct；Orders 数的是预订行（一单多项会算多次，口径沿用后端，未改）。
- 与旧页面一致：年 / 月 / Orders-Pax / Bus Tour-Tickets、四张透视表（代理 × 月、代理 × 周）、0 显示 —、行合计和合计行、导出的列。
- 与旧页面的差异：
  - **导出是 CSV**（旧页面 .xlsx，用的外部库版本有已知安全问题）；数字不带千分位。
  - 只拉当前标签页的两张表（旧页面四张一起拉）；换月份只重拉周表；晚到的旧请求不会盖掉新的。
  - 默认年月按洛杉矶算（旧页面按浏览器本地时间）。
  - 出错显示原因（旧页面 403 / 422 显示成 No data）；代理名照原样显示，不当 HTML；空代理名显示 (blank)。
  - 说明里加了一条：周表的 W1 是 1–7 号、W2 是 8–14 号……（不是周一到周日）。

**验收步骤**（只读）：

1. 切到 `task/sales-report-page`，同 CLAUDE.md 的本地登录方式启动前后端，打开 `http://localhost:3100/sales-report`。
2. 和旧后台 `/admin/system/sales-report` 并排看：同样的年 / 月 / Orders-Pax / 标签页，四张表的数字一致。
3. ⬇ Export：CSV 内容和表格一致。
4. 退出后端登录后刷新：跳到旧后台登录页。

### `/task-board`

- 分支：`task/task-board-page`（从 `task/sales-report-page` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **28 / 28 通过**（评论组件改过，Bug Reports 在本分支重跑 33 / 33）；
  **没有连真实 ClickUp 写过东西**；等 Annie 验收。
- 这页是 ClickUp「Supplier」文件夹的看板（按列表分标签：Supplier Sprint / Requirement pool / Backlog / Bug pool / Assigned to me / 📄 文档），
  只有中文界面（同旧页面）。⚠️ **新建任务、评论、附件都写进线上 ClickUp，本系统删不掉**。
- 接口：`GET /api/task-board/lists`、`/tasks?list_id=`、`/assigned`、`/docs`、`/members?list_id=`、`POST /api/task-board/tasks`
  （提交人由后端按当前登录的人写）；评论 / 附件 / 任务详情用 Bug Reports 那几个接口（评论区是同一个组件，Task Board 的评论前面加 🧩）。
- 与旧页面一致：标签和数字（未完成数）、默认 Sprint（按列表名里的日期）、搜索 / 显示已完成、排序、卡片内容、评论区、新建弹窗（只有两个池子能建）、
  「指派给我」找不到邮箱的警告、文档（Markdown）、截断提示、使用说明（中英）。
- 与旧页面的差异：
  - 切标签时慢的旧请求不会把内容写到新标签上（旧页面会）；刷新只重拉当前标签。
  - 评论发失败再点发送不会重复上传已经传上去的附件（旧页面会）；Bug Reports 页同样受益。
  - 默认 Sprint 同时试今年和去年（旧页面 1 月看到去年 12 月开始的 Sprint 会算错）。
  - 新建：建好但附件失败、或结果不明时按钮锁住，不能再提交（同旧页面的防重复）；弹窗可以点背景关闭。
  - 文档的 Markdown 直接生成页面元素，只有 http(s) 链接可点。
  - 「Assigned to me」仍是按后端配置的固定邮箱查（不是当前登录的人），同旧页面，没改。

**验收步骤**（⚠️ 第 4、5 步会写进线上 ClickUp，删不掉；可以跳过，或做完去 ClickUp 手动删）：

1. 切到 `task/task-board-page`，同 CLAUDE.md 的本地登录方式启动前后端，打开 `http://localhost:3100/task-board`。
2. 和旧后台 `/admin/system/task-board` 并排看：各标签的任务、数字、默认选中的 Sprint 一致；文档标签能看。
3. 展开一个任务：说明、评论、缩略图一致。
4. （可选）在 Requirement pool 新建一个 `ZZ Test` 开头、不指派的任务：列表出现；去 ClickUp 删掉。
5. （可选）在那条 ZZ Test 任务上发评论：正文是「🧩 你的名字: …」。
6. 退出后端登录后刷新：跳到旧后台登录页。

### `/orders`、`/orders/[订单号]`

- 分支：`task/orders-page`（从 `task/task-board-page` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **23 / 23 通过**；**没有连真实后端改过订单**；等 Annie 验收。
- 接口：列表 `GET /api/operations/orders`（`q`、`date_field=tour`、`date_from` / `date_to`、分页 50）；导出 `GET /api/operations/orders/export`
  （后端生成 xlsx，列固定）；详情 `GET /api/operations/orders/{订单号}`；改字段 `PATCH`（确认号、午餐数、价格）；
  解锁价格 `POST …/unlock-price`。改字段写生产库 + activity_log（Order Log 里的 Field Updated / Price Override 就是这里来的）。
- ⚠️ **不要改真实 Rezdy 订单**：确认号是景点前台核对用的，午餐数显示在客人页。测试用 `CHDTESTORDER` 开头的单
  （列表里搜不到，直接打开 `/orders/CHDTESTORDER…`）。新 Rezdy 表里的单是只读的（后端 409）。
- 顺带：Promotion Stats 里点订单号改成打开 ops 的 `/orders?q=订单号`。
- 与旧页面一致：搜索（400ms 防抖）、团期范围（Upcoming 默认 / Today / Next 7 days / This month / All dates / Custom）、12 列和标签、
  分页、导出（超过 5000 行先确认）、空结果的「Search all dates」；详情页各卡片、只读说明、价格保存前确认（写明清空的字段）、Unlock、
  午餐空着不改 / 确认号空着清空、条码只显示后 4 位、原始 Rezdy 数据（截到 2 万字）、使用说明。
- 与旧页面的差异：
  - 带 `?q=` 打开会直接搜这一单、查全部日期（旧页面不读 `?q=`，Promotion Stats 点过来要自己再搜）。
  - 保存失败的原因写成人话（422 写「字段: 原因」，旧页面显示 JSON）；Unlock 失败写原因（旧页面只有状态码）；详情加载失败可重试（旧页面卡在 Loading）。
  - 详情页状态标签按状态着色（旧页面永远绿色）；显示 Tour time、Driver phone（旧页面拿到了没显示）。
  - 列表晚到的旧请求不会盖掉新的；Custom 起止颠倒会提示；导出失败显示原因。
  - 日期范围用下拉框（旧页面是自绘的下拉层）；没有拖列宽。
- ❓ 待 Annie 确认：价格保存的确认框和说明照旧页面写「保存价格会锁住订单，Rezdy 不再更新」，但调研发现后端已经没有地方读这个锁
  （Rezdy 推送不再写 bookings 表），这句话可能已经不准。要不要改说法，需要后端确认。

**验收步骤**（⚠️ 第 4、5 步会写生产库；只改 `CHDTESTORDER` 开头的单）：

1. 切到 `task/orders-page`，同 CLAUDE.md 的本地登录方式启动前后端，打开 `http://localhost:3100/orders`。
2. 和旧后台 `/admin/operations/orders` 并排看：同样的搜索 / 日期范围，条数和每行一致；⬇ Export 下载的文件一致。
3. 点一个订单号：详情页和旧后台 `/order/<订单号>` 一致（条码只显示后 4 位）。
4. 打开 `/orders/CHDTESTORDER…`（从 Settings → Test Orders 找一单）：Operations 改午餐数、Save；Order Log 里出现 Field Updated。
5. 同一单 Price 改 Total → Save → 确认；出现 🔒；点 Unlock 解锁。
6. 打开一张新 Rezdy 的单：红字写只读、没有 Edit。退出后端登录后刷新：跳到旧后台登录页。

### `/settings/content-studio`

- 分支：`task/content-studio-page`（从 `task/orders-page` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **30 / 30 通过**；**没有连真实后端保存过**；等 Annie 验收。
- 只有 admin 能用。接口：`GET /api/template-settings`、`POST /api/template-settings/save`（一次一个键；没种的键 404）、
  `POST /api/template-settings/preview`（只支持门票「Prepare for Your Tour」框，只读）。
- ⚠️ **每次保存都直接改线上文字**：下一条邮件 / 短信、下一次打开的客人页就用新文字；没有历史，改了找不回来。页面顶上有这句警告。
- 与旧页面一致：三个模块和各标签页、全部字段（键、标签、行数、变量）、Global 区（红框、收起）、9 个 / 12 个 tour 选择、
  每行一条的列表（拖动排序、上限）、接客步骤顺序卡、门票准备步骤、群发模板 8 个槽位（前 4 个内置、能改名不能删，5–8 能删，
  - Add template）、签名、按卡片保存 / Cancel（先确认）、Saving… / Saved ✓ / Error、短信按展开后算字数、超 1600 不让存、
    群发模板的名字规则、Last edited by / Original、使用说明。MTLV 那 6 个字段照现状不显示（后端开关是关的）。
- 与旧页面的差异：
  - **预览简化**：显示当前编辑的那一格填上示例数据后的样子（短信是气泡）；门票客人页的「准备」框照旧用后端真实渲染。
    旧页面的邮件 / 客人页整版模拟预览（它自己也写着「Preview only — not actual rendering」）**没搬**，需要的话再补。
  - 变量用文本框 + 「Insert:」按钮插入（旧页面是蓝色小块编辑器）；去掉了原有的变量会提醒；非短信字段可以换行（旧页面一律不能回车）。
  - 修旧页面的 bug：准备步骤「+ Add step」点了没反应、没写标签的步骤一保存就被清空、拖动排序后显示不更新；只保存改过的键。
  - 同一个键出现在两个标签页（问候语、过期说明、页脚）只有一份草稿，两边自动同步。
  - 有没存的改动时：页头写「N unsaved change(s)」，离开页面先提醒。
  - 加载失败显示原因和 Retry（旧页面卡在 Loading）；保存失败写原因（例如 Settings key not seeded），部分保存写明几个成功几个失败。
  - `Thank you page body text (after submit)`（`tmpl__global__guest_thanks_text`）后端没有读也没种，保存会报 404，同旧页面，留着没删。

**验收步骤**（⚠️ 会改线上文字；只做「原样再存一次」或改完立刻改回去）：

1. 切到 `task/content-studio-page`，同 CLAUDE.md 的本地登录方式启动前后端，用 admin 账号打开 `http://localhost:3100/settings/content-studio`。
2. 和旧后台 `/admin/settings/templates` 并排看：三个模块、各标签页、每个框里的文字、Last edited by 一致。
3. 点进一个框：右边预览显示填好示例数据的文字；短信框显示字数。
4. 挑一个不常用的框（例如 Tickets → Global → Staff email — heading），**不改内容直接 Save**：变 Saved ✓，Last edited by 变成你。
5. Tickets → Guest Page → 选一个门票：准备步骤和右边的真实预览与旧页面一致。**不要保存**。
6. Broadcasting：模板数量、名字、正文、签名与旧页面一致。**不要删内置模板**。
7. 用 staff 账号打开：显示 Admin access required。

### `/settings/hr`（Human Resource）

- 分支：`task/hr-page`（从 `task/content-studio-page` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **40 / 40 通过**；**没有连真实后端保存过**；等 Annie 验收。
- 只有 admin 能用。接口全在 `/api/hr/*`（后端 main 上已有）：列表、可关联账号、改动记录、新增 / 修改 / 删除、
  Edit list 批量改（`/profiles/bulk`）、导出 Excel（POST）、导入预览 / 提交（.csv / .xlsx）。
- ⚠️ 名单里有驾照号、生日、私人邮箱、紧急联系人等个人信息；导出的 Excel 不含这些（后端定的 16 列）。
- 与旧页面一致：24 个字段和分组、Login Account 关联（只列没被占用的 driver / guide 账号，当前关联的补进下拉）、
  驾照 / 医疗卡到期 pill（ok / due soon / expired，按后端算的洛杉矶日期）、驾照过期整行红底、Edit list
  （改过的格子标黄、底部保存条、改回原值不算、整批一个事务、出错写是谁）、删除两步确认（还在排班表上会再问一次）、
  导入预览（计数、徽章、勾「Also update people already on the list」后重新预览、Import and update N）、
  Action Log（只记字段名不记值）、How to use。
- **列顺序用 Annie 2026-09-30 定的新默认**：Legal Name、Nickname、Position、Mobile、Assignment、Limited、Language、
  License #、两个到期日、Login Account（后端分支 `task/hr-list-columns`，旧页面还没上线这个顺序）。
  拖列标题换位置、拖右边缘调宽、Reset columns，顺序和列宽都存（同那个分支的决定）；格式与旧页面分支一致，两边互通。
  后端 2026-10-04（ops-backend-apis-2 c）已在 main 上认 `hr_list_layout`：页面原来的逻辑就是先存账号、404 才退回本机，
  所以**不用改代码**，现在写「saved to your account.」。旧后台 HR 页接这个键的改动还在后端 `task/hr-list-columns`（待办 G20）。
- 表格比窗口宽时，窗口底部有一条横向滚动条（同那个分支的决定）。
- 与旧页面的差异 / 修的 bug：
  - Edit list 里 Position 下拉按原顺序（旧页面是乱的）。
  - 库里有不认识的单选值时照样显示在下拉里（旧页面会悄悄清空、一保存就丢）。
  - Add / Edit 弹窗有改动时点背景或 Cancel 先问（旧页面直接关、填的全丢）；Esc 也能关。
  - Edit list 有没存的改动时，离开页面先提醒。
  - 导入预览里的单选显示标签（旧页面显示 full_time 这种存的值）；导入成功后计数行一起收起。
  - 导出失败、加载失败写原因（旧页面加载失败写的是给开发看的 migrate_v51.sql）。
  - 日志里导出写成「exported N row(s) to Excel」（旧页面只写 export）。
  - 字段定义照抄后端（后端没有字段接口）；后端改字段要同步改 `components/hr/fields.ts`。

**验收步骤**（⚠️ 写生产库：新建 / 改 / 删只动名字以 `ZZ Test` 开头的人；导入只用只含 `ZZ Test` 行的文件）：

1. 切到 `task/hr-page`，同 CLAUDE.md 的本地方式启动，用 admin 账号打开 `http://localhost:3100/settings/hr`。
2. 和旧后台 `/admin/settings/hr` 对比：人数、每人的字段、到期 pill 和红底、linked / no account 一致（列顺序是新的）。
3. Add person：Legal Name 填 `ZZ Test HR`，勾一个 Assignment，Save → 出现在列表里；Action Log 有「added」。
4. 点它的 Edit：改 Nickname、Save；再 Edit → Delete → 确认 → 消失。
5. Edit list：只改 `ZZ Test` 那一行（先再建一个），Save changes → 绿条「1 profile saved」；Done。
6. 拖一列标题、拖宽一列，刷新后还在；换一台电脑（或无痕窗口）登录也在；Reset columns 回默认。
7. Export to Excel：下载 `NPE_Driver_List_<日期>.xlsx`，列与旧页面导出一致。
8. Import from Excel：用一个只有 `Legal Name` 一列、一行 `ZZ Test Import` 的 .csv，看预览 → Import → 列表里出现，然后删掉它。
9. 用 staff 账号打开：显示 Admin access required。

### `/settings/vehicles`

- 分支：`task/vehicles-page`（从 `task/hr-page` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **33 / 33 通过**（含下面的 v69 跟进）；**没有连真实后端保存过**；等 Annie 验收。
- **跟进后端 `vehicle-capacity`（2026-10-04 00:33 合进 main，migrate_v69）**，在链尾 `task/app-nav` 上做的：
  - Extra columns：staff 自己加列（只收文字）、Rename、Hide / Show（不删，值留着）；显示着的列进表格、能在 Edit 里填；搜索也搜这些列。
  - Edit all → Save all：所有行一起打开，只送改过的；**有一台出错就整批不存**，出错的行标红写原因；有改号先确认。
  - Action Log：自加列的改动按现在的列名显示；加 / 改名 / 隐藏 / 显示列的记录。
- 不在 2026-09-28 的迁移清单里（页面是 10/01 才加的），接口齐全（`/api/settings/vehicles*`），为了「全部做完才切换」一起做了。
- 只有 admin 能用。车不能删，只能停用 / 恢复。
- ⚠️ Samsara 链接就是客人追踪页跳过去的地址；车号写在已发出的追踪链接里，**改号会让旧链接看不到地图**（页面先弹确认，后端也要求 `confirm_rename`）。
- 与旧页面一致：新增表单（车号 / Samsara 链接 / 座位 / 备注）、搜索车号和备注（正在编辑的行不被藏掉）、
  多行同时编辑、整行保存（座位不漏）、改号确认、停用 / 恢复（不确认，同旧页面）、Live GPS / Open map、In Dispatch 天数、Action Log、How to use。
- 与旧页面的差异：改号确认用页面弹窗（旧页面是浏览器 confirm）；停用失败写在页面上（旧页面 alert）；日志动作写成 Added / Edited / Renumbered / Deactivated / Reactivated。

**验收步骤**（⚠️ 写生产库：只动车号以 `ZZ` 开头的车；车删不掉，测完停用即可）：

1. 切到 `task/vehicles-page`，同 CLAUDE.md 的本地方式启动，用 admin 账号打开 `http://localhost:3100/settings/vehicles`。
2. 和旧后台 `/admin/settings/vehicles` 对比：车辆数、每台车的 GPS / 座位 / 备注 / In Dispatch 天数 / 状态一致。
3. 新增车号 `ZZ 1`（不填链接、座位 12）→ 绿字提示、出现在列表里。
4. Edit `ZZ 1`：改备注、Save；再 Edit 改车号为 `ZZ 2` → 弹确认 → Change number → 列表更新。
5. Deactivate `ZZ 2` → 变 Inactive；Action Log 里有 Added / Edited / Renumbered / Deactivated。
6. 用 staff 账号打开：显示 Admin access required。

### `/dispatch/work-sheet`、`/dispatch/guide-sheet`

- 分支：`task/dispatch-sheets`（从 `task/vehicles-page` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **24 / 24 通过**；
  与旧页面版式对比 **4 / 4 通过**（两张单子每个格子的位置、大小与旧页面相差不到 1px，内容高度一样：Work 270.7mm、Guide 276.4mm，都在一页 A4 内）。等 Annie 验收。
- 不读写库、不发任何东西（同旧页面）：草稿只在本机浏览器，Save file / Open file 存成本机文件，Save as PDF 用浏览器打印。
  登录的员工都能用（同旧页面 require_staff）。
- 做法：格子照旧模板写成静态 JSX（id 一个不改），工具条的行为（加 / 删行、拖宽度、页数、标红、存取文件、Clear all、共享 CHD 抬头）
  照旧脚本原样移植成 `components/dispatch-sheets/sheet-engine.ts`。
- ⚠️ 与旧页面的差异：ops 和旧后台是两个域名，**浏览器里的草稿和 CHD 抬头不会自动带过来**。旧后台存过的单子：
  在旧页面点 Save file，再到 ops 点 Open file（文件格式一样）；抬头在 ops 填一次就记住。How to use 里加了这句。

**验收步骤**（不碰生产数据）：

1. 切到 `task/dispatch-sheets`，本地启动，打开 `http://localhost:3100/dispatch/work-sheet`，和旧后台 Dispatch → Work Sheet 并排看：版式一样。
2. 填几格、+ Row 加几行、拖一个格子的边变宽，刷新：都还在。
3. Save as PDF：打印预览是一页 A4、没有工具条；加很多行后提示「This sheet is now 2 pages」。
4. Save file 下载 json；Clear all 点两下清空（CHD 抬头保留）；Open file 选刚才的文件：恢复。
5. 在旧后台 Work Sheet 点 Save file，到 ops 点 Open file：能打开。
6. 打开 `/dispatch/guide-sheet`：CHD 抬头和 Work Sheet 的一样；Booked Tickets 的 + Row 一次加一整行 3 格。

### 门票发送页：防重发（单独分支，不在分支链上）

- 分支：`task/tickets-send-resend-guard`（**从 main 拉出**，因为这页已在 main 上线；也已合进链尾 `task/dispatch-sheets`）。
  验收通过就**单独合进 main**，不用等分支链。
  ⚠️ 2026-10-05 全链审查对这页的三处修正（Apply 存的时候 Start Over 关着、断网文案、No address 单独算）只在链尾上；
  单独合这个分支就没有它们，切换前合链尾时会带上。
- 状态：lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **25 / 25 通过**（含重新上传比对 + Apply）；没有连真实后端发过。
- 跟后端 2026-10-03 晚的防重发（`c40d85a` / `8603393`）对齐旧页面 `send_tickets.html`：
  - `send-bulk` 带 `send_anyway`（勾了 Send anyway 的订单）和 `preview_at`（预览时服务器给的时间）：Send anyway 只再发一次，再点不会发第三次。
  - 文件里同一单第二行（内容一样）标 Listed twice in this file，不发、也没有 Send anyway。
  - 预览就整批拦：CSV 人数算不出（Qty 显示 ? 标红）、同一单两行内容不同、缺订单号——分批发时后面一批被后端拒掉，前面几批已经发出去了，所以必须在发之前拦。
  - 断开 / 5xx：红框「可能已经发出，先看 Send Log」（链到 ops 的 `/send-log`），列出状态不明的那一批和没发的，不再给发送按钮；400 写后端原因、标明那一批没发。
  - 结果：Sent / Failed / Skipped / Total，跳过的单逐条写原因（含服务端发前查重跳过的）。
  - 每批仍是 10 位（`lib/send-batches.ts`，比旧页面的 25 更保守，早班页共用）。
- 顺手修的已上线 bug：
  - **CSV 人数为空时 ops 会当 1 发**（送 `quantities || 1`），违反 Annie 10-02「算不出不能当 1」。现在 CSV 送原文，由后端算、算不出整批拦。
  - 文件框只收 .xlsx，旧页面早已收 Rezdy CSV：现在收 `.csv,.xlsx`；CSV 编码是猜的时显示黄色提示；`upload_row` 原样带给后端。
  - 加了 How to use（照旧页面）。
- 重新上传比对 + Apply（同旧页面 upload-row）：这个团期已有订单时，预览上方蓝框列出 Added / Removed / Changed（旧值 → 新值）和计数，
  表格每行标 Added / Changed / No change，Removed 的单划掉列在表尾、不在发送名单里。`Apply N changes` 把 Added、Changed 存进系统，
  **不发任何消息**；有整批拦截（人数算不出等）时不能 Apply。How to use 也补了这两条。

**验收步骤**（⚠️ 发送会真发：只用 Annie 提供的、只含她本人信息的文件）：

1. 切到 `task/tickets-send-resend-guard`，本地启动，打开 `http://localhost:3100/tickets-reminder/send`。
2. 用只含 Annie 本人的 Rezdy CSV（文件名带日期）上传：Qty 显示人数和票种；把同一行复制一份再上传：第二行标 Listed twice in this file。
3. 发一次（SMS Only 即可）：结果 Sent 1。再上传同一个文件：标 Duplicate；不勾直接发：0 位要发；勾 Send anyway 发：Sent 1。
4. 同一个文件、同一次预览里再勾 Send anyway 点一次：结果里写 Skipped: Already sent for this date and tour（不会发第三次）。
5. 把文件里的 Quantities 清空再上传：红框说人数算不出，发送按钮灰掉。
6. 重新上传比对：用同一团期、改过一个 check-in 时间的文件上传：蓝框显示 Changed（旧 → 新）；点 Apply：写「Saved: … Nothing was sent.」，
   Send Log 里没有新记录；去门票 tracking 看到新的 check-in 时间。

### Send Log / Order Log 日期范围、MTLV、门票列设置（后端 `ops-backend-apis` 跟进）

- 分支：`task/ops-api-catchup`（从 `task/dispatch-sheets` 拉出）。
- 状态：lint / typecheck / build 通过；新检查 **18 / 18**；门票跟踪全套 **63 / 63**（原 61 + 列设置 2）；Order Log 原有 **16 / 16**（改成新参数后）。等 Annie 验收。
- 新共用控件 `components/ui/date-range-presets.tsx`：Today / Yesterday / This Week（周日起，同旧页面）/ This Month / Custom（两端必填、开始不能晚于结束，Apply 才查）。全部按洛杉矶日期。
- `/send-log`：
  - 日期改成范围（同旧页面的五个选项；旧页面多天其实只查第一天，这里是真的范围）。
  - 加回 **MTLV 卡片和 MTLV 列**（`send_log.mtlv_eligible`，同旧页面那一列）：点卡片或表里的 MTLV 标签 = 只看 MTLV；点模块卡片 = 去掉 MTLV。
  - Export 带同一个日期范围和模块（不管 Type / Status / MTLV，按钮提示里写了）。
- `/order-log`：
  - 日期改成范围（同上）；导出文件名 `order_log_<from>_to_<to>.csv`（单天照旧）。
  - 范围开始早于 2026-09-12 时，黄条提示「那之前员工操作的时间早 7–8 小时，凌晨的会落到前一天」（后端待办 E131）。
  - 订单号搜索后端改成按字面包含（% _ 不再是通配符），页面不用改。
- `/tickets-reminder/tracking`：列设置（顺序、隐藏、文件列）存进账号（`tickets_col_order`，值是本页的 `{order, hide, file}`）；
  本机缓存先画，账号里的到了再覆盖，换电脑也在。旧页面不用这个键。
- `/ops-summary`：后端只修了 SQL 注入（`a1b3bce`），统计口径没动；Custom 两端必填、不能颠倒，页面原来就拦了，不用改。

**验收步骤**（只读，列设置除外）：

1. 切到 `task/ops-api-catchup`，本地启动。
2. `/send-log`：点 This Week，记录数和旧后台 Send Log（This Week）对比——旧页面只算了周日一天，这里应 ≥ 那个数；Custom 选两天 → Apply；
   只填一端点 Apply 提示「Fill in both dates.」。点 MTLV 卡片只剩 MTLV 行；Export 下载的 CSV 是同一段日期。
3. `/order-log`：This Month 能看到整月；Custom 选 9/1–9/30 出现黄条提示；Export 文件名带范围。
4. `/tickets-reminder/tracking`：拖一列、隐藏一列，换一台电脑（或无痕窗口登录）打开：设置还在。

### `/dispatch/manifest`（Tour manifest）+ Tour manifests 面板

- 分支：`task/dispatch-manifest`（从 `task/ops-api-catchup` 拉出）。
- 状态：lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **26 / 26 通过**（在 `task/dispatch-assignments` 上重跑过，面板已挪进排车页）；没有连真实后端写过。等 Annie 验收。
- Tour manifests 面板（每个 bus tour 一张卡、上传 Rezdy CSV → Added / Removed / Changed → Apply）：在 `task/dispatch-manifest` 上
  先放在临时页 `/dispatch/manifests`；`task/dispatch-assignments` 把它挪进排车页 `/dispatch`（同旧页面位置），临时页删了。
- `/dispatch/manifest?date=&tour=`：照纸本版式，每台车一块（色条：团名、司机、导游、日期、BUS #、Print）、节标题用节颜色、
  shuttle 节票种后标 OUTBOUND / INBOUND、票种有 + 标黄、三明治读不出红字原文、司机标的 ✓ / No show、按车选客人（lettered）、
  黄框（景点确认信息）、底部计数格、Not on a bus yet 区块、How to use。
- 打印、下载：**用后端原来的打印页和 Excel**（`next.config.ts` 转发 `/admin/dispatch/manifest/print` 和 `/download`），版式和打印日志都不变。
- 与旧页面的差异：
  - 黄框只在离开整个框、而且改过时才存（旧页面每离开一格都存，没改也存，会插空行）。
  - 有加载中、链接缺日期 / 团的提示；Back 回到同一天的 Dispatch（旧页面回排车页时丢了日期）。
  - 选车失败时写原因，下拉回到原值。

**验收步骤**（⚠️ 上传 / Apply / 选车 / 黄框都写生产库：找一个已经过去或不跑的团期试，或只改黄框里的字再改回去）：

1. 切到链尾分支，本地启动，打开 `http://localhost:3100/dispatch`，换到旧后台 Dispatch 上有 bus tour 的那天：Tour manifests 卡片和旧页面一样。
2. Open manifest：和旧后台 manifest 页对比每台车、每节、每位客人、颜色、底部数字。
3. Print all buses / 单台车 Print：新标签打开的打印页和旧后台一样；Download 下载的 Excel 一样。
4. 黄框改一格、点到框外：显示 Saved，刷新还在；再改回去。

### `/dispatch`（Dispatch → Assignments 排车）

- 分支：`task/dispatch-assignments`（从 `task/dispatch-manifest` 拉出）。
- 状态：lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **39 / 39 通过**（含审查修正，跑了两遍）；没有连真实后端存过。等 Annie 验收。
- 审查（子代理对照旧页面和后端）找到的问题已修在 `task/app-nav`（链尾）上：
  - 重新读这一天失败（例如 Copy / Save 成功后重读 502）：所有按钮关掉，不会把旧的那份整天写回去（同旧页面）。
  - 换天读取中：按钮都关着；连点只认最后一次。
  - 有未保存的改动时点侧栏 / Open manifest 这类站内链接：先问（前端跳转不触发浏览器的离开提醒）。
  - Discard 不再把 CCL 的 Closed 标记丢掉（关闭的线单独存）。
  - 没司机标红的那一行改了别的框，红框还在。
  - 日期框打字时年份没打完不跳；开发环境 StrictMode 不重复读 / 拉；Tour manifests 面板一个预览在读时不能再选别的文件；
    manifest 页选车成功但重读失败时只提示，不把整页变成错误。
- ⚠️ **保存是整天覆盖**（后存的赢，没有版本检查，同旧页面），存了以后司机手机页和 manifest 立刻读到；Copy 也是直接写库。
  保存不发短信；手填了 HR 里没有的人时，后端给 Annie 发一封邮件（每个名字一次）。
- 与旧页面一致：日期切换（默认明天）、五类块（Morning Relay 两轮一排一行；Bus Tour 按团一块一台车；Private Tour 多一个团下拉）、
  司机下拉过滤（Assignment、驾照在这一天之前过期的不列、选上的人永远留着并说明）、Driver Guide（只有 Driver + Guide 的人能选、
  换司机时导游跟着）、手填 HR 里没有的人 / Custom 团名（弹框，同旧页面）、车 / Bus 字母 / 酒店（Relay 同一轮一家酒店一台车、
  停用的不列、同团另一台车去了的注明）、新加团车带默认站点并编号、Edit 菜单（Clear hotels / Remove vehicle）、备注、
  顶部统计和 issue box、右栏 Schedule check（全部提示条目和点了滚到那一行）、没司机不让存（标红 + 滚过去）、服务端原话显示在底部保存条、
  N unsaved changes / Discard / 离开前提醒、Copy、Pull from Discord（打开时静默拉一次）、CCL 预填（蓝条）/ 改版（琥珀条、Apply changes）/
  关闭的团、Who CCL meant、View CCL’s message、How to use、Tour manifests 面板（挪进来了）。
- 7 个模板常量（班次、轮次名、Assignment 对照、Bus 字母）读 `GET /api/dispatch/day` 的 `meta`（后端 2026-10-04 加，`task/ops-api-catchup-2` 跟进）；
  接口没带时用 `components/dispatch/config.ts` 里的原值兜底。
- 与旧页面的差异：
  - 认 `?date=`（旧页面不认，永远打开明天），换天时地址跟着变，可以收藏 / 发链接。
  - 确认用页面弹窗（旧页面浏览器 confirm）；Copy 时有未保存的改动也会说（旧页面不提醒就覆盖）。
  - Copy 成功一定有一句话（旧页面什么都没丢时一声不吭）；邮件没发出去、复制丢了车用一直在的提示条（旧页面 alert）。
  - Relay 酒店被手填的人占了时写那个名字（旧页面写 another vehicle）。
  - 右栏底部的话改成「Nothing is sent from this page. Drivers see the saved schedule on their phone page.」（旧页面写「nothing reads this schedule yet」，已经不对）。
  - 旧页面的司机头像在 Relay 行保留；团块左边的车牌条同旧页面。

**验收步骤**（⚠️ 保存 / Copy 写生产库、司机马上看得到：**只在一个已经过去、或确定不跑的日子上试**，试完 Discard 或改回去）：

1. 切到 `task/dispatch-assignments`，本地启动，打开 `http://localhost:3100/dispatch`：和旧后台 Dispatch 同一天对比每块、每台车、右栏。
2. 换到一个过去的日子：改一个下拉，底部出现 1 unsaved change；Discard 回到原样；换天时先问。
3. 有 CCL 消息的日子（旧后台 Dispatch Imports 里有的）：蓝条 / 琥珀条和旧页面一样（只看，不存）。
4. Tour manifests 面板在页面上方，跟着日子变。

### 整站侧栏导航

- 分支：`task/app-nav`（从 `task/dispatch-assignments` 拉出）。
- 状态：lint / typecheck / build 通过；headless Chrome 检查 **12 / 12 通过**；纸本单子打印回归 24 / 24。等 Annie 验收。
- 之前 ops 没有任何导航（只能从 dashboard 快捷卡或手打地址进）。现在每页左边有侧栏，分组、顺序、名字照旧后台：
  Dashboard / Operations / Notifications / Activities / Reports / Messages / Settings（只有 admin 看得到，同旧后台）。
  - 迁过来的页面走站内；还没迁 / 不迁的（Manifests、Dispatch Imports、Tour Confirmation、Messages）链回旧后台，标 `old ↗`。
  - 旧后台的占位页（30 Days Forecast、General）显示 Coming soon、不可点。Test Orders 旧后台现在也藏着，这里不放。
  - 当前页高亮；Morning Pickup / Ticket Reminder 的 tracking 页算在各自下面；manifest 页算在 Dispatch 下。
  - 底部显示登录的人和角色；Sign out 走旧后台的 `/auth/logout`。
  - 窄屏收起，点左上角 ☰ 打开；打印时不印；`/login` 占位页不显示。

**验收步骤**：打开任意一页，用侧栏点一遍每个入口；用 staff 账号看不到 Settings；窗口拉窄看 ☰。

### 后端 ops-backend-apis-2 / morning-bus-link 跟进 + `/dispatch/imports`

- 分支：`task/ops-api-catchup-2`（从 `task/app-nav` 拉出）。
- 状态：lint / typecheck / build 通过；检查：排车页 **42 / 42**（原 39 + meta 3）、Morning Tracking **76 / 76**（原 73 + Bus # 3）、
  Dispatch Imports **26 / 26**、侧栏 **12 / 12**。都是模拟接口 + headless Chrome；没有连真实后端。等 Annie 验收。
- 接口说明以后端规则文档第五节第 5b、6 行为准。
- **排车页常量**（6b）：7 个常量改读 `GET /api/dispatch/day` 的 `meta`，每读一天换一次；顶部覆盖数的「1st Round / 2nd Round」也用 `round_names`。
  接口没带 `meta` 时用原来照抄的值。
- **HR 列布局**（6c）：后端 main 已认 `hr_list_layout`，页面不用改（见 HR 一节）。
- **Morning Tracking 的 Bus #**（5b）：`samsara_url` 是 `https://` 开头时，Bus # 做成新标签页链接（`noopener noreferrer`），
  没链接照旧是文字；表格上方加一行蓝字「Click a Bus # to see live tracking (opens Samsara in a new tab)」（同旧页面）。不嵌 iframe（Samsara 不让）。
- **`/dispatch/imports`（Dispatch → Imports）**（6a）：`GET /api/dispatch/imports?since=`、`POST /api/dispatch/imports/pull`（trigger manual）。
  侧栏的 Dispatch Imports 改成站内（不再标 old ↗）。
  - 与旧页面一致：Pull from Discord 和结果那句话（绿 / 红）、上次拉取时间、上次失败原因、How to use（默认收起）、Show days from、
    每版一张卡（日期、Pending / Applied / Superseded、Revision、N lines not read、标题、车数、posted / edited 洛杉矶时间）、Show original message、
    关闭的团（Closed 或 CCL 原话）、8 列（段名下写团名 / Morning Relay · 1st Round / Private Tour、对上的「→ 名字」、No match（分不清时列候选）、
    停用的车标 (inactive)、读不出的行红底写原因和原文）、空列表提示。
  - 与旧页面的差异：拉到新东西时只重拉列表，结果那句话留着（旧页面 2 秒后整页刷新）；地址栏带 `?since=`；
    列表拉不到时显示原因和 Retry（旧页面整页报错）；日期读不懂后端回 400 会显示原因（旧页面悄悄换成默认）。
  - 名字按**现在**的 HR 重新匹配（后端定），所以和导入那一刻可能不同。

**验收步骤**（只读；Pull from Discord 只读 Discord、写导入表，不动排车，同旧页面）：

1. 切到 `task/ops-api-catchup-2`，本地启动。
2. `/dispatch/imports`：和旧后台 Dispatch Imports 并排看同一个起始日：卡片数、每张卡的头、每一行、关闭的团一致；改起始日点 Show 一致。
3. 点 Pull from Discord：下面一句话和旧页面一样（没新东西 / 新的几条 / 失败原因）。
4. `/dispatch`：顶部两个「relay hotels · 1st Round / 2nd Round」照常；Bus 字母下拉 A–E。
5. `/morning-pickup/tracking`：选一个有车号的日子，Bus # 是蓝色链接，点开是 Samsara（新标签页）；车号不在 Vehicles 里的是黑字。
6. `/settings/hr`：拖一列，换无痕窗口登录，列顺序还在；提示写「saved to your account.」。

### `/tour-confirmation/send`（Tour Confirmation 发送，含 Last Minute）+ Send Log 的 Send batches

- 分支：`task/tour-send-page`（从 `task/ops-api-catchup-2` 拉出）。
- 状态：lint / typecheck / build 通过；模拟接口 + headless Chrome：Tour 发送 **50 / 50**、Send Log **27 / 27**（原 18 + Send batches 9）、
  门票发送 **28 / 28**（原 25 + 建批次 3）。**没有连真实后端发过**。等 Annie 验收。
- 接口：团型 `GET /api/notifications/tour-confirmation/tour-types`（后端 2026-10-04，待办 B28 部分解决）；消息预览 `GET …/message-preview`；
  上传预览 `POST /api/notifications/tour-confirmation/preview`（multipart；Last Minute 带 `lane=last_minute`，Removed 只比 Last Minute 的行）；
  建批次 `POST /send/tour-batches`；发送 `POST /send/tour-confirmation-bulk` / `/send/last-minute-confirmation-bulk`；Apply `POST /send/tour-confirmation-apply`。
- ⚠️ `next.config.ts` 新加四条转发（只这四条，不整个转发 `/send/*`）：`/send/tour-batches`、两个 bulk、`/send/tour-confirmation-apply`。
- ⚠️ **会真实发送**：两块的 Send（团确认、Last Minute）。服务端每发一位前拿锁再查重（团确认 / Last Minute 任一发过都算），Send anyway 只再发一次。
- 与旧页面一致：两块（General Order Confirmation / ⚡ Last Minute Order）各自独立；团型下拉（文字来自接口，与旧页面一字不差）；
  文件名查团名片段（接口的 `file_slug`）+ 日期，不符先确认；消息预览（Regular 那一块，三个标签）；预览表 11 列（CSV 才有 Quantities 列、MTLV 列
  Eligible / 🎫 N）、已发过写「Sent by 谁 on 何时」+ Send anyway、Listed twice、整批拦截（人数算不出 / 同单内容不同 / 缺订单号）、
  缺邮箱 / 缺电话 / CSV 编码黄框；重新上传比对 + Apply（不发消息，Last Minute 的 Apply 带 lane）；先建批次再发、结果 Sent / Failed / Skipped / Total、
  Send Report（没邮箱 / 没电话）、View this send、两块各自的 How to use。
- 与旧页面的差异：
  - **每 10 位一组**（旧页面 25，同 ops 其他发送页）；发送前多一个确认框（单数、跳过几单、Send anyway 哪几单、方式）。
  - 某一组出错就停：断开 / 5xx 写「⛔ 可能已发，先看 View this send」、列出状态不明和确定没发的；400 写服务端原因、标明那一组没发
    （旧页面只认第一组的 400，后面的 400 也当成「可能已发」）。建批次失败时确认框里写原因，什么都没发。
  - 结果表的状态写成人话：Sent / Failed: 原因 / No email / No phone / —（旧页面照抄原值，例 `sent:SM…`）。
  - 修旧页面的 bug：Last Minute 的文件名提示读的是上面那块的团型下拉。
  - 浅色页面；Last Minute 在预览时上面那块的表单照常显示（同旧页面）。
  - 「View Tracking」暂时链旧后台（Tour tracking 还没迁）。
- **Send Log 的「📦 Send batches」**（后端 G23，2026-10-04 合进 main，之前 ops 没跟）：`GET /api/send-batches?date_from=&date_to=`（同 Send Log 的日期范围）、
  点开取 `GET /api/send-batches/{id}`。每批一行默认收起（Sent at、团名（Last Minute 后缀）、团期、谁、Sent / Failed / Skipped / Not sent），
  展开是五个数字、邮件 / 短信送达情况、有失败或没发时的提示、逐单明细、跳过的单和原因、↻ Refresh。地址带 `?batch=<id>` 时那一批自动展开、高亮、滚过去；
  不在所选日期里也单独取来放最上面（同旧页面）。
- **门票发送页也先建批次**（同旧页面）：`POST /api/tickets-reminder/batches`，每组带 `batch_id`；结果页有 View this send，断开提示链到这一批。
- 审查（子代理对照旧页面和后端，没找到会重发 / 发错人的问题）后修的：Apply 存的时候发送按钮灰掉（同一单两边同时写库会多一行）；
  建批次回的不是批次号就不发、发送回 200 却不是结果就按「可能已发」停下；发送中点侧栏等站内链接先问（三个发送页共用 `lib/use-leave-guard.ts`，
  早班发送页也换成它）；Send batches 连点 ↻ Refresh 只认最后一次。Tour 发送检查加到 **50 / 50**。
- 共用：比对框挪到 `components/ui/upload-compare-panel.tsx`（门票、巴士两页共用）；`blockReasons` / `isCsvRow` 改成结构类型，两页共用。

**验收步骤**（⚠️ 第 4、6 步会真发：只用 Annie 提供的、只含她本人信息的文件；选一个确定没有真实客人的团期）：

1. 切到 `task/tour-send-page`，本地启动，打开 `http://localhost:3100/tour-confirmation/send`。
2. 和旧后台 Tour Confirmation — Send 并排：团型下拉、两块的说明、How to use 一致；选团和日期，消息预览三个标签和旧页面一样。
3. 上传 Annie 的文件（文件名带团名片段和日期）：预览各列、人数、MTLV、黄框和旧页面一致；文件名不对时先弹确认。
4. SMS Only 发送 → 确认框 → 结果 Sent 1；点 View this send：新标签页打开 `/send-log?batch=…`，那一批展开，写着 Sent 1。
5. 同一个文件再上传：那一单标「Sent by 你 on …」；不勾直接发 → 0 单可发（按钮灰）；勾 Send anyway 发 → Sent 1；同一次预览里再发一次 → Skipped。
6. Last Minute：同样的文件在下面那块上传、发送（SMS Only）；Send Log 的 Send batches 里多一行，团名后面写 (Last Minute)。
7. 改一个接客时间再上传同一团期：蓝框 Changed（旧 → 新）；点 Apply：写「Saved: … Nothing was sent.」，Send Log 没有新记录。
8. `/send-log`：Send batches 和旧后台 Send Log 同一天一致；门票发送页发一次，也出现在这里。

### `/tour-confirmation/tracking`（Tour Confirmation Tracking）

- 分支：`task/tour-tracking-page`（从 `task/tour-send-page` 拉出）。
- 状态：lint / typecheck / build 通过；模拟接口 + headless Chrome **48 / 48**；回归：门票 tracking 63 / 63、Morning tracking 76 / 76、
  Tour 发送 50 / 50、侧栏 12 / 12。**没有连真实后端改过数据、没有真的群发过**。等 Annie 验收。
- 接口：列表 `GET /api/notifications/tour-confirmation/tracking?date=`；团型 `GET …/tour-types`（按钮、缩写、午餐分组、有没有牛肉都读它，不写死）；
  当天群发 `GET /api/broadcasting-log?date=&module=tour`；状态 `PUT /api/bookings/{id}/confirmation`；午餐 `PUT …/lunch`；MTLV 票 `PUT …/mtlv-ticket-status`；
  Take action `PUT …/take-action`；对话 `/booking-notes/by-order/{单号}`（**读不带 line、写带 line=tour**，同旧页面）；群发 `POST /booking-notes/broadcast/send`
  （module tour、group_filter general / mtlv）；补录 `POST /send/tour-tracking-import-preview` / `-commit`（`next.config.ts` 新加这两条转发）；
  导出 `GET …/export-csv?date=`；列顺序 `GET/PUT /api/user-prefs/tour_col_order`。
- ⚠️ 会写库 / 真实发送的：状态 ✓（Cancel 会连带把午餐、MTLV 张数清零）、午餐、MTLV 票、对话 **Send →**、**📣 Broadcast**、⬆ 补录（只写库不发）。
- 与旧页面一致：日期（‹ › / 日期框 / Today / Tomorrow）、团型按钮（回复了的单 / 全部单，All + 9 个团，没单的 0/0）、六个数字卡片（点了按状态筛）
  和回复率公式（分母：邮件原值 sent* 或短信 sent / delivered / undelivered）、午餐分组卡片、状态下拉 + ✓ / ✕、★（提交过不止一次）、
  17 列和顺序、邮件 / 短信状态（undelivered 不会显示成 Delivered）、午餐格（YES + 有午餐的团才可点，没牛肉的团不显示牛肉）、MTLV / Tickets 两列和三个表头数字、
  WhatsApp 未处理置顶 + 绿条、Notes 列没有消息时显示客人确认页留言、☰ Columns（隐藏页面列、显示上传名单列，只存本浏览器）、拖列头排序、
  Download CSV、⬆ Upload（选团 → 选文件 → 已在列表的默认跳过、可 Insert anyway、人数算不出整批拦）、📣 Broadcast（General / MTLV、所选团的全部客人，同旧页面不按状态筛）、
  当天群发记录、How to use。
- 列顺序存账号 `tour_col_order`，格式同旧页面（列号字符串数组 "0".."16"），**两边互通**；列数对不上就不用（同旧页面）。
- 与旧页面的差异：
  - 浅色页面；默认日期按洛杉矶（旧页面按 UTC，晚上会跳到明天）；地址栏带 `?date=`。
  - 改完状态 / 午餐 / 票 / Take action 后静默重拉整表（显示名、Cancel 的连带清零以服务端为准）；状态存失败时改动留着、写原因（旧页面 alert 后改回）。
  - 自动刷新整表（旧页面只刷对话那几列）；新消息提示条同门票页。
  - 没有拖列宽、自动列宽（表格按内容排版）。
  - 午餐弹窗、补录结果、群发结果都显示在弹窗里（旧页面 alert）。
- 审查（子代理，没找到发错人 / 写错单的问题）后修的：拖列头往右拖时落在目标后面（原来少一格，存进 `tour_col_order` 的顺序会和旧页面同样拖法不一样；
  门票 tracking 同一处一起修）；新出现在这天的单不算「新消息」；拖过列以后账号里的旧顺序晚到不再覆盖；一单在存时其他行的状态 / 票先关着（原来点了没反应）。
- 共用组件改动：对话框加 `readAllLines`（读不分线、写记 tour）；群发弹窗加 `audience="mtlv"`（General / MTLV）；列选择器挪到 `components/ui/column-picker.tsx`。
  顺手改：门票 tracking 的列设置早已存进账号，弹窗和 How to use 还写着「只存本浏览器」，改了。
- dashboard 的 Bus Tour 快捷卡 Track、Tour 消息卡片、发送页的 View Tracking 都改到站内；侧栏 Tour Confirmation 下包括 tracking。

**验收步骤**（⚠️ 第 5–8 步写生产库 / 真发：只动 `ZZ Test` 的单，群发只勾 Annie 自己）：

1. 切到 `task/tour-tracking-page`，本地启动，打开 `http://localhost:3100/tour-confirmation/tracking`。
2. 和旧后台 Tour Confirmation Tracking 并排看同一天：团型按钮的数字、六个卡片、午餐卡片、每行各列、三个表头数字一致。
3. 点团型按钮、数字卡片、搜索、Today / Tomorrow / ‹ ›，结果合理。
4. 拖一列，打开旧页面：顺序一样（共用 `tour_col_order`）。☰ Columns 隐藏一列、显示一个上传列，刷新还在。
5. 找一张 `ZZ Test` 的单：状态改 YES → ✓；点午餐数字改一份 → Save；旧页面刷新后一致。再改回去。
6. 有 MTLV 的 `ZZ Test` 单：Tickets 改 Sent，下面写你的名字和时间；改回 Pending。
7. Annie 自己的单点 Notes：内容和旧页面一致；勾 SMS 点 Send →，手机收到；Take action / 撤销。
8. 📣 Broadcast：只选 Annie 那单的团、只留 Annie 一人 → 收到；页面上方「Broadcasts sent for this date」多一条。
9. ⬆ Upload：只含 `ZZ Test` 的文件，预览、Insert（不发消息）。Download CSV 和旧页面一致。

### 后端 morning-relay-pull 跟进（排车页 Morning Relay、Pickup Locations、Manifest）+ 5 页补 How to use

- 分支：`task/morning-relay`（从 `task/tour-tracking-page` 拉出）。后端 `30f766b`（2026-10-04 22:01 合进 main，migrate_v71）。
- 状态：lint / typecheck / build 通过；模拟接口 + headless Chrome：排车页 **57 / 57**（原 42 + Morning Relay 15）、Pickup Locations **41 / 41**（原 37 + 4）、
  Manifest **28 / 28**（原 26 + 2）；补 How to use 的几页重跑：Broadcasting Log 23 / 23、Bug Reports 33 / 33、Send Log 27 / 27、Morning Tracking 76 / 76。
  **没有连真实后端发过**。等 Annie 验收。
- **排车页「Morning Relay guests」**（照旧页面 `_relay_pull_panel.html`，放在 Tour manifests 面板下面）：
  - Pull from manifests：`GET /api/dispatch/relay-pull?date=`（只读）。两轮各一块（轮名、时间段来自接口），按车列客人，状态 Not sent / Sent / Changed after sent（写改了什么）/ No show；
    Need a look 写原因；在团车出发点上车的单数。打开页面不自动拉（同旧页面）。
  - 每轮发送键（⚠️ 真发早班短信）：先 `GET /api/dispatch/relay-send/preview` 问服务端这次几位、跳过几位，确认框写清楚，确认后 `POST /api/dispatch/relay-send {date, round}`
    （名单服务端重算、发过的跳过、同一轮同时只能一人发）。结果一行写在那一轮上，并自动重拉。
  - Send to driver（⚠️ 真发）：先 `GET /api/dispatch/driver-notice` 看名单（谁能发、发不了的原因、电话、短信内容、上次几点谁发的），再 Send texts now → 确认 → `POST …/driver-notice/send`；
    发不到的写出来。**后端这里不查重**，再发就是再发一遍（确认框会写「They will get it again」）。
  - 只能发今天 / 明天（或全是测试单的测试日），后端定。
- **Pickup Locations**：每行「Tour bus departure」勾选（`PATCH /api/pickup-locations/{id}/tour-departure`，点了就存；失败写原因、勾还原），改动记录显示 Yes / No；How to use 加一条。
- **Manifest**：每台车「Guide view」（新标签页，后端渲染的导游页预览；`next.config.ts` 转发 `/admin/dispatch/manifest/guide`）。
- 与旧页面的差异：
  - 确认用页面弹窗；400 / 409（有人在发、日期不对）写在弹窗里、说明没发；断开 / 5xx 关掉弹窗、重拉、面板写「可能已经发出去」——不能在原弹窗里直接再点（审查后改的，避免司机收两遍）。
  - 排车页有没存的改动时，面板提示「Pull 用的是已保存的排车，先存」；换天读取中面板按钮关着。
  - 排车页顶部和右栏原来写「Nothing is sent from this page」，已经不对，改成「保存不发东西，只有 Morning Relay 的发送键会发」（旧页面还是旧说法，记进「需要后端」）。
  - 已知：Guide view 页里后端的 Sign out 链接是相对地址，在 ops 域名下点了 404（预览用不到它）。
- **5 页补「📖 How to use」**（后端 04817d6 给旧页面加的，ops 当时没有）：Broadcasting Log、Bug Reports（中英，跟着页面语言）、Promotion Stats、Send Log（含 Send batches）、
  Morning Tracking（含 Bus # 链接）。文字照旧页面，按 ops 的实际按钮改写。共用组件 `components/ui/how-to-use.tsx`。

**验收步骤**（⚠️ 第 3、4 步会真发：只在测试日、只含 Annie 自己的单上试）：

1. 切到 `task/morning-relay`，本地启动。`/settings/pickup-locations`：Treasure Island 那行勾着 Tour bus departure（和旧页面一致）；勾一个 `ZZ Test Qzx` 酒店再取消，Action Log 有两条。
2. `/dispatch` 选一个有 manifest 的日子，点 Pull from manifests：两轮、每台车的客人、Need a look 和旧后台排车页一样。
3. 测试日：Send 1st Round → 确认框写人数 → 发送；Annie 收到早班短信；那一行变 Sent，再点按钮是灰的。
4. Send to driver：名单和旧页面一样；Send texts now → 确认；收到短信（只排 Annie 自己当司机的测试日）。
5. Manifest 页点一台车的 Guide view：新标签页打开导游看到的页面。
6. 打开 Broadcasting Log / Bug Reports / Promotion Stats / Send Log / Morning Tracking：底部有 How to use，展开内容和页面对得上。

### 日期框点哪里都弹日历（全站）

- 分支：`task/date-picker-click`（从 `task/morning-relay` 拉出）。Annie 2026-10-05 定：「所有有日历和时钟的地方，点日历框和时间框的任何地方都有下拉菜单」，
  旧后台由后端窗口在它的 `task/date-picker-click` 做（`app/static/picker-click.js`），ops 一起改，规则两边一样。
- 状态：lint / typecheck 通过；headless Chrome（`showPicker` 换成计数器）检查 **14 / 14 通过**；等 Annie 验收。
- 做法：根布局挂一个全局组件 `components/ui/picker-on-click.tsx`，document 上委托 click → `showPicker()`，不逐个框加 onClick。规则：
  - 只管 `type=date / time / datetime-local / month / week`（ops 现在只有 date，约 15 处）；
  - disabled / readOnly 的框不弹；
  - 只在点击时弹，不在 focus 时弹：Tab 进框直接打字照旧；
  - 浏览器没有 `showPicker` 或调用出错，一律不管，回到浏览器默认行为。
- 检查项：5 种框点数字中间都弹；disabled、readOnly、文字框、数字框不弹；Tab 进日期框不弹；`showPicker` 抛错 / 不存在时没有页面错误；
  Orders 选 Custom 后点日期框中间弹日历。

**验收步骤**（只读）：

1. 切到 `task/date-picker-click`，本地启动。
2. `/orders` 日期范围选 Custom：点日期框的数字中间（不是右边的小图标）就弹出日历；选一天，列表照常刷新。
3. `/dispatch`：点日期框中间弹日历，换天照常。
4. `/task-board` 的新建任务、`/bug-reports` 的新建 Bug 弹窗里的日期框：同样点中间就弹。
5. 点进日期框后用键盘直接打数字，照样能改。

### Order Log 订单搜索 + 全站紧凑筛选条 + Send batches 字号

- 分支：`task/log-search-compact`（从 `task/date-picker-click` 拉出）。Annie 2026-10-05 提、看过预览后定。
- 状态：lint / typecheck / build 通过；headless Chrome（模拟接口）：Order Log / Send Log / Ops Summary **21 / 21**；
  18 个有筛选条的页面逐页打开截图，**18 / 18 没有页面错误**、筛选控件都是 26px / 12px。没有连真实后端；等 Annie 验收。
- **Order Log 订单搜索**：搜索框放在日期按钮右边，原来的「Order # + Filter」去掉。
  - 边打边查（停 400ms 才发请求），按「包含」匹配：输入一部分就列出相近的几单，输完整就只剩那一单。
  - 框里有字时**不限日期**（`fetchOrderLog` 不传 `date_from` / `date_to`），日期按钮变灰，旁边写 Searching all dates；Event / By 照样生效，Export 导出的就是搜索结果。
  - 清空的方法：点 ✕、按 Esc、点任一个日期按钮（会清掉搜索，按那个日期查）、Reset。
  - 搜索时也显示「2026-09-12 之前员工操作时间早 7–8 小时」的黄条（全部日期包含那段）。
- Send Log、Broadcasting Log 的订单搜索在下一个分支 `task/log-order-search`（后端 2026-10-05 已上线）。
- **全站紧凑筛选条**（Annie：「按钮做得太大，好丑」）：共用控件 `components/ui/filter-bar.tsx`。
  - 所有筛选控件 26px 高、12px 字；日期预设连成一组（`Segmented`，选项多时 `wrap` 换行，例如 Bug 状态）；
    下拉框的名字写在框里（`FilterSelect`：「Event All ▾」）；Reset / Export / Refresh 是不带边框的灰字按钮；Apply 等是小深色按钮。
  - 改到的页面：Order Log、Send Log、Ops Summary、Broadcasting Log、Orders、Sales Report、Promotion Stats、Dispatch（换日期那行）、
    Dispatch Imports、Bug Reports、Task Board、Products、Pickup Locations、Vehicles、HR、三个 tracking 页（日期、产品 / 司机 / 团型按钮、搜索、工具按钮）。
  - 只改筛选条 / 工具条的样子：处理逻辑、文案、`aria-*`、禁用条件都没变。统计卡片、表格、弹窗、新增表单不在这次范围。
  - 顺带的小差异：Broadcasting Log 的 Sent、Orders 的 Tour date 去掉了 📅；Bug Reports、Task Board、Products、Pickup Locations、Vehicles 的搜索框
    多了 ✕ 和 Esc 清空；Bug Reports 状态按钮的名字和数字从两行变成一行。
- **Send Log 的 Send batches**：每行、标题 12px（同旧后台 How to use 的大小），Sent / Skipped 标签 10.5px，行距收紧；展开后的明细也改成 12px。

**验收步骤**（只读）：

1. 切到 `task/log-search-compact`，本地启动，打开 `http://localhost:3100/order-log`。
2. 搜索框输入一个今天之前的订单号的一部分：出现 Searching all dates、日期按钮变灰，列出相近的几单；输完整只剩那一单（含以前日期的记录）。
3. 搜索时选 Event：结果再缩小；点 ⬇ Export，CSV 是这些行。点 Yesterday：搜索框清空，显示昨天的记录。再搜一次、按 ✕：回到原来的日期。
4. `/send-log`：筛选条一行放下；Send batches 每行的字和旧后台 How to use 一样大。
5. 点一遍侧栏各页（上面列的页面）：筛选条都是小一号的样子，筛选、搜索、Export、Refresh 照常能用。
6. `/bug-reports`：状态按钮放不下时换行，点一个状态只看那个状态，点「全部」恢复。

### Send Log / Broadcasting Log 订单搜索

- 分支：`task/log-order-search`（从 `task/log-search-compact` 拉出）。
- 后端已上线（main `034a833`，2026-10-05；线上未登录调 `by-order` 回 401，说明路由在），可以验收。
- 状态：lint / typecheck 通过；headless Chrome（模拟接口，形状按后端说明）**19 / 19 通过**；Order Log / Send Log 原检查 21 / 21 重跑通过。没有连真实后端。
- 接口：Send Log `GET /api/notifications/send-log` 加 `order_number`（不传日期 = 全部日期，stats 同条件）；
  Broadcasting Log `GET /api/broadcasting-log/by-order?order_number=&limit=200` → `{rows, truncated}`，每个匹配的收件人一行，带群发信息。
- **Send Log**：搜索框在日期按钮右边，做法同 Order Log（停 400ms 才查、按包含匹配、不限日期、日期按钮变灰、Module / Type / Status 照样生效）。
  搜索时 **Send batches 收起**（它只按日期列）、**Export 关掉**（导出接口只认日期和模块，不认订单号），提示写在按钮上。
- **Broadcasting Log**（Annie 选的显示方式 B）：搜索框在 Sent 下拉右边；搜索时 Sent 变灰，下面换成「Broadcasts to orders matching “…”」表：
  每行是这一单在某次群发里的那一行——发送时间、订单号、客人（姓名 / 电话 / 邮箱）、短信结果、邮件结果、产品、团期、模块、人群、模板 + 消息、谁发的。
  Module / Group 在结果上照样筛；Export 导出这些行；超过 200 条时提示「只显示最新 200 条，多输几位缩小范围」。
  清空：✕、Esc、选任一个 Sent 选项。

**验收步骤**（只读）：

1. 切到 `task/log-order-search`，本地启动。
2. `/send-log`：输入一个上周发过消息的订单号：出现那一单所有日期的发送记录，Send batches 收起，Export 灰掉；选 Tickets 模块，结果再缩小；点 Today 回到今天。
3. `/broadcasting-log`：输入一个收到过群发的订单号：每次群发一行，写着发送时间、消息、短信 / 邮件结果；和 ▶ Details 里那次群发的这位客人一致。
4. 只输 `CHD`：出现「只显示最新 200 条」的提示。⬇ Export 下载的就是表里这些行。

### 全链审查修正（2026-10-05 晚，家里在 `task/morning-relay` 上做；10-06 合进链尾 `task/log-order-search`）

- 做法：先把之前所有页面的 headless 检查在链尾重跑一遍（27 套、863 项全过，build 通过），
  再分五组（tracking / 发送 / Dispatch / Settings / 报表·订单·ClickUp）对照旧页面和后端逐页审查。
  没找到会写错生产数据的问题；下面这些修在链尾上，**前面的分支里没有，要合就合链尾**。
- 检查脚本原来散在各个会话的临时目录里，现在收进仓库 `checks/headless/`（自己的 package.json，不进网站 build、
  lint / typecheck / prettier 都跳过），`node run-all.js` 一条命令全跑，说明见那里的 README。
- 修完以后全跑：**27 套、923 项全过**（新加了 60 项覆盖下面的修正）；lint / typecheck / build 通过。
- 会影响发送的：
  - **浏览器后退 / 前进也会先问**（`lib/use-leave-guard.ts`）：原来只拦关标签和站内链接。早班发送页发送中按后退，剩下的批次在后台接着发，
    回来重新上传再发 ⇒ 客人收两条（早班接口后端没有防重发，见「需要后端」）。三个发送页和排车页（有没存的改动）都用它；
    发送页离开以后不再发后面的批次。
  - Tracking 三页：改完状态 / Take action 等以后的重拉用**当前**日期（原来用点按钮时的日期，这时换了天，表里是前一天的人，
    再点群发就会发给前一天的客人）。
  - 群发弹窗：打开时把名单定下来（原来后台每分钟刷新会把 staff 没看过的人加进去）。
  - Send to driver：点 Send texts now 先重读名单，确认框按最新名单写人数和名字，变了会说（原来是第一次读的名单，存过排车以后服务端发的是新名单）。
  - 发送页 Apply 存的时候 Start Over 关着；晚到的 Apply 结果不会把旧文件的预览盖回来。
  - 早班发送 400 写「没发」（后端 400 都在发之前）；断网写「Could not reach the server.」，不再写「Please try again」。
  - 结果页：没有电话 / 邮箱的单单独算 No address，不再算成 Failed。
- 会写错数据的（时序）：
  - 排车页：保存中、换天读取中，每一行的下拉 / 备注 / 酒店 / Edit 都关着（原来这时改的会被存完后的重读冲掉，还显示已保存）。
  - Products：同一个商品的保存排队发（PUT 是整体覆盖，两次重叠时旧的可能后到，把分类改回去）；失败只改回那一格。
    Manifest setup：Use default grey / 选颜色带上刚输入的午餐行。
  - Tour tracking 对话框的处理人按本行显示（原来读的是同单号 id 最大那行，常是早班行，点了会清掉别人的标记）。
- 显示 / 其他：
  - 早班签到率：分子只算短信发出去的单里签到的（同旧页面；原来可能超过 100%）。
  - 导出 CSV 防公式注入：`= + - @` 开头的文字前加 `'`（Order Log 里有客人自己写的文字），数字不受影响。
  - Order Log 导出按 id 去重。Orders 详情页晚到的旧数据不覆盖新的。
  - Bug Reports / Task Board：附件传上去但评论没发出时，再点发送会补发「上传了 N 张附件」；刷新列表不丢正在写的评论；
    Reported By 等登录信息到了再填；Task Board 上传时登录过期跳登录页。
  - 门票 / 早班 tracking：刚拖过的列顺序不被晚到的账号设置盖掉；门票改状态后重拉，不会闪回旧状态。
- 已知、没改：确认离开后点侧栏跳走，历史记录里会多一条同地址的记录（再按后退还是这一页）。

### Dispatch 分步（后端 G29 第一批）

- 分支：`task/dispatch-steps`（从 `task/log-order-search` 拉出）。跟后端 `fc8e0f9`（2026-10-05 晚合进 main，只改旧页面模板，不加接口）。
- 状态：lint / typecheck / build 通过；headless：排车页 **75 / 75**（原 68 + 7）、Manifest **32 / 32**（原 28 + 4）；`checks/headless` 全跑 **27 套、934 项全过**；没有连真实后端；等 Annie 验收。
- 排车页按 staff 做事的顺序分成四块（共用 `components/dispatch/step-box.tsx`），每块有自己的 📖 How to use（文字照旧页面）：
  - **Step 1 Guest lists**：原来的 Tour manifests 面板。每张团卡片加 **Assign Bus**（传没传 CSV 都有）：滚到 Step 2 里这个团的那一块、黄框闪 2 秒；这个团今天没有块就滚到 Step 2 开头。
  - **Step 2 Buses & drivers**：Pull from Discord / Copy / Save schedule 从页头搬进来，下面是 CCL 提示条、统计、排车的各块和右栏 Schedule check。页头只剩换日期。
  - **Step 3 Morning Relay**：Pull from manifests 和两轮发送。
  - **Step 4 Send to drivers**：Send to driver 单独一块，**出错写在自己这块**（原来写在 Relay 那块，人在下面看不到）。
- 页头说明改成「Plan the day in order: …」，右栏改成「Save schedule does not text guests or drivers. Tour manifests, Morning Relay and Send to driver use the saved schedule…」（同后端第 7 条）。
- **Manifest 页**：「‹ Back」从站内点进来的走浏览器后退（回到排车页那一天、原来的位置）；直接打开 / 刷新过的去排车页的这一天。旁边多一个「Dispatch · Mon, Oct 5」，不管从哪来都去排车页的这一天。
  判断「站内点进来」用根布局的 `components/nav/in-app-history.tsx`（数这次加载以来走过几页；旧页面看 `document.referrer`，前端跳转时它不变，所以自己数）。
- 已有、不用跟：排车页地址带 `?date=`（ops 一开始就有）；默认打开明天（Annie 10-05 定不改）。Dispatch Imports 最新的排前面（后端 `c5e3542` 改了接口的排序，ops 不排序，自动跟上）。
- 等后端：G29 第二批 Seat guests（后端 `task/seat-guests`，migrate v73 草稿）合进 main 后会成为新的 Step 3，Morning Relay / Send to drivers 顺延。

**验收步骤**（只读；不要点 Step 3 / 4 的发送键）：

1. 切到 `task/dispatch-steps`，本地启动，打开 `http://localhost:3100/dispatch`。
2. 从上到下是 Step 1 Guest lists、Step 2 Buses & drivers、Step 3 Morning Relay、Step 4 Send to drivers，和旧后台排车页的顺序、文字一致；四个 How to use 默认收起。
3. Step 1 点一个团的 Assign Bus：页面滚到 Step 2 里这个团、黄框闪一下。
4. 点一个已传 CSV 的团的 Open manifest，再点「‹ Back」：回到排车页、同一天、原来的位置。在 manifest 页按 F5 刷新后再点「‹ Back」：去排车页的这一天。
5. 「Dispatch · 日子」：打开排车页的那一天。

### 后端 10-06 跟进：HR Samsara Driver ID、门票发送收 Rezdy 原始 CSV、Bus # / Open map 走当天临时链接

- 分支：`task/ops-api-catchup-3`（从 `task/dispatch-steps` 拉出）。
- 状态：lint / typecheck / build 通过；headless：HR **44 / 44**（原 40 + 4，改了 2 项旧的）、门票发送 **37 / 37**（原 33 + 4）、Content Studio **32 / 32**（原 30 + 2）；`checks/headless` 全跑 **27 套、944 项全过**。没有连真实后端。等 Annie 验收。
- **HR**（后端 `0c258bc` / `af8ac83`，migrate v74）：新字段 **Samsara Driver ID**（Dispatch 组，最长 40，只查长度）。
  列表最后多一列（排在 Medical Card Expires 后面；存过的列顺序会自动补上这一列），Edit list 里能直接改；
  和别人重复时后端回 400「That Samsara Driver ID is already on another person's record…」，页面照常写出原因、改动保留。导出由后端生成，自动带上。How to use 加一条。
- **门票发送页**（后端 `37f4020`，v75）：Rezdy 原样导出的门票名单没有 Check-in Time，后端按 Content Studio 里这个门票类型设的分钟数从 Tour Time 倒推。
  - 上传框下面的提示改成「Upload the CSV exactly as you downloaded it from Rezdy…」，不再列必填列（Annie：列了会让人以为 Rezdy CSV 也要这些列）。
  - 预览上方：Check-in Time 是算出来的时候显示蓝条（后端的 `checkin_note`，写按几分钟算的）。没设分钟数时后端直接拒收并写原因，页面照常显示。
  - How to use 加一条（照旧页面）。
- **Content Studio**：Tickets → Guest Page 每个门票类型多一张卡「Check-in minutes before tour time」（`tmpl__tix__<团>__checkin_minutes`，带说明：不给客人看、50 = 9:40 的团 8:50 check-in、只能整数分钟、空着就拒收这类文件）；How to use 末尾加一条提醒。

- **Morning Tracking 的 Bus #、Vehicles 的 Open map 改走当天临时链接**（后端 `c401bb9` samsara-live-share，2026-10-05 合进 main；规则文档第五节 5c；10-06 晚家里补的）：
  - Morning Tracking：接口每行多了 `live_url`（旧后台 `/tracking/vehicle-live?van=车号` 的绝对地址）。有 `live_url` 就链它，没有才退回 `samsara_url`；都只认 `https://`。
  - Vehicles：Open map 不再直接链 `samsara_url`，改成 `<旧后台>/tracking/vehicle-live?van=车号`（同旧页面；车辆接口没有 `live_url`，地址用 `NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL` 拼）。
    「有没有 Open map」的判据不变（`samsara_url` 是 Samsara 链接才显示）。
  - 原因：`samsara_url` 是每台车的永久链接，G27 第 4 步要在 Samsara 里停掉，停了以后直接链过去就打不开；`/tracking/vehicle-live` 开了 Samsara API 时现建当天有效的链接，没开时跳回 `samsara_url`。
  - ⚠️ 这个入口**要登录旧后台**（按 confirm 域名的 cookie）。线上 staff 本来就在 confirm 登录（ops 没登录会跳那里），ops 和 confirm 是同一个父域，新标签页打开会带上登录；
    没登录时后端跳 confirm 的登录页，登录后回到这个地址（后端 G29 第 6 条，本站路径能回）。**没有在线上实测过**，验收时点一次确认。
  - 「只开本地前端、转发到线上 confirm」那种搭法里旧后台地址是 localhost:3100，Open map 会 404，要临时再加一条 `/tracking/:path*` 转发（同下面那三条，不提交）。
  - 检查：Morning Tracking **90 / 90**（+3：先用 `live_url`、空时退回 `samsara_url`、`http://` 不做链接）、Vehicles **33 / 33**（Open map 地址改了）。`checks/headless` 全跑 **27 套、947 项全过**；lint / typecheck / build 通过。

**验收步骤**（⚠️ 第 3 步不要点发送）：

1. 切到 `task/ops-api-catchup-3`，本地启动。`/settings/hr`：列表最后有 Samsara Driver ID；Edit list 给 `ZZ Test` 开头的人填一个编号 → Save changes；再给另一个 `ZZ Test` 填同一个编号 → 红字「already on another person's record」、没存。清掉测试数据。
2. `/settings/content-studio` → Tickets Reminder → Guest Page：每个门票类型有 Check-in minutes 卡片；Hogan with Transport 是 50（后端 v75 预填），其他空着。
3. `/tickets-reminder/send`：选 Hogan with Transport，上传 Annie 提供的、只含她本人的 Rezdy 原始门票 CSV → 预览上方蓝条写「Tour Time minus 50 minutes」，Check-in Time 那列是算出来的时间。选一个没设分钟数的团上传同一个文件 → 拒收并写原因。
4. `/morning-pickup/tracking` 选一个有车号的日子，点一个蓝色 Bus #：新标签页地址先是 `confirm…/tracking/vehicle-live?van=…`，然后跳到 Samsara 地图。
   `/settings/vehicles` 点一台车的 Open map：同样。（没登录旧后台时会先到旧后台登录页，登录后回到地图。）

### `/morning-pickup/send` 服务端防重发（后端 E141/E142）

- 分支：`task/morning-send-guard`（从 `task/ops-api-catchup-3` 拉出）。跟后端 `3684df7`（2026-10-06 晚合进 main）。
- 状态：lint / typecheck / build 通过；headless：Morning Tracking / 发送套 **98 / 98**（原 90 + 8）；`checks/headless` 全跑 **27 套、955 项全过**。没有连真实后端发过。等 Annie 验收。
- 和门票 / Tour 发送页同一套规则（Annie 2026-10-06 晚定）：预览接口现在多返回 `preview_at`（服务器时间），发送时原样带回；
  每一批带 `send_anyway`（这一批里、下面「已经发过」那块勾中的订单号）。服务端按锁逐个再查一次 send_log，今天已经发过的单一律跳过
  （结果里 `reason: "already_sent"`、`message: "Already sent today"`），除非它在 `send_anyway` 里、而且最近一次发出去早于 `preview_at`
  ——所以 Send anyway 对同一单最多只再发一次。
  - **两个渠道都失败不算发过**：那一单仍算「没发过」，留在上面主列表里（可能还勾着），Send 会再试一次。
  - **一个渠道失败、另一个发出去了**：算发过，在「已经发过」那块该行后面加一个红胶囊（如 `SMS failed` + `Email delivered`），抬头多写
    「N with one channel failed」。
  - **文件里同一单出现两行**：只发第一行，第二行 `reason: "listed_twice"`、`message: "Listed twice in this file"`（不拦整批）。
  - 上传框改收 `.csv,.xlsx`（后端 2026-10-02 起门票 / Tour 两个发送页已经这样，早班这次补齐）：Rezdy CSV 的行带 `pax` / `pax_ok`，
    勾中的单里有算不出人数的就整批不能发（红框列单号，同门票 / Tour 页），同服务端的拦截范围一致（只查要发的单，不查没勾的行）。
- 结果页新增 **Skipped** 统计（服务端跳过的，不算 Sent/Failed/No address）；跳过的行两列直接显示 `message`（`Already sent today` /
  `Listed twice in this file`），进度条按去重后的订单数算（同一单两行不会把 `N of N` 撑成 `N+1 of N`）。
- How to use 照后端这版改写：Send anyway 那条加「Each tick sends one more message only」；新增两条讲红胶囊和两个渠道都失败；
  Send 那条加 `Already sent today` / `Listed twice in this file` 的结果说明。
- 与旧页面的差异（同门票 / Tour 发送页既有的做法，这次早班页才跟上）：仍是分 10 一批依次发送、出错就停、发送中离开先问（含浏览器后退）；
  旧页面是单次整批发，这些都不是本次改的范围。

**验收步骤**（⚠️ 第 3、4 步会真实发送；只用 Annie 提供的、只含她本人信息的文件）：

1. 切到 `task/morning-send-guard`，本地启动，打开 `http://localhost:3100/morning-pickup/send`。上传框能选 .csv 或 .xlsx。
2. 用 Annie 的测试文件上传预览：今天已经发过的单在下面深色块；如果有一单上次是一个渠道失败、另一个成功，那行有红胶囊（如 `SMS failed`）。
3. 只勾 Annie 自己那单发一次（SMS Only）：Sent 1。再上传同一个文件：那单显示在深色块里；不勾直接发 → 0 单可发；
   勾 Send anyway 发 → 再发一次，Sent 1。
4. 同一次预览里对同一单再点一次 Send anyway 发送（不重新上传）：结果里这一单显示 `Already sent today`（Skipped，不会发第三次）。
5. 把文件里勾中的某一行 Quantities 清空再上传：红框写明算不出人数的单号，发送按钮灰掉；取消勾那一行后能发。

### `/manifests`（新方案）+ Products 的 Tour type 列（只接模拟接口）

- 分支：`task/manifests-v2`（旁支，从链尾 `task/ops-login-cancel` 拉出，**不在链上、不能合**，见「进行中」开头）。
- 依据：后端 `task/manifests-fields` 的 `tasks/ACTIVE.md`「接口契约（给 ops 前端）」A–F（提交 `04f3fa0`），加上后端窗口 2026-10-07
  消息里的确认和补充：
  - Tour type 下拉只给产品**自己的** `booking_type === "ticket"`。
  - Action Log 的键是 `ticket_tour_type`，值是键或 null。
  - 单个 PATCH 返回 `{success, ticket_tour_type}`。
  - 当天没单时 `pills: []`、`pill: null`、`rows: []`；`tabs` 永远两项。
  - datetime 换成洛杉矶时间；`start_time` / `end_time` 是 Rezdy 当地时间原文，原样显示。
  - `reseller_comments` 挪进 money 组。
  - 批量 tour type 必须单独一次；设值只限门票产品，清空不限分类。
  - Cfm # 清空后 by / at 也是空的。
- 状态：lint / typecheck 通过；headless（模拟接口，2026-10-07）：**man 60/60、ptt 21/21、products 48/48、nav 13/13**。
  - `man` 套覆盖：
    - 权限：司机 403；staff 能进、弹窗没有 Money 组；admin 有 Money 组。⚠️ Annie 2026-10-07 晚 改：Money 组所有 staff 都能看，等后端放开（见「需要后端」）。
    - 加载：第一次请求的参数，后端换了胶囊不重拉，地址栏。
    - 显示：两个标签的计数；胶囊 A→Z、none 最后、没有 All；表头按 fields；空值 —；Legacy 标签和提示条；两个 Cfm # 列分开；How to use 收起。
    - 换胶囊。
    - 列弹窗：搜索、勾选、新勾的排最后、存偏好、重拉带 fields；denied / unknown 提示且不删；Reset 存 `[]`；存失败弹窗不关。
    - 格式：datetime 换洛杉矶时间、bool、问卷答案、start_time 原样；金额没选币种列时显示两位小数、选了币种按币种。
    - Cfm #：存、去空格、没改不发、Esc、刷新还在、404、清空。
    - CSV：表头、原值、公式字符加 `'`、文件名。
    - Tickets 标签：另拉自己的列偏好，按地址栏打开指定胶囊。
    - 其他：没单的日期、Today、加载失败和 Retry、存的列拉不到、未登录跳登录页。
  - `ptt` 套覆盖：
    - 只有门票产品有下拉；旧键照实显示；非门票只能清空。
    - 单个走 PATCH、不发 PUT；保存中禁用；失败改回。
    - 批量的三种拦法和请求体；确认框文案；Action Log；How to use。
  - 这次的 headless 是在临时 git worktree 里跑的：主目录上 Annie 开着 `npm run dev`，两个 next dev 共用 `.next` 会互相干扰。**没有连过真实后端**（真接口还不存在）。后端代码、安全、数据库三个审查已通过（后端分支 `e911466`），
  等 Annie 执行 v76。
- `/manifests` 页：
  - 日期 ‹ › Today、日期框；地址栏带 `?date=&tab=&pill=`。
  - **Bus Tour / Tickets - SelfDrive** 两个标签，带单数 / 人数。
  - 胶囊一次一颗：显示哪颗以返回的 `pill` 为准；没指定时不传 `pill`，由后端挑 A→Z 第一颗，挑完不重拉。
  - 表格列 = 返回的 `fields`，表头用 catalog 的 label。
  - **☰ Columns** 弹窗：
    - 按 `groups` 分组勾选，可以搜索字段；每组有 All / None。
    - 勾的顺序就是列的顺序，新勾的排最后。
    - 存账号偏好 `manifest_cols_bus` / `manifest_cols_tickets`（JSON 键数组），两个标签各存各的；Reset to default 存 `[]`，请求就不带 `fields`。
    - `unknown` / `denied` 的键留在选择里不删，页面上写明「N 列要 admin / 今天没有、已隐藏」。
  - **Cfm #**（`staff_cfm` 列）是输入框：离开输入框或按 Enter 就存，Esc 放弃；存好变绿；404 写明「这单在 Rezdy 已不存在」，输入保留。
    Rezdy 自带的 `rezdy_cfm` 是另一列，只读。
  - Legacy 行标签 + 提示条。
  - Export CSV：导出当前标签、当前胶囊、当前这些列，另加 Legacy data 列；金额导出原值。
  - How to use 默认收起。
  - 金额组由后端按角色挡，前端不判断角色（Annie 2026-10-07 晚 改成所有 staff 都能看，后端放开后前端自动显示，见「需要后端」）。司机 / 导游 403 → Staff access required。
- 侧栏 Manifests 从「链旧后台 old ↗」改成站内 `/manifests`。Operations 组本来就对所有 staff 显示。
- Products 页：
  - 门票产品加 **Tour type** 下拉，走 `PATCH /{id}/tour-type`，**不进整体覆盖的 PUT**。
  - 不是门票、却还留着旧值的产品，下拉只能清空。
  - 批量工具条加 Tour type。和组 / 分类同一次改时 Apply 禁用；设值时选中有非门票产品也禁用；清空不限。
  - Action Log 显示 Tour type 的 label；How to use 补了一条。
  - 后端没返回 `ticket_tour_types`（v76 上线前）时，整列和批量下拉都不显示。原来的 `products` 套正是这种情况，所以照常通过。
- 旧的 `task/manifests-page` 仍然废弃；新页面只借用了它的日期处理和 CSV 写法，其余是重写的。
- **2026-10-07 晚，后端上线后**：
  - 后端 main `3629925`（合并）/ `6162287`（收尾），migration v76 已在生产执行。
  - 链尾 `task/ops-login-cancel` 已合进本分支，本分支成为新链尾；合并后 lint / typecheck 通过，man / ptt / products / nav 四套重跑全过。
  - 对照后端 main 的代码核对了接口形状（`manifests_api.py`、`manifest_list.build_page` / `save_cfm`、`manifest_fields`、`settings_products.py`），
    和契约一致。小差别：没填的 Cfm # 在列表里是空串，不是 null，页面两种都当「空」，不用改。
  - ⚠️ **还没有登录状态下连真接口实际看过**（这个窗口没有账号），第一次真机查看就是 Annie 的验收。
    后端说今天约 14 单 / 41 人的产品还没设 Tour type，会出现在 Tickets 标签的「No tour type yet」里，Annie 在 Products 页补。

**验收步骤**（⚠️ 连的是生产数据。第 5 步会写一个真实订单的 Cfm #，写完要清空；第 7 步会改产品设置，只改本来就要设的 Tour type）：

启动环境：用上面「验收环境：一条命令」，分支是 `task/manifests-v2`。再打开 `http://localhost:3100/auth/login` 登录。

1. 侧栏 Operations → **Manifests**：打开站内 `/manifests`，不再是 old ↗。
2. Bus Tour 标签：
   - 胶囊是 Settings → Products 的 Group，A→Z 排列，「No group yet」在最后，一次只显示一颗。
   - 每颗胶囊的单数 / 人数，和 Rezdy 后台当天同一个团对得上。
3. 点 **☰ Columns**：
   - 分 Guest / Trip / Booking / Our records / Booking questions / Money 几组（Money 组现在后端只给 admin；Annie 2026-10-07 晚 定所有 staff 都能看，后端放开前 staff 账号还看不到）。
   - 勾几个字段点 Apply，表格跟着变；刷新页面，选择还在。
   - 换到 Tickets 标签，列选择是另一套。
4. Tickets - SelfDrive 标签：
   - 胶囊是门票 tour type，还没设的产品在「No tour type yet」。
   - Start time 是 Rezdy 的当地时间原文。
5. Cfm #：在 Columns 里勾上 **Cfm #**，找一单填 `ZZ TEST`，点到框外，框变绿；刷新还在。**然后清空、点到框外**，再刷新确认已清空。
   Rezdy 自带的确认号是另一列「Cfm # (Rezdy)」，只读。
6. **⬇ Export CSV**：下载的文件只有当前标签、当前胶囊的行，列和屏幕上一样。
7. Settings → Products：
   - 门票产品多了 **Tour type** 下拉，非门票产品显示 —。
   - 给一个「No tour type yet」里的门票产品选上正确的 tour type：框变绿，Action Log 出现 Tour type 这一条；
     回到 Manifests 刷新，它挪到对应胶囊里。
   - 批量：只勾门票产品，选 tour type → Apply。同时改组 / 分类会被拦下，并写明原因。
8. 用 staff 账号打开 Manifests：能进。后端放开 Money 组之前 Columns 里没有 Money 组；放开之后应该有（Annie 2026-10-07 晚：价格大家都能看）。

### `/manifests` 暂停：接口已过时，等后端 `task/manifests-fields`（2026-10-07 已按新契约重做，见上一小节）

- ⚠️ 2026-10-06 深夜做了一版（分支 `task/manifests-page`，跟的是当晚早些时候上线的 `GET /api/manifests?date=` 列表接口），
  **当晚做完后 Annie 又定了新方案，旧版对不上，分支已废弃，不要在它上面接着改、也别合并**（Annie 转达后端核对结果）。
- Annie 2026-10-06 深夜定的 8 条新方案（后端分支 `task/manifests-fields` 的 `tasks/ACTIVE.md`，提交 `b148b41`；
  10-06 21:06 后端交接记录核对过一遍；后端落地后会把接口说明和这 8 条写进待办 A13，到时再按那份重做）：
  1. 分两个标签：Bus Tour / Tickets - SelfDrive（不是现在的「按 Products 分块、所有产品混在一起」）。
  2. Bus Tour 标签的胶囊按 Group；Tickets 标签的胶囊按门票 tour type（不是现在统一按 Products 的 Group/Category）。
  3. 一次只显示一页，按 A→Z（不是现在整天所有块一次性全显示）。
  4. Rezdy 订单字段全部给 staff，用弹窗勾选要显示哪些（不是现在固定列）。
  5. **所有 staff 都能进这一页**（现在接口是 admin only——在新包落地前，普通 staff 打开 `/manifests` 会被拒绝）。
  6. ~~金额相关的一组只有 admin 能看~~ → **Annie 2026-10-07 晚 纠正：所有 staff 都能看**（价格本来就是订单信息，无需保密），等后端放开，见「需要后端」。
  7. Cfm # 并进这一包（现在是只读，没有任何输入控件）。
  8. **按名单发送 / 发自定义消息两包紧接着做**——这不是「以后再立项」，是这次改版的一部分；Annie 原话：那几项「明天做」
     不是「不做」，是核心功能。
  - 顺带：migration 的所有权从 `task/seat-guests` 转到了 `task/manifests-fields`（和 Dispatch 排车页的 Seat guests 无关，
     只是编号占用；`task/seat-guests` 以后接着做时后端会处理）。
- 这意味着现在 `task/manifests-page` 上的分块方式、单页全显示、固定列、admin-only、无法填 Cfm # 这几处**全部要推翻重做**，
  不是小修小补；等后端包落地、接口形状确定后，参照旧实现里能复用的部分（日期 ‹ › Today 的处理、CSV 导出、Legacy 数据提示
  这类和后端接口形状无关的逻辑）重新搭页面更合适，不建议在旧分支上继续改。

### 登录后回到原页面（后端 G32）+ 门票 tracking 跟 Cancel

- 分支：`task/ops-login-cancel`（从 `task/morning-send-guard` 拉出——**不是**从 `task/manifests-page`，因为 Manifests 那版要重做，
  不能让这两件已经验收就位的事被它拖着）。跟后端 `e3d180b` G32（ops 转发 `/auth/*`）、`10c2232` tickets-cancel（2026-10-06 晚都合进 main）。
- 状态：lint / typecheck / build 通过；`checks/headless` 全跑 **27 套、960 项全过**（不含 `man` 套，那一套只在废弃的
  `task/manifests-page` 上）。**登录回跳没有在线上实测过**（本地登录流程和之前一样，用的是本机的 confirm）。等 Annie 验收。
- **登录回跳**（Annie 2026-10-06 晚定「选项 1：ops 转发，后端不改」，不走「cookie 放宽到整个域名」那条路）：
  - `next.config.ts` 新增三条转发：`/auth/login`、`/auth/change-password`、`/auth/logout` → 后端。登录发生在 ops 自己的网址上，
    后端回的 `Set-Cookie` 没带 domain，cookie 因此只属于 ops；旧后台 confirm 域名上的登录完全不受影响，还是老样子。
  - 401 跳转（`lib/safe-redirect.ts` 的 `buildLegacyLoginRedirectUrl`，函数名没改，30 个调用点都不用动）改成跳站内
    `/auth/login?next=<当前路径+查询串>`——只带路径，不带域名（后端 `safe_next()` 只收站内路径，带了完整网址会被丢掉、
    登录后悄悄落到默认首页）。调用方传的都是 `window.location.href`，这个函数自己把它裁成 `pathname + search`。
  - 侧栏 Sign out 从 `${legacyAdminBaseUrl}/auth/logout` 改成站内 `/auth/logout`。
  - 登录不带 `next`（直接打开 `/auth/login`）时后端按角色跳 `/admin/dashboard`（旧后台地址），ops 上原来是 404；
    `next.config.ts` 加一条 `/admin/dashboard` → `/dashboard` 的重定向。
  - 删掉不再用到的占位登录页 `/login`（「登录功能尚未实现」那个占位页；真正的登录页现在是 `/auth/login`，代理后端渲染的内容，
    不经过本仓库的 React 页面）；`NO_NAV_PREFIXES` 机制清空（只是给它用的，机制留着给以后别的页面用）；headless 的
    `run-all.js` 探活页面从 `/login` 改成 `/dashboard`（`/login` 删了会一直探活失败）。
  - **还在用初始密码、必须先改密码的账号**：ops 接口回的是 **403**「Password change required」而不是 401
    （`app/auth.py` 的 `_signed_in()`），上面那条 401 跳转碰不到它。这个 403 **不靠每个页面自己判断**——101 处
    `isStatus(error, 401)` 分散在二十几个顶层页面和十几个子组件（评论、对话框、Excel 导入……）里，要求每处都加一个
    `else if` 不现实、也容易漏。改成**在 `lib/api-client.ts` 的 `apiFetch` 里全局拦截**：响应不是 2xx 时，先判断
    是不是这个特定的 403（状态码 + detail 精确等于 `"Password change required"`，不是随便哪个 403 都算），是就跳站内
    `/auth/change-password?next=<路径>`（同一把裁剪路径的函数），再照常 `throw`——调用方原有的 401 / 其他错误处理
    一概不用改，这个拦截发生在它们看到错误之前。模块级标志位防止并发请求各跳一次。
    ⚠️ **这句话是靠英文原文精确匹配认出来的**：Annie 转达后端提醒，以后如果后端把 `auth.py:342` 那句 `HTTPException(403,
    "Password change required")` 的措辞改了，ops 这边的跳转会**静默失效、不报错**。后端会在那一行旁边加注释说明 ops 依赖它；
    ops 这边如果以后看到改密码跳转不生效了，先去确认这句话有没有被改。
  - 影响面广：全部 23 个涉及「未登录跳登录页」的 headless 断言都改了（从 `${旧后台域名}/auth/login?next=<完整网址>` 改成
    `${ops 自己}/auth/login?next=<路径>`），teams / users 套里对 `next=` 精确匹配完整网址的几处也改成路径；
    `ops`（Ops Summary）套加了一个 403 跳改密码页的场景（原来做在 `man` 套里，因为那个分支废弃了搬过来）；
    Broadcasting Log 套里一处刚好拿 `"Password change required"` 当别的场景（收件人拉不到）的模拟错误文案，撞上了新的
    全局拦截，改成不冲突的文案（`500 Internal Server Error`）。
- **门票 tracking 的 Cancel**：后端今天已经支持 `confirmation=cancel`（原来回 400），去掉前端「can't save Cancel yet」的
  特殊处理和改回原值的逻辑，Cancel 现在和 YES / Pending 走同一套保存流程（成功 / 失败的处理也一样）。

**验收步骤**（⚠️ 第 1、3 步在**线上**测，本地两边都是 localhost 测不出真实跨域效果；第 5 步只改 `ZZ Test` 的单）：

1. 线上：退出登录，打开 ops 任一页面 → 跳到 ops 自己的 `/auth/login`（地址栏还是 ops 的域名，不是 confirm）→ 登录 → 回到刚才那一页。
2. 退出登录（点侧栏 Sign out），再打开任意 ops 页面：要求重新登录（cookie 真的清掉了，不是只清了 confirm 那一份）。
3. 直接打开 ops 的 `/auth/login`（不带 `next`）登录：落到 `/dashboard`。
4. 找一个还没改过初始密码的测试账号登录 ops：任意一页都应该跳到 `/auth/change-password?next=<刚才那页>`
   （没有这样的账号就跳过，headless `ops` 套已经拿模拟接口验证过这条）。
5. `/tickets-reminder/tracking` 找一张 `ZZ Test` 的单：状态改成 Cancel → 保存成功、下拉显示 Cancel；改回 Pending。

### 后端 10-07 下午 / 晚跟进：Dispatch 司机名后不挂语言；门票 Arizona 时区说明

- 分支：`task/manifests-v2`（链尾）。核对了后端 main 上 10-07 16:00 以后的四个包：
  - `dispatch-lang-label`（`8aec48b`）：Annie 定 Dispatch 司机下拉的名字后面**不再挂语言**（「Annie Test · Mandarin」→「Annie Test」），
    `/api/dispatch/*` 的司机清单也不再返回 `languages`。**ops 已跟**：`components/dispatch/vehicle-row.tsx` 去掉语言后缀、
    `types/dispatch.ts` 的 `DispatchDriver` 去掉 `languages`；HR 页的 Language 字段不受影响（还在、照常存）。
  - `tix-arizona-clock` + `tix-az-note-always`（`958a797`、`92a3b4a`）：门票邮件和客人确认页加「All times are Arizona local time…」说明，
    客人页再加一个实时 Arizona 时钟，一律显示。**实际发送在后端渲染，ops 不用改**。门票发送页的消息预览（Email / Guest Page 标签）
    来自后端，说明会自动出现；但 ops 的预览 iframe 是 `sandbox=""`（不跑脚本，有意保留），所以**预览里的时钟显示「—」**，
    客人收到的页面上时钟正常走。旧后台的预览没加 sandbox，时钟会走——这是已知差异，不改。
  - `tix-preview-minutes` + `tix-az-note-always` 的 Content Studio 部分：只改了旧页面的**整版邮件 / 客人页模拟预览**
    （Check-in 时间跟着「Check-in minutes」算、加时区说明）。ops 的 Content Studio 没有搬那套整版预览（只有逐字段预览），
    `{checkin}` 只出现在短信正文里，后端短信预览仍是 9:00 AM，**ops 不用改**。
- 状态：lint / typecheck / build 通过；`da` 套 **75 / 75 通过**（司机下拉那条改成期望不带语言）。

**验收步骤**（只读）：

1. `/dispatch` 的 Step 2，打开任一辆车的司机下拉：名字后面没有「· English, Mandarin」之类的语言（HR 里勾了 Language 的人也一样）。
2. `/tickets-reminder/send` 选团型和日期，看消息预览的 Email 标签：Check-in Time 下面有灰字 Arizona 时区说明；
   Guest Page 标签有同样说明和「Current Arizona time: —」（预览里时钟不走，属预期）。

### Dispatch 拆成 Assign / Send 两个标签（Annie 2026-10-07 晚）

- 分支：`task/manifests-v2`（链尾）。**全新功能，只在 ops 做，旧 Jinja2 页面不改**（后端 G29 那段已定）。
- Annie 的定义：**Assign = 分配车、司机、酒店**；**Send = 第一部分发给司机（driver manifest + 手机版信息），第二部分是原来的 morning send**。
  「原来的 morning send」Annie 确认指的是**排车页原来的 Step 3 Morning Relay**（Pull from manifests + 按 1st / 2nd Round 发），
  原样搬进 Send；独立的 `/morning-pickup/send`（上传 Excel）照旧保留，不动。
- 做法：
  - 页头下面两个标签 **Assign | Send**，地址带 `?tab=send`（Assign 不带），刷新 / 直接打开停在原标签。日期 `?date=` 照旧。
  - **Assign**：Step 1 Guest lists、Step 2 Buses & drivers（内容不变；Assign Bus、Copy、Save schedule、右栏都在这里）。
  - **Send**：Step 1 **Send to drivers**（原 Step 4，标题说明改成「link to their manifest on their phone」）、
    Step 2 **Morning Relay — text guests**（原 Step 3）。顺序照 Annie 说的：先司机、后客人。每个标签各自从 Step 1 编号。
  - **检查点**：Send 两步都读**存好的**排车。Assign 有没存的改动时：Assign 标签上挂「unsaved」，Send 顶上黄条
    「Assign has unsaved changes…」+「Back to Assign」，**Send 1st / 2nd Round、Send texts now 都关着**，存好或 Discard 以后恢复。
    Pull from manifests、看司机名单（只读）不拦。
  - 两个标签都一直挂着、只是藏起来：来回切不丢没存的改动，也不丢已经拉过的客人 / 司机名单。
  - 在 Send 那边按底部 Save schedule 而有车缺司机（或服务端点名某一行）：自动切回 Assign、滚到那一行。
  - 页头说明改成「Assign the buses, drivers and hotels and save, then Send: driver texts first, then guests’ morning pickup texts.」；
    右栏改成「Tour manifests and the Send tab use the saved schedule」；两个 How to use 里的「Step 1 / Step 2」改成「on the Assign tab」。
- 以后 G29 第二批 Seat guests 合进 main，放进 Assign（Step 3）。
- 状态：lint / typecheck / build 通过；headless `da` 套 **84 / 84**（原 75 + 9：默认标签、两边各自的步骤、`?tab=send`、直接打开停在 Send、
  黄条和两个发送键关着、Back to Assign、丢掉改动后恢复且名单还在、在 Send 按 Save 缺司机切回 Assign、各标签编号）；`mf` 32 / 32、`nav` 13 / 13。
  没有连真实后端发过。

**验收步骤**（⚠️ 不要点 Send 1st / 2nd Round、Send texts now 里确认框的发送键——会真发）：

1. 打开 `/dispatch`：页头下面有 Assign / Send 两个标签，默认 Assign，里面是 Step 1 Guest lists、Step 2 Buses & drivers。
2. 点 Send：Step 1 Send to drivers、Step 2 Morning Relay — text guests；地址多了 `&tab=send`，按 F5 刷新还是 Send。
3. 回 Assign 随便改一处（不存）：Assign 标签上出现 unsaved；切到 Send，顶上黄条，点 Pull from manifests / Send to driver 能看名单，
   但 Send 1st Round、Send texts now 是灰的。点 Back to Assign 回去，底部 Discard。
4. 再到 Send：黄条没了，刚才拉的名单还在。

### Dispatch 步骤说明放大；dashboard 改回旧后台的深色（Annie 2026-10-07 晚）

- 分支：`task/manifests-v2`（链尾）。
- **Dispatch 每一步标题下的说明**：原来 12px 浅灰，Annie 说看不清。改成 14px 深色（`components/dispatch/step-box.tsx`，四步都改）。
  Send to drivers 的说明重写，讲清楚司机收到什么：一条带链接的短信，链接打开**他自己手机上的 manifest**（先登录），
  看到他开的车和车上的客人；客人这一步收不到任何东西；点 Send to driver 先看确切文字和名单才发。
  点开名单后那行真实短信内容也放大、加浅蓝底，写成「Text each driver gets: …」。
- **dashboard 配色**：09-30 第一版就是浅色（当时 PROGRESS 写的是「配色跟新前端其他页面走浅色」），不是后来被改的。
  Annie 要和旧前端一模一样 ⇒ 照旧后台 `dashboard.html` + `base.html` 改成深色：底色 `#06101c` 加两团蓝色光晕、IBM Plex Sans 字体、
  快捷卡（半透明卡片、彩色边框、右上角实心圆点和箭头、悬停发光）、Messages 三个窗口和消息卡片的颜色、改期橙 / 等待琥珀、
  全部处理完的绿框，数值都照旧页面的 CSS。共用的渠道图标和 WhatsApp 窗口胶囊加了 `dark` 选项，只有 dashboard 用，tracking 页不变。
- 顺带跟上旧页面 10-02 的两处改动（ops 当时没跟）：Messages 标题旁加「📖 How to use」按钮，6 条说明**默认收起**、点开才显示；
  状态行成功时不再显示日期（只在加载中 / 拉不到时显示）。
- **只改了 dashboard**。其他页面（tracking、发送页、设置页……）还是浅色，旧后台那些页面是深色——要不要全站都改深色，等 Annie 定。
- 状态：lint / typecheck / build 通过；headless `da` 84 / 84、`mt` 98 / 98（含 dashboard 链接）、`nav` 13 / 13；
  模拟接口截图看过 dashboard 和 Dispatch Send 标签。

**验收步骤**（只读）：

1. 打开 `/dashboard`，和旧后台 `/admin/dashboard` 并排看：深色底、快捷卡、Messages 三个窗口、消息卡片的颜色和字体一致。
2. 点 Messages 旁的「How to use」：展开 6 条说明，再点收起。
3. `/dispatch` → Send：Send to drivers 下面的说明是正常大小的深色字，写着司机收到什么；点 Send to driver，名单上方是「Text each driver gets: …」。

## 待做（按顺序）

0. ✅ 后端 2026-10-03 晚上线的两件事都已跟进（等 Annie 验收）：
   - 门票发送页跟后端防重发 + 重新上传比对 / Apply：见上面「门票发送页：防重发」（单独分支 `task/tickets-send-resend-guard`，从 main 拉出）。
   - 后端 `ops-backend-apis` 的 4 条：见上面「Send Log / Order Log 日期范围、MTLV、门票列设置」（`task/ops-api-catchup`）。
     接口说明以后端规则文档第五节第 5 行为准。

1. ✅ Tour 发送（含 Last Minute）：`task/tour-send-page`；✅ Tour tracking：`task/tour-tracking-page`。（下面是当时的备忘，已照做）
   - 补录 `/send/tour-tracking-import-*` 不在 `/api` 下，要在 `next.config.ts` 单独加转发。
   - Tour tracking 可直接复用：对话弹窗（by-order，**读不带 line、写带 line=tour**）、预览格、群发弹窗
     （Tour 的人群是 General / MTLV，`group_filter` 传 `general` / `mtlv`，要给群发弹窗加这种模式）。
   - 列顺序偏好 `tour_col_order` 存的是**列序号数组**（"0".."16"），不是列名；要和旧页面互通就得按旧页面 17 列的顺序换算。
   - 旧页面 bug 记录在案（日期按 UTC、改状态后产品按钮错亮、群发不检查错误等），做的时候一起修。
1b. ⏳ **30 Days Forecast**（侧栏现在是 `soon: true` 占位）：后端接口 `GET /api/forecast/30-day` 已上线（2026-10-08，任务包 forecast-30day），
   `require_staff`。返回固定 30 条、从洛杉矶今天起每天一条 `{date, pax}`（`date` 为 `YYYY-MM-DD`，没有订单的日期 `pax: 0`，不是不返回，
   可以直接按下标取）；`pax` 是当天全部 Rezdy 团的人头汇总，**这一版没有按产品/分类拆**。⚠️ 已知口径缺口：现在少算约 1,534 笔还没回填进
   `rezdy_bookings` 的老单（卡在 Rezdy API key 上 Railway，见 Manifests 那条「待办后端」），和 Sales Report 现在的缺口是同一个原因，
   UI 上不用特别处理，但可以在页面上留意，等 key 到位后数字会变。开工前先确认后端是否已有新的拆分字段上线（接口可能会在这版基础上继续加）。
2. 后端接口已就绪的页面已全部做完（最后两页 `/settings/hr`、`/settings/vehicles`）。
3. **Dispatch 一组也要迁**（Annie 2026-10-03 晚定「现在就迁」，「全部做完才切换」包括它们）。顺序从小到大：
   - ✅ Work Sheet、Guide Sheet（`task/dispatch-sheets`）
   - ✅ Imports（CCL 导入）：`/dispatch/imports`（`task/ops-api-catchup-2`）
   - ✅ Tour Manifest + 上传面板（`task/dispatch-manifest`；打印 / 下载转发到后端）
   - ✅ Assignments 排车（`task/dispatch-assignments`）
   - ✅ Morning Relay 面板（拉客人、两轮发送、Send to driver）：`task/morning-relay`。司机页 / 导游页是后端渲染的手机页（field），不在 ops。
   - ⚠️ 后端还在频繁改 Dispatch：每页开工前重新看后端最近的提交，以 main 上的为准。
   - ✅ **Dispatch 分步**（G29 第一批，后端 `fc8e0f9`）：`task/dispatch-steps`。
   - ⏳ **G29 第二批 Seat guests**：后端 `task/seat-guests` 草稿（v73），合进 main 后在链尾上跟（会成为新的 Step 3）。
   - ⏳ **两条全新 Dispatch 功能，Annie 2026-10-06 深夜定「放新前端做，不进旧 Jinja2 页面」**（后端 G29 条目、
     2026-10-06 晚那段；后端窗口 2026-10-06 深夜又跨会话发消息提了一遍，不紧急，随手开始）：
     1. **Morning Relay 2nd Round 加「复制 1st Round」按钮**：司机 / 车大概率两轮一样，复制过去；
        **酒店不复制**（`migrate_v62.sql`，两轮酒店各自独立）。放哪、复制规则细节都还没谈，开工前先问 Annie 具体要求
        （不要照自己猜的做，这条判据是「全新功能，旧页面没有对应实现」，不是「已经设计好，照抄」）。
     2. ✅ **把 Dispatch 拆成 Assign / Send 两个标签**：Annie 2026-10-07 晚细化后已做，见「进行中」最后一小节。
     - 判据（后端原话）：旧 Dispatch 页**还没铺给 staff 日常用**（「我的 dispatch 还没用起来，不存在不完成就走不了的状况」），
       这两条又是全新功能、旧页面没有对应实现可比对，所以不用在旧模板和新前端各做一遍，直接在这边做。
   - ⏳ **旧 Dispatch 页「Check the bus」那批设计，已谈定、明天（10/07）要上线旧页面**（不是 ops 的事，但要留意）：
     按钮 `Assign Bus` 改名 `Check the bus`；团卡片没传 CSV / 零车 / 车没排字母 / 车齐但客人没分完这几种情况，
     卡内橙字说明问题、对应的那个按钮改实心蓝、其余描边；Pull from Discord 旁的时间戳挪到按钮边上；
     全站右下角浮动 ↑↓ 按钮改蓝色矢量图标、加粗。⚠️ **ops 的 `/dispatch` 是独立实现、不是嵌旧模板**，这批
     上线后要回来核对 ops 的 Step 1 团卡片是不是也要跟进同一套文字 / 颜色 / 提示逻辑（同「全部页面做完才切换」
     之前两边尽量保持一致的原则），不要假设自动同步。设计全文（含 Annie 否决掉的两种做法）在后端 `NPE_待办清单.md`
     G29 条目 2026-10-06 晚那段，动 Dispatch 前先读一遍，不要重新设计一遍。

4. ❓ **Messages（侧栏一级入口）**：旧后台侧栏链到 `/admin/messages`，但后端**没有这条页面路由**（点了 404），只有内部消息接口
   `GET/POST /api/messages`、`/unread-count`、`/{id}/read`、`/read-all`、`DELETE /{id}`。没有旧页面可迁。
   **Annie 2026-10-05 定：先留着不做**，等链合进 main 以后直接在 ops 上做（做成什么样她还没想好，到时再说）。
   在那之前 ops 侧栏照旧链回旧后台（同样是 404）。
5. 到这里，除了 Messages、Manifests，旧后台侧栏上的页面都已迁完（3 个 Utilities、coming-soon、Test Orders 按约定不迁）。
   - ⚠️ **漏了：dashboard 的 Multi Orders 窗口**（2026-10-07 晚发现）。旧 dashboard 10-01 加了第四个窗口（粉色，有卡片时才出现）：
     号码 / 邮箱名下有几张没出发的单时，来信不挂单、进这里；卡片上直接 Reply / Assign（`/booking-notes/multi/*`），还有「一单多团期」的卡。
     ops 的 dashboard 是 09-30 做的，没有这个窗口——现在这类消息在 ops 上**看不到**。切换前必须补。
6. ⏳ **Manifests（`/admin/manifests` → ops）**：Annie 2026-10-05 定要迁，**等后端**（接口需求见「需要后端」）。
   - 旧页面不能照搬：读老 `bookings` 表（8/16 以后的 Rezdy 订单看不到），还有五处半成品（后端待办 A1 第 9 条：换日期不生效、
     发送按钮没接、导出 404、三个标签不筛选、Cfm # 存完没提示），没有 JSON 接口。
   - Annie 2026-10-05 定：
     - **数据走 Rezdy webhook**（`rezdy_bookings`，排除已取消），不用手工上传。**只这一页**；发送页、排车的 Tour manifest、补录照旧上传，以后另立项。
     - **数据来源原则（Annie 2026-10-06 定）**：
       - 新系统以 Rezdy 为准。老系统的数据是手工上传的，Rezdy 只是陪跑；两个来源**物理隔开**，手工来的数据不写进 `rezdy_bookings`。
       - Annie 有 Rezdy API key：**漏掉的推送用 API 按时间段从 Rezdy 拉回来补**，拉回来的是 Rezdy 数据，直接进 `rezdy_bookings`；
         最好每天定时对账未来几天的订单（缺的补、状态不一致的按 Rezdy 改、有差异发邮件）。只读 Rezdy，不往 Rezdy 写。
       - 同一单（订单号 + 产品 + 团期）只认一行；新旧按 **Rezdy 自己的修改时间**判断，不按进库 / 上传时间。不物理删除，被取代的行只是不显示。
       - 手工上传补单表**先不做**，只作为 Rezdy 整个不可用、API 也拉不到时的后备方案（真要做时：独立的表、上传先预览、只补缺不覆盖、能整批撤回）。
       - key 放 Railway 后端的环境变量，不进任何代码仓库、不贴进对话。
       - ops 的 Manifests 页因此只读一个来源，不需要「上传补单」入口；后端做了对账的话，页面可显示「上次和 Rezdy 对账：几点、补了几单」。
     - **按 Settings → Products 分块**：Group 分块、标签用 Category、产品名用 Internal name；还没加进列表的产品单独一块。
     - **能发送**，两种都要：① 勾选客人发**对应的确认 / 提醒**（Bus Tour → 巴士团确认、Tickets → 门票提醒、Morning → 早班接客，
       内容同对应发送页；服务端查重和发送页互通，发过的跳过、Send anyway 再发一次）；② 勾选客人发**自己写的消息**（选模板或手写，同群发，记进 Broadcasting Log）。
   - 前端做法（接口好了再开工）：日期（`?date=`、‹ › Today）、分块和计数、勾选、Cfm #、导出 CSV；发送照 ops 其他发送页
     （确认框、每 10 位一组、出错就停、可能已发时指向 Send Log）；自定义消息复用群发弹窗。
   - ⏳ **2026-10-06 深夜状态**：列表接口 `GET /api/manifests?date=`（上面说的「按名单发送」还没做）已经上线过一版，ops 按它做了
     `/manifests` 页（分支 `task/manifests-page`），但 Annie 当晚接着定了 8 条新方案（分两个标签、胶囊按产品类型、一次一页、
     弹窗选字段、所有 staff 能进、金额只 admin 看、能填 Cfm #——详见「进行中」的「`/manifests` 暂停」小节），旧版对不上，
     **分支已废弃**。等后端 `task/manifests-fields` 落地、接口形状确定后按新方案重做，不要在旧分支上改。

## 切换前检查清单

Annie 2026-10-03 定：**全部页面做完才一次性切换**，在这之前员工继续用旧后台，ops 页面只用于验收
（连的是生产后端，发送页点了就真发）。切换前逐项确认：

- [ ] 「待做」里的页面全部验收通过、已合进 main。
- [ ] 登录回跳线上实测通过（ops 转发 `/auth/*` 的做法，见「进行中」最后一小节的验收第 1–4 步）。
- [ ] ops 站内不再有链到旧后台的链接（dashboard 快捷卡、消息卡片、**侧栏里标 old ↗ 的几项**，搜 `legacyUrl`、`legacy: true`）。
- [ ] 旧后台页面怎么处理（跳到 ops 对应页 / 保留只读 / 下线）由 Annie 定，后端窗口做。
- [ ] 通知员工改用 `ops.nationalparkexpress.com`，并定好切换日期；切换当天避免新旧两边各发一次。

## 不迁移

- 3 个 Utilities 页
- coming-soon
- Test Orders（等 E1）

## 需要后端

由 Annie 转给后端窗口。

- **Manifests 的 Money 组放开给所有 staff**（Annie 2026-10-07 晚 纠正：manifest 上的价格本来就是订单信息，大家都能看，无需保密；
  取代 10-06 那 8 条决定里的第 6 条「金额一组只有 admin 能看」）。现在是后端 `app/services/manifest_fields.py` 的
  `ADMIN_ONLY_GROUPS = frozenset({"money"})` 挡的：staff 拿到的字段目录里没有 Money 组，存过的金额列进 `denied`。
  后端放开后 **ops 不用改代码**（前端不判断角色，目录里有什么就显示什么）；只需重跑 `man` 套、把「staff 没有 Money 组」那条检查期望改掉。
  司机 / 导游仍然 403 进不了这页（这条没变）。

- ~~Send Log 按订单号查（`order_number`）、Broadcasting Log 按订单号查（`GET /api/broadcasting-log/by-order`）、本地关定时任务~~
  已完成（后端 main `034a833`，2026-10-05 上线），前端已跟进（`task/log-order-search`）。
  本地跑后端时在 `.env` 里设 `DISABLE_SCHEDULER=1`（只认 "1"，Railway 上不生效），就不会和线上一起跑邮件队列 / 日报。

- ~~HR 列布局 `hr_list_layout`~~ 已完成（后端 ops-backend-apis-2 c，2026-10-04）。
- （可选）HR 字段元数据接口：现在字段、选项、长度是照抄 `hr_profiles.FIELDS`，后端改字段时前端要手动同步。

- ~~登录回跳~~ 已完成：Annie 2026-10-06 晚定走「ops 转发 `/auth/*`、后端不改」（后端 `e3d180b` G32 记录），
  前端已跟进（`task/ops-login-cancel`，见「进行中」最后一小节）。线上还没实测，等 Annie 验收。

- ~~旧后台 dashboard 的 Messages 说明（6 条）~~ 已完成（后端 dashboard.html 已是这 6 条）。

- ~~门票状态 Cancel~~ 已完成（后端 `10c2232` tickets-cancel，2026-10-06 晚），前端已跟进（`task/ops-login-cancel`）。
  当时顺带问的还没答：这个接口按「CHD 号 + 服务日期」更新，同一单同一天买了几个产品会一起改——是不是想要的行为。
- ~~Dispatch 排车页的 7 个常量~~ 已完成（`GET /api/dispatch/day` 的 `meta`，2026-10-04），前端已跟进（`task/ops-api-catchup-2`）。
- （可选）Tour manifest 打印 / 下载的 `/api` 版：现在 ops 把 `/admin/dispatch/manifest/print`、`/download` 两个地址原样转发到后端
  （后端渲染、打印照常写日志）。没登录时后端 302 到相对的 `/auth/login`，在 ops 域名上是 404；出错时浏览器整页显示 JSON。
- ~~Dispatch Imports 列表接口~~ 已完成（`GET /api/dispatch/imports`，2026-10-04；顺带修了 `since` 早时最新几天被截掉），前端已跟进（`/dispatch/imports`）。
- ~~Send Log 日期范围 + MTLV、Order Log 日期范围、Ops Summary SQL 注入（B98）、`tickets_col_order`~~ 已完成
  （后端 `ops-backend-apis`，2026-10-03 晚），前端已跟进（`task/ops-api-catchup`）。
- Ops Summary 口径（不急，改了数字会变，要 Annie 定）：`failed: <原因>` / `sent:<sid>` 这类带后缀的状态既不算成功也不算失败
  （待办 E114）；短信 `undelivered` 不算失败；回复统计按 send_log 行数 × 订单行数算（重发、一单多团期会重复计）；
  早班签到没按日期过滤；This Week 是滚动 7 天、This Month 按数据库时区不是洛杉矶。
- ~~巴士团型接口~~ 已完成（`GET /api/notifications/tour-confirmation/tour-types`，2026-10-04，待办 B28 部分解决：团型清单还在后端代码里，staff 不能自己加团）。
- ~~早班追踪窗口结束时间~~ 已完成：`GET /api/notifications/morning-pickup/tracking` 顶层字段
  `tracking_window: {end_minute, end_label}`，前端据此决定何时停止轮询，不要写死 10:30

- ~~旧后台排车页「Nothing is sent from this page」~~ 已完成（后端 G29 第一批 `fc8e0f9`，2026-10-05 合进 main），ops 同步改了文案（`task/dispatch-steps`）。
- （可选）Guide view 预览页（`field/guide_home.html`）的 Sign out 是相对地址 `/auth/logout`，从 ops 打开时点了 404。预览时可以不显示 Sign out，或写成旧后台的绝对地址。
- （可选）Send to driver 没有查重：同一天再点一次就再发一遍（页面确认框会提醒）。要不要像客人短信那样防重发，由 Annie 定。

- ~~早班发送 `/send/morning-pickup` 没有服务端防重发~~ 已完成（后端 `3684df7` morning-send-guard，2026-10-06 晚合进 main，E141/E142），
  前端已跟进（`task/morning-send-guard`）。

- 2026-10-05 全链审查时发现的后端问题（旧页面同样受影响）：
  - **Sales Report 只读老 `bookings` 表**：8/15 分流以后新的 Rezdy 订单只进 `rezdy_bookings`，所以报表里少了这之后的新单，
    还可能把发送流程建的行算进去。旧页面一样。
  - Order Log 列表只按 `created_at DESC` 排序，没有第二排序键：时间相同的行在翻页时可能重复或漏掉。ops 导出已按 id 去重，
    建议后端加 `, al.id DESC`（`order_log.py`）。
  - 发送批次的汇总把「客人没有电话 / 邮箱」算成失败（`logged - went_out`）。ops 结果页已单独列 No address，Send batches 的数字仍按后端。
- **Manifests 页（Annie 2026-10-05 定要迁到 ops，决定见「待做」第 6 条）**，按顺序：
  1. 后端待办 **A9**（回放导入）→ **A13**（Manifest 改读 `rezdy_bookings`、排除 CANCELLED / DELETED）。A9 要动生产库，时间由 Annie 定。
     A13 写明「别再实现 `parked/a1-manifest-dedup`」。
     ⚠️ **2026-10-06 按「数据来源原则」（见「待做」第 6 条）A9 要重新评估**：原方案是把老表数据抄进 `rezdy_bookings`，违反来源隔开。
     建议改成拿老表里未来团期的订单号**用 Rezdy API 拉**，顺带解决 117 笔幽灵订单（老表 confirmed / Rezdy 已取消）和「取消落空」，
     也看还要不要一个大事务锁表、挑时段。另请后端先确认 key 的权限、能按什么条件查、调用频率限制。
     还有一处数字要核：A13 写「只在老表、团期未到的 3,413 行」，A9 批 A 只覆盖约 926 行，批 B（约 3,000 行无明细）不导——换表后批 B 剩下的会不会从 Manifest 消失。
  1b. **用 Rezdy API 补漏 + 每日对账**（新）：按时间段拉订单补漏掉的推送、定时对账未来几天，写 `rezdy_bookings`，按 Rezdy 修改时间判新旧。
  2. ✅ 列表接口已完成（`GET /api/manifests?date=`，2026-10-06 晚 `a641f99`）：当天订单（item 级）、按 Products 分块、
     三条发送线的发送记录，前端跟过一版（`task/manifests-page`）。
     ⚠️ **这一版接口形状已经过时**：Annie 2026-10-06 深夜又定了 8 条新方案（两个标签分 Bus Tour / Tickets-SelfDrive、
     胶囊按产品类型、一次一页、弹窗选字段、所有 staff 能进、金额只 admin 看、能填 Cfm #——见 ops `PROGRESS.md`「进行中」
     的「`/manifests` 暂停」小节），后端对应分支 `task/manifests-fields`（`tasks/ACTIVE.md` 提交 `b148b41`）。
     接口的参数和返回要跟着这 8 条改，第 3（Cfm # 写哪）、5（权限开放给所有 staff，金额组另算）条尤其会影响接口形状。
  3. Cfm # 写在哪：旧页面写老 `bookings`（`PUT /api/bookings/{id}/confirmation-no`）；`rezdy_bookings` 是 webhook 镜像，Orders 页对新表的单是只读（409）。
     新表上的确认号存哪里、怎么写，后端定——Annie 新方案第 7 条要求「能填 Cfm #」，这条的答案直接决定接口怎么接。
  4. 按名单发送（不用上传文件）：勾选的订单号 + 线（tour / tickets / morning）+ 发送方式，发**和对应发送页同样的消息**；
     服务端查重和那三条线的发送页**互通**（任一边发过都算），Send anyway 只再发一次；建批次、进 Send Log / Send batches，同发送页。
  5. 按名单发自定义消息：勾选的订单号 + 模板 / 手写正文 + 渠道，记进 Broadcasting Log（和现在的 `/booking-notes/broadcast/send` 一样，但人群是勾选的订单，不是按团 / 状态筛）。
  6. 导出：前端用列表数据生成 CSV 即可，不需要 `/api/manifests/export`。

## 注意

- HR 页按后端 2026-10-03 main 上的 `/api/hr/*` 做的；后端再改 HR 字段 / 接口时要同步前端。
- **headless 检查在 `checks/headless/`**：`cd checks/headless`、第一次 `npm install`、`node run-all.js`（约 10 分钟，只连本机模拟接口）。
  改了页面以后跑对应的套（`node run-all.js tt da`），新页面照现有的套写一个 `<名>-mock.js` + `<名>-test.js`。
