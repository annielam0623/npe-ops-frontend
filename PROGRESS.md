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
> `task/dashboard-links` → `task/morning-tracking-page` → `task/tickets-tracking-page` → `task/pickup-locations-page` → `task/products-page`。
> **最新：`task/products-page`**，
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

## 待做（按顺序）

1. ⏸️ Tour 发送（含 Last Minute）、Tour tracking：**等后端出巴士团型接口**（Annie 2026-10-03 定，不照抄旧页面的写死清单），
   接口要求见「需要后端」。接口来之前跳过。备忘：
   - 发送接口 `/send/tour-confirmation*`、补录 `/send/tour-tracking-import-*` 都不在 `/api` 下，要在 `next.config.ts` 单独加转发；
     发送沿用分批和出错即停。
   - Tour tracking 可直接复用：对话弹窗（by-order，**读不带 line、写带 line=tour**）、预览格、群发弹窗
     （Tour 的人群是 General / MTLV，`group_filter` 传 `general` / `mtlv`，要给群发弹窗加这种模式）。
   - 列顺序偏好 `tour_col_order` 存的是**列序号数组**（"0".."16"），不是列名；要和旧页面互通就得按旧页面 17 列的顺序换算。
   - 旧页面 bug 记录在案（日期按 UTC、改状态后产品按钮错亮、群发不检查错误等），做的时候一起修。
2. 其余已有接口的页面：broadcasting_log、bug_reports、ops_summary、order_log、sales_report、
   settings_hr、task_board、template_settings、orders

## 切换前检查清单

Annie 2026-10-03 定：**全部页面做完才一次性切换**，在这之前员工继续用旧后台，ops 页面只用于验收
（连的是生产后端，发送页点了就真发）。切换前逐项确认：

- [ ] 「待做」里的页面全部验收通过、已合进 main。
- [ ] 登录回跳已由后端完成（见「需要后端」），线上在 confirm 登录后能回到原来的 ops 页面。
- [ ] ops 站内不再有链到旧后台的链接（dashboard 快捷卡、消息卡片等，搜 `legacyUrl`）。
- [ ] 旧后台页面怎么处理（跳到 ops 对应页 / 保留只读 / 下线）由 Annie 定，后端窗口做。
- [ ] 通知员工改用 `ops.nationalparkexpress.com`，并定好切换日期；切换当天避免新旧两边各发一次。

## 不迁移

- Manifests（等 A1）
- 3 个 Utilities 页
- coming-soon
- Test Orders（等 E1）

## 需要后端

由 Annie 转给后端窗口。

- Send Log 日期范围：`GET /api/notifications/send-log` 支持 `date_from` / `date_to`（按洛杉矶日期），
  导出同样支持。有了之后前端加回 This Week / This Month / Custom。
- Send Log MTLV：`GET /api/notifications/send-log` 每行返回 `mtlv_eligible`，支持按它筛选，
  `stats` 里加 `mtlv` 计数。有了之后前端加回 MTLV 卡片和列。

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
- 门票 tracking 页的列设置想跟着账号走的话，后端白名单（`app/services/user_prefs.py` 的 `ALLOWED_PREF_KEYS`）
  要加 `tickets_col_order`；现在只存本浏览器（同旧页面），不急。

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

- 后端窗口正在修改 HR、排单、司机相关接口。做到 `settings_hr` 页时，以它改完后的接口为准，
  开工前重新看后端规则文档第五节。
