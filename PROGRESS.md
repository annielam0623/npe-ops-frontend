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
> `task/dashboard-links` → `task/morning-tracking-page` → `task/tickets-tracking-page` → `task/pickup-locations-page` → `task/products-page` → `task/broadcasting-log-page` → `task/bug-reports-page` → `task/ops-summary-page` → `task/order-log-page` → `task/sales-report-page` → `task/task-board-page` → `task/orders-page` → `task/content-studio-page` → `task/hr-page` → `task/vehicles-page` → `task/dispatch-sheets` → `task/ops-api-catchup` → `task/dispatch-manifest` → `task/dispatch-assignments` → `task/app-nav`。
> **最新：`task/app-nav`**，
> 验收在这个分支上看全部。⚠️ 推 main 会自动部署。

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
  ⚠️ 后端 main 上还不认 `hr_list_layout` 这个键（要合并 `task/hr-list-columns`），**在那之前只存在本机浏览器**，
  页面会写「saved in this browser.」；已记进「需要后端」。
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
6. 拖一列标题、拖宽一列，刷新后还在；Reset columns 回默认。（后端合并前提示 saved in this browser。）
7. Export to Excel：下载 `NPE_Driver_List_<日期>.xlsx`，列与旧页面导出一致。
8. Import from Excel：用一个只有 `Legal Name` 一列、一行 `ZZ Test Import` 的 .csv，看预览 → Import → 列表里出现，然后删掉它。
9. 用 staff 账号打开：显示 Admin access required。

### `/settings/vehicles`

- 分支：`task/vehicles-page`（从 `task/hr-page` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **20 / 20 通过**；**没有连真实后端保存过**；等 Annie 验收。
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
- 7 个模板常量（班次、轮次名、Assignment 对照、Bus 字母）照抄在 `components/dispatch/config.ts`（后端没有接口，已记「需要后端」）。
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

## 待做（按顺序）

0. ✅ 后端 2026-10-03 晚上线的两件事都已跟进（等 Annie 验收）：
   - 门票发送页跟后端防重发 + 重新上传比对 / Apply：见上面「门票发送页：防重发」（单独分支 `task/tickets-send-resend-guard`，从 main 拉出）。
   - 后端 `ops-backend-apis` 的 4 条：见上面「Send Log / Order Log 日期范围、MTLV、门票列设置」（`task/ops-api-catchup`）。
     接口说明以后端规则文档第五节第 5 行为准。

1. ⏸️ Tour 发送（含 Last Minute）、Tour tracking：**等后端出巴士团型接口**（Annie 2026-10-03 定，不照抄旧页面的写死清单），
   接口要求见「需要后端」。接口来之前跳过。备忘：
   - 发送接口 `/send/tour-confirmation*`、补录 `/send/tour-tracking-import-*` 都不在 `/api` 下，要在 `next.config.ts` 单独加转发；
     发送沿用分批和出错即停。⚠️ 后端给门票加的防重发（send_anyway / preview_at、发前再查）Tour 线有没有，开工前先看。
   - Tour tracking 可直接复用：对话弹窗（by-order，**读不带 line、写带 line=tour**）、预览格、群发弹窗
     （Tour 的人群是 General / MTLV，`group_filter` 传 `general` / `mtlv`，要给群发弹窗加这种模式）。
   - 列顺序偏好 `tour_col_order` 存的是**列序号数组**（"0".."16"），不是列名；要和旧页面互通就得按旧页面 17 列的顺序换算。
   - 旧页面 bug 记录在案（日期按 UTC、改状态后产品按钮错亮、群发不检查错误等），做的时候一起修。
2. 后端接口已就绪的页面已全部做完（最后两页 `/settings/hr`、`/settings/vehicles`）。
3. **Dispatch 一组也要迁**（Annie 2026-10-03 晚定「现在就迁」，「全部做完才切换」包括它们）。顺序从小到大：
   - ✅ Work Sheet、Guide Sheet（`task/dispatch-sheets`）
   - ⏸️ Imports（CCL 导入）：**缺列表接口**，旧页面是服务器端渲染的，见「需要后端」。只有 `POST /api/dispatch/imports/pull` 是 JSON。
   - ✅ Tour Manifest + 上传面板（`task/dispatch-manifest`；打印 / 下载转发到后端）
   - ✅ Assignments 排车（`task/dispatch-assignments`）
   - ⏸️ 后端 `task/morning-relay-pull`（2026-10-03 晚还没合并）要在排车页加 Morning Relay 拉客人面板、司机页的客人、
     **Send to driver 短信**。合进 main 后在 ops 排车页补上（照它的 `_relay_pull_panel.html`）。
   - ⚠️ 后端还在频繁改 Dispatch：每页开工前重新看后端最近的提交，以 main 上的为准。

## 切换前检查清单

Annie 2026-10-03 定：**全部页面做完才一次性切换**，在这之前员工继续用旧后台，ops 页面只用于验收
（连的是生产后端，发送页点了就真发）。切换前逐项确认：

- [ ] 「待做」里的页面全部验收通过、已合进 main。
- [ ] 登录回跳已由后端完成（见「需要后端」），线上在 confirm 登录后能回到原来的 ops 页面。
- [ ] ops 站内不再有链到旧后台的链接（dashboard 快捷卡、消息卡片、**侧栏里标 old ↗ 的几项**，搜 `legacyUrl`、`legacy: true`）。
- [ ] 旧后台页面怎么处理（跳到 ops 对应页 / 保留只读 / 下线）由 Annie 定，后端窗口做。
- [ ] 通知员工改用 `ops.nationalparkexpress.com`，并定好切换日期；切换当天避免新旧两边各发一次。

## 不迁移

- Manifests（等 A1）
- 3 个 Utilities 页
- coming-soon
- Test Orders（等 E1）

## 需要后端

由 Annie 转给后端窗口。

- HR 列布局：合并后端分支 `task/hr-list-columns`（至少 `user_prefs.ALLOWED_PREF_KEYS` 加 `hr_list_layout`）。
  在那之前 ops 的 HR 页列顺序 / 列宽只存在本机浏览器。新页面默认列顺序已按那个分支（Annie 2026-09-30 定）。
- （可选）HR 字段元数据接口：现在字段、选项、长度是照抄 `hr_profiles.FIELDS`，后端改字段时前端要手动同步。

- 登录回跳：在 confirm 登录后跳回原来的 ops 页面（登录接口支持 `next`，线上 session cookie 能带到 ops 子域）。
  后端规则文档第三节记为「未定」、还没登记进后端待办清单。在这之前 teams 验收第 9 步
  「登录后回到原页面」只在本地（同为 localhost）成立。

- 旧后台 dashboard 的 Messages 说明（`app/templates/dashboard.html` 的 `#umSub` 区块，Annie 2026-10-01 要求）：
  把现有的长段说明换成下面 6 条，子弹列表、**不加粗**、亮白色字，深色背景不动。
  文案与 ops `/dashboard` 一致（`components/dashboard/messages-section.tsx` 的 `HELP_ITEMS`），以后改一边要同步另一边：
  - Clear pending replies and date-change requests by the end of the day.
  - Priority: WhatsApp and date-change requests appear first, newest first. Reply to WhatsApp within 24 hours of the guest’s message.
  - Other messages are sorted by departure, soonest first.
  - Today’s Pickup: This morning’s send list. Tour & Tickets: Today onward.
  - Scroll within each panel to see more. Click a message to handle it on its tracking page.
  - No reply needed? Select Take action to remove it. It reappears if the guest messages again.

- 门票状态 Cancel：`POST /api/tickets-reminder/update-status` 现在只认 yes / pending / reschedule_req，
  选 Cancel 回 400。Annie 2026-10-03 定前端保留 Cancel 选项，请后端支持 `cancel`（统计里 Cancelled 一栏已经按 `cancel` 计数）。
  顺带确认：这个接口按「CHD 号 + 服务日期」更新，同一单同一天买了几个产品会一起改——是不是想要的行为。
- **Dispatch 排车页的 7 个常量**（ops 要迁排车页）：旧页面从 Jinja 拿 `coverage_shifts`、`round_names`、`relay_shifts`、`bus_tour_shift`、
  `shift_assignment`、`assignment_labels`、`bus_labels`（`routers/dispatch.py` 页面路由），没有 JSON。请在 `GET /api/dispatch/day` 加一个
  `meta` 块（或单独 `GET /api/dispatch/meta`，require_staff）带这 7 个键。没有的话前端只能照抄。
- （可选）Tour manifest 打印 / 下载的 `/api` 版：现在 ops 把 `/admin/dispatch/manifest/print`、`/download` 两个地址原样转发到后端
  （后端渲染、打印照常写日志）。没登录时后端 302 到相对的 `/auth/login`，在 ops 域名上是 404；出错时浏览器整页显示 JSON。
- **Dispatch Imports 列表接口**（ops 要迁 Dispatch → Imports，Annie 2026-10-03 定 Dispatch 一组都迁）：
  旧页面 `GET /admin/dispatch/imports` 用 Jinja 渲染 `list_imports()`，没有 JSON 版。请加 `GET /api/dispatch/imports?since=YYYY-MM-DD`
  （`require_staff`），返回 `{since, last_ok, last_failed, last_error, imports: [...]}`，`imports` 就是 `list_imports()` 现在给模板的那份
  （每版：id、service_date、title、raw_content、is_revision、status、posted_at / edited_at / version_at、vehicle_count、failed_count、
  lines[含 driver_match / guide_match / *_choices / vehicle_match / vehicle_inactive / tour_name]、closures[]）。
  时间一律 ISO 带时区（前端转洛杉矶）；`since` 读不懂回 400（同 ops-backend-apis 的约定），不要悄悄换成默认。
  顺带：现在 `LIMIT 200` 按日期升序截断，`since` 早时最新几天会被截掉，建议改成按日期降序取、或去掉上限。
- ~~Send Log 日期范围 + MTLV、Order Log 日期范围、Ops Summary SQL 注入（B98）、`tickets_col_order`~~ 已完成
  （后端 `ops-backend-apis`，2026-10-03 晚），前端已跟进（`task/ops-api-catchup`）。
- Ops Summary 口径（不急，改了数字会变，要 Annie 定）：`failed: <原因>` / `sent:<sid>` 这类带后缀的状态既不算成功也不算失败
  （待办 E114）；短信 `undelivered` 不算失败；回复统计按 send_log 行数 × 订单行数算（重发、一单多团期会重复计）；
  早班签到没按日期过滤；This Week 是滚动 7 天、This Month 按数据库时区不是洛杉矶。
- **巴士团型接口**（Tour 发送、Tour Tracking 需要；Annie 2026-10-03 定：等后端出接口，前端不写死）。
  旧页面把这份清单写死在 `tracking_tour.html`（`imp-tour-select`、`TOUR_ABBR`、`TOUR_HAS_BEEF`、`TOUR_HAS_LUNCH`、
  `LUNCH_GROUPS`、`TOUR_ORDER`）和 `send_tour.html`（两个团型下拉、`TOUR_SLUG_MAP`）里，后端 `tc.TOUR_TYPES` 只有
  label / has_lunch / has_beef，**没有简称**，label 也和下拉里的文字不完全一样（bryce_zion、Valley of Fire）。即待办 B28。
  前端需要的是一个只读接口，按显示顺序返回 9 个巴士团型，每个含：
  `key`（与 `tc.TOUR_TYPES` 一致，否则补录预览 400）、`label`（下拉里的全名）、`abbr`（AC-U / AC-L / AC-X / South / West /
  BZ / VOF-F / VOF-H / HD）、`has_lunch`、`has_beef`、`lunch_group`（Antelope / South / BZ / VOF-F，无午餐为空）、
  `file_slug`（发送页检查文件名用，旧页面 `TOUR_SLUG_MAP` 的值）。
- ~~早班追踪窗口结束时间~~ 已完成：`GET /api/notifications/morning-pickup/tracking` 顶层字段
  `tracking_window: {end_minute, end_label}`，前端据此决定何时停止轮询，不要写死 10:30

## 注意

- HR 页按后端 2026-10-03 main 上的 `/api/hr/*` 做的；后端再改 HR 字段 / 接口时要同步前端。
