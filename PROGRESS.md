# 前端迁移进度

> 每完成一步就更新本文件。新开窗口先读 [CLAUDE.md](CLAUDE.md)，再读本文件。

## 已完成

### Forecast 手机版（2026-10-17，Annie 看 preview 回「可以」）

- 只在手机宽度（≤639px）生效，电脑版不变。页头只留「7 Days Forecast」，右上角一个 Refresh（就是 Antelope seats 那个 Refresh，手机上绝对定位到标题右边，「Antelope seats: updated …」那行文字手机上收起；第一版误加了第二个 Refresh，Annie 指出后删了），下面是颜色说明、直接是表格；Color totals / Hide rows / Full screen / Updated by 手机上收起。
- 分项行名手机上 10px 一行放下。Antelope 的分项顺序（Annie 2026-10-17，电脑 / 手机都生效）固定成 Upper / Lower / X / VIP Lower / Secret / Outbound / Inbound（`antelopeRank`，按名字关键字 / kind 排；不认识的如 BUS TOUR 排最前）。第一版只在手机宽度排、又按 `Outbound` 全名匹配，对不上真数据的 `Outbound shuttle`，Annie 指出后改。别的团不动。
- 固定的左列右边、日期行下边加亮线（inset box-shadow，粘住不随滚动消失）。
- 亮框跟着屏幕走（`useLeadColumn`）：永远套住挨着固定列的那一列，往左右滑换列，滑动停在整列上（scroll-snap）；今天那列手机上不再画蓝框，保留 Today 标签。打开时今天那列靠左，昨天在左边往左滑能看到（没有删昨天）。
- 修（Annie 2026-10-17 截图）：电脑宽度「Private tours (CHD#, pax, tour, pick-up place & time)」行名在首列里折行，不再跨进日期列（该行首列去掉 nowrap）；fc 140 / 140。
- 检查：fc **137 / 137**（含新增 6 项手机检查，已合最新 main 的 Antelope 快照 / 列细线）；tsc / eslint 通过。没有在真手机上滑过，用 headless Chrome 400px 宽模拟滚动。

### G82 Private 排车按订单分卡（`task/private-orders`，后端 main 9857c15（v101 Annie 已执行）已上线，2026-10-16 合 main）

- 状态（2026-10-16，e3 接手 0e）：代码在 `components/dispatch/private-orders.tsx` / `dispatch-view.tsx` / `vehicle-row.tsx` / `lib/dispatch-api.ts` / `types/dispatch.ts`。
  按后端草稿 `docs/g82-private-dispatch/plan.md`「给 ops 的接口形状」做：`GET /api/dispatch/day` 的 `private_orders[]`、行上 `order_number` / `order_number_set_by_staff`、`POST /api/dispatch/private-match`。
  后端没上线（回包里没有 `private_orders`）时页面照旧：Private Tour 一张卡、不发 private-match、保存不带这两个键。
- 检查：tsc / eslint / build 通过；`da` **247 / 247**（修了 da-test 的 + Add vehicle 一步：上一步保存重读没完时按钮是关着的，先等它可点）；`mf` 76 / 76。
- Preview（https://claude.ai/artifact/Ss58S8G2gpmrHkLY4n2XX6）已给看，2026-10-16 回复「可以」，样子按预览。合 main 前验证：①对着后端 main 的 `tour_manifest.private_orders()` / `private_match()` / 路由代码核对字段与类型，一致（`pickup_time` 等空时是空串，页面按空处理；`private-match` 返回 `matches` / `unmatched_orders`）；②合并最新 main 后 tsc / eslint / da 247 / mf 76 重跑通过。
  ⚠️ 没有连真实后端点过：本机没有 confirm 登录会话（cookie 在 confirm 域），页面没法在本机读生产。上线后请 Annie 在线上 ops 打开一个有 Private 订单的日子验收：卡片和订单对得上、保存后刷新订单号还在（漏送会被整天覆盖冲掉）；只动 `ZZ Test`。

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

> ✅ **2026-10-17（主窗口 c6 核对后合 main 上线）`task/farm-out-5b`：Farm out（G40，转单）ops 前端，已对着后端上线的真代码核对、headless 检查全过，已合 main。** 下面到「主窗口 c6 核对」那条之前是 5b（原 fe）窗口做的记录，照后端**草稿**起步、后来对齐到后端上线后的真代码；主窗口只做了核对 + 跑检查 + 合并，没有改业务逻辑。
> - **Dispatch**（`components/dispatch/farm-out-*.tsx`、`use-farm-out.ts`）：巴士团**第二台车**右上白底 ⇄ Farm out 键（第一台、第三台起没有；一家合作公司都没有时不出现）；点了变灰蓝（`#475569`，Annie 10-15 定）Farm out 车——无司机 / 车 / 导游 / 酒店，保存不再报「没司机」，只有一家公司时自动选上，多家时标 Pick a partner；选的公司在时刻表里没有这个团时写 This tour has no farm out times yet。Edit ▾ → Back to our bus（变回普通车，默认酒店带回）/ Remove。保存带 `farm_out` + `partner_id`（普通车不带字段；点了 Back to our bus 的明确送 `farm_out:false`）。`hasDriver` 把 Farm out 车算「有」，`isAutoWindow` / `notNeededRows` 不碰 Farm out 车。
> - **车下名单**（`farm-out-guests.tsx`）：默认收起「N orders · N guests · Farm out · N notices sent」；展开是表：OTA 确认号（没有就订单号）、成人/儿童/婴儿、每单选酒店（这家公司自己的上车点）、集合 / 发车时间（改过的蓝边）、应付（改过的蓝边 + 谁何时改）、Bus 下拉（这台车写 Farm out）。改了就 `PATCH /api/farm-out/orders/<单号>?date=`（时间 / 金额打错不发请求、框标红）。没选酒店的单：下拉黄虚线 + 红字 choose a pick-up hotel before sending，block 上标 Needs hotel for N orders。已发过通知的单挪回我们的车：黄条 already received a farm out notice … Nothing was re-sent（系统不补发）。
> - **发通知弹窗**（`farm-out-notice-dialog.tsx`）：用全站统一的发送格式 `components/tickets-send/legacy-ui`（淡黄已发行 + Sent by、红行缺酒店不能勾、Send anyway、进度条、结果数字）；SMS+Email / SMS only / Email only；每批 10 单，某一批出错就停并写明哪些可能已发、去 Send Log 核对。右边是通知原文预览。
> - **Settings**（`components/farm-out/`）：Farm out Partners（合作公司、每个团的成人 / 儿童价、这家公司自己的上车点）、Farm out Timetable（每家一张表、CSV 下载、CSV/xlsx 上传 → 先列变化再 Apply；预计返回时间 / PLEASE NOTE 按团）；侧栏 Settings 组加这两项、Operations 组加 Farm out Report（`/farm-out-report`，日期范围 + 公司筛、Export CSV、改过的应付带 ✎）。**Content Studio** 加 Farm out Notice 模块（Email | SMS，Default + 每家公司，键 `tmpl__farmout__<slug>__email_subject/email_body/sms_body`，Copy from Default，SMS 沿用 300 字 / GSM 限制）。
> - **查单两套资料**（`farm-out-view-card.tsx`，订单详情 `/orders/<号>`、顶栏订单搜索浮窗、Tour Tracking 行展开）：有 `farm_out_view` 才显示，哪套在上面听后端的 `lead_with`，永远不写合作公司名。
> - **Morning Pickup 发送页**：预览返回 `farm_out_excluded_count > 0` 时在上面写一句 N farmed-out guests are left out。
> - **⚠️ 和后端草稿对不上 / 我的假设（后端定稿要核对）**：① 草稿写 `PATCH /api/dispatch`、`POST /api/dispatch/seating`，现有接口是 `POST /api/dispatch/day`（整天覆盖）、`/api/dispatch/seating/move`，我按现有的接，把 `farm_out` / `partner_id` 放进每台车；② seating 的 bus 是否带 `farm_out`：草稿没写，页面按已保存排车的 farm_out 补；③ 早班短信排除数草稿写在 `GET /api/morning-pickup/send-list`，ops 实际走上传预览接口，我放在预览返回的 `farm_out_excluded_count`；④ 报表 JSON 行形状草稿只列了列名，`lib/farm-out-api.ts` / `components/farm-out-report/report-rows.ts` 里是我猜的；⑤ 草稿没有「发通知前读电话 / 邮箱」，发送弹窗没有 Phone / Email 列；⑥ Issues 栏没加「Farm out 订单没选酒店 / 没发通知」（要读 seating，另做）。
> - **没做**：relay 司机页 Farm out 栏（后端页面）；电话 AI（后端）。
> - 检查：tsc / eslint / `next build` 通过；headless（模拟接口，端口用 3298 / 8899，3198 被别的窗口占着；node_modules 是 junction，Turbopack 认不了，用 `next dev`（webpack））：`fod` **32/32**（新：Farm out 键 / 存 / 名单 / 改时间金额酒店 / 发通知 / 重发 / 出错停 / 撤销提醒）、`da` **231/231**、`fo-settings` **66/66**、`fr` **18/18**、`cs` **63/63**、`orders` **26/26**、`nav` **29/29**；`dr` 有一处跟这次无关的 Dashboard 区块顺序检查报错（Today’s tasks，另一条线的改动），Operations 顺序那条已改成含 farm_out_report。Tour Tracking 展开和搜索浮窗两处只过了类型检查，没有 headless。
> - 套件改动：`da-test` / `cs-test` / `fr-test` / `nav-test` / `dr-test` / `orders-test` 的网址、端口、Chrome profile 现在可用环境变量改（`APP_URL` / `MOCK_URL` / `CDP_PORT` / `CHROME_PROFILE` / `MOCK_PORT`），默认值不变；`fod` 是 Dispatch Farm out 专用（mock 就是 da-mock，开 `ctl.farmOut` 才有 `/api/farm-out/*`）。
> - **2026-10-16 夜追加（对齐后端 97 更新后的接口）**：按 `origin/task/farm-out` 的 `docs/interfaces/farm-out-2026-10-16.md` 第三版改过——seating bus 的 `capacity` 可为 null（Farm out 车不限座，显示 N guests）、订单加 `guest_paid`、tour 加 `pax_ours` / `pax_farm_out`（Step 2 卡片写 `10 pax (3 ours · 7 Farm out)`）、`PATCH /api/farm-out/orders/<单号>?date=&manifest_id=`、通知 preview / send 的 body 改成 `{date, orders:[{manifest_id, order_number}], channel, send_anyway}`、点 Farm out 时没有车字母就自动选第一个空闲字母。97 确认：报表行键就是 `lib/farm-out-api.ts` 里猜的那些（加 `status`）、早班排除数在 `POST /api/notifications/morning-pickup/preview` 的 `farm_out_excluded_count`。已合最新 main（含 G82），`da` **247/247**、`fod` **34/34**、`fo-settings` 66、`fr` 18、`cs` 63、`orders` 26、`nav` 29（用 `next build` + `next start` 跑；webpack `next dev` 会因为 Chrome profile / 输出文件写在仓库里不停重编译，检查全抖，别用；`CHROME_PROFILE_DIR` 环境变量可把 Chrome profile 放到仓库外）。**主窗口 98 要求：后端真接口上线前不合 main，上线后连真接口只动 ZZ Test 验证再合。**
> - **与旧分支 origin/task/farm-out（8c 窗口）对过**（2026-10-16；以我们这条为底，没 import 旧文件，没改接口名，没 commit）：
>   - **从旧分支搬过来的**：① Settings → Farm out Partners / Timetable 两页各加蓝色 How to use 条（`LegacyHowTo`，同其它 Settings 页，文字按我们现在的操作写：Save rates / Save locations / Rename / Deactivate；上传先出 diff 再 Apply）；② Content Studio Farm out Notice 预览：`fillFarmOut`（`fields.ts`）一行里的变量全空就整行不显示（任务包「PLEASE NOTE 空着整段不显示」，旧分支的 `renderFarmoutTemplate`）。
>   - **旧分支有、我们不用搬的**：`GET /api/settings/farm-out/tours`（Edit 列全部团）——我们的 `GET /partners/<id>/rates` 本来就是「每个团一行、没设价是 null」，Edit 展开已列全部团，不需要这个接口；Same as Default 判定（我们用药丸上的 `· same as Default` + Copy from Default，已有）；发送弹窗 / 车下名单 / 报表旧分支都是更早的 mock 形状，我们这边功能更全（OTA 号、成人/儿童/婴儿、逐单改、分批发送、出错停、撤销提醒等），没有可搬的。
>   - **按 Annie 预览定下来的**：第二台车才有 Farm out 键、公司在 Farm out 车上选一次、车色灰蓝 #475569 不用紫、蓝键只用于提交（Send / Save / Apply）、发送弹窗用 `tickets-send/legacy-ui` 统一格式——我们这边都已照做，旧分支的 slate 发送键（灰蓝 Send 键）不采用，因为预览里 Send 是蓝键。
>   - **还没定、等 Annie 的差异（我们先保持不变）**：① Farm out 车左边那格：我们是实心 #475569 + 白字、车身浅灰蓝；旧分支是浅灰蓝底 + #475569 字（更接近预览里淡紫那版换色）。② Content Studio 模块卡片主色：我们沿用预览里的紫 #a78bfa（版本药丸沿用站内棕 #915a1e，同预览）；旧分支改成 #475569。预览里 Annie 只定了「车」的颜色。③ 发送弹窗表头底色：我们是蓝（`previewHeaderClass("blue")`，进度条也蓝）；预览是淡紫 #EDE7F9；旧分支是灰蓝 slate。④ Settings → Farm out Partners 列表：预览是「公司 × 团」逐行显示成人/儿童价 + Edit/Delete + 表头 + Add partner 键；我们是公司一行（Active/Inactive、Edit / Rename / Deactivate）、价格点 Edit 才展开（后端是停用不是删除；列表里要不要再显示价格要 Annie 定）。⑤ 预览里「无时刻表的团」是 Farm out 键整个灰掉；我们因为时刻表按公司分，选了公司以后才在车上写 This tour has no farm out times yet。⑥ 预览发送窗里有 Phone / Email 两列，后端第三版只给 `has_phone` / `has_email`，我们没画这两列。
>   - 这次只动了 `components/farm-out/{partners-view,timetable-view}.tsx` 和 `components/content-studio/fields.ts`；`tsc` / 这三个文件的 `eslint` 通过；headless 套件（fod / fo-settings / fr / cs）没跑（只加了 How to use 条和一个预览函数，套件里没有对应选择器），由主窗口统一跑。
> - **等**：Annie 同意合 main（页面看得见的只有侧栏新增的三项和 Settings 里的页面，后端没上线时显示「还没上线」）→ 后端定稿后核对字段名 → 用 ZZ Test 单走一遍（选酒店、发通知只发给 Annie 自己）。
> - **对着后端真代码核对（2026-10-17）**：后端 Farm out 已上线，按 `app/routers/farm_out.py` / `farm_out_settings.py`、`app/services/farm_out_*.py`、`dispatch.py`、`tour_manifest.py`（seating_view / move_guests）、`notifications.py`（早班预览）和文档第八节逐项对过。**没有连任何真后端 / 生产数据**，只对着后端代码 + 模拟接口套件核对（同 G82 的做法）。
>   - **对不上、已改**：① 所有保存接口返回 `{ok, <键>: ...}`（`partner` / `rates` / `locations` / `timetable` / `items`），不是裸数据——`lib/farm-out-api.ts` 全部拆开（之前保存后页面会拿到 `{ok:true,…}` 当数据，列表会坏）；② `PATCH /orders/{单号}` 返回 `{ok, farm_out:{…, missing:[…]}}`——`patchFarmOutOrder` 拆出来（类型 `FarmOutOrderPatched`）；③ 时刻表 `hotels[]` 只有 `{id, hotel_name}`（没有 `spot`），parse 返回里新酒店 `id: null`、格子 key 是 `new<序号>_<团>`（之前上传预览里新酒店格子全空、React key 重复）——`timetable-view.tsx` UploadBox 修；④ 通知 send 返回多了 `blocked`（整单没发：缺资料 / 短信超长 / 特殊字符）和 `skipped_sent`（已发过又没勾 Send anyway），结果里没发的渠道状态是 `null`（原来 `/fail/i.test(null)` 会崩）、成功是 `sent:<sid>`、有 `log_failed`——发送弹窗结果表现在列出每个没发的单和原因，统计多一格 Not sent，用后端的 sent / failed 数，`log_failed` 单独黄框提醒；⑤ 通知 preview 多 `already_sent`（send_log 为准，重新转单后 `notice_sent_at` 会被清掉但 send_log 还在）——弹窗「已发过」现在两处都认；preview 的 `missing` 是 "pick-up location" / "departure time (…)"，弹窗前面补 Missing；⑥ `seating/move` 返回 `farm_out:{farmed,revoked,already_notified}`——撤销提醒改用后端的 `already_notified`（支持一次多单，没有 farm_out 字段才退回页面自己的判断）；⑦ `POST /dispatch/day` 返回 `farm_out:{revoked,already_notified}`——有已通知的撤销单时存完后出一行黄字（不补发）；`/dispatch/copy` 返回 `dropped_farm_out`——照抄后写「N farm out car(s) were not copied」；⑧ 报表行有 `status: "gone_after_farm_out"`——`report-rows.ts` 读、报表在单号下写 Cancelled or changed after farm out（红小字）；⑨ 早班预览：`farm_out_excluded_count` / `farm_out_excluded` 确认是顶层键；整份文件的订单都被排除时，原来提示「No bookings found」，现在说明都已转单、收转单通知；⑩ 类型补：`FarmOutOrder.partner_name` / `hotel_name`，`SeatingBus.partner_id`，`DispatchSaveResult.farm_out`，`DispatchCopyResult.dropped_farm_out`，`SeatingMoveResult`。
>   - **核对后一致、没改**：路径 / HTTP 方法 / query（`date` + `manifest_id`）/ 通知 body（`date, orders[{manifest_id,order_number}], channel, send_anyway`）/ 报表参数（`from,to,partner_id,format`）/ 时刻表 PUT body（只读 `cells`）/ apply body（`{parsed}`）/ 早班排除；Dispatch 保存的 `farm_out` + `partner_id` 行校验（Farm out 行不带司机 / 车 / 导游 / 团名，需要字母）；`GET /dispatch/day` 行的 `farm_out/partner_id/partner_name`；seating 的 `pax_ours/pax_farm_out`、Farm out 车 `capacity:null`；时间 `"HH:MM"`（PATCH 也收 `6:50 AM`）；Content Studio 模板键 `tmpl__farmout__<slug>__{email_subject,email_body,sms_body}` 和 11 个占位符与后端 `farm_out_notice.py` 一致，`/api/template-settings` 是 `tmpl__%` 前缀通用列出、只能改已存在的键（不 upsert，404 Settings key not seeded），后端建号时复制 Default 三条，所以新合作公司的键本来就在。
>   - **PATCH 传 null = 交回自动**：Dispatch 名单里 staff 改过的时间 / 应付格（蓝边），把框清空失焦就发 `null`（鼠标悬停提示 Clear the box to go back to automatic）；没改过的格子清空仍然恢复原值。没有加新按钮，版式没变。
>   - **空状态（上线后 admin 还没建数据）**：合作公司为空——Partners 页「No partners yet.」、Timetable 页「No partners yet. Add one in Settings → Farm out Partners.」、Farm out 车上选公司处写 No partners yet. An admin adds them…；公司没有上车点——Timetable「This partner has no pick-up locations yet」、Dispatch 名单底部黄字；结算价全 null——Partners 里是「not set」占位符，Dispatch 名单底部黄字 Payable is not set for N orders；tour-meta 为空——Timetable 页「No tours yet.」，通知里空返回时间 / PLEASE NOTE 由后端处理；公司没有这个团的时刻表——车上黄字 This tour has no farm out times yet。以上都是安静的提示，不是错误条、不会崩。
>   - **还没核实 / 需要决定**：① 🔴 后端 `GET /partners/{id}/locations` 和 `/timetable` 是 **admin 专用**（文档说 staff 只给 partners 和 tour-meta），所以**非 admin 的 staff 在 Dispatch 里选不了 pick-up hotel**（下拉是空的，页面只写一句「hotel list could not be loaded」）——要么后端把 GET locations 开给 staff，要么另给一个 staff 能读的接口；这是后端的活，待 Annie 转给后端；② Seat guests 目前一次只能拖一张订单，后端已支持一次挪整个 section 的多张订单（上限 500 行）和「全成全败」，前端没做「全选 section」；③ 订单搜索 / 详情 / Tour Tracking 的 `farm_out_view`（文档第九节）后端还没做（G91）；④ 报表 / 通知 / 发送的真实行为（短信超长 blocked、day_lock 忙时的 400 文案等）只对着代码读过，没有真跑；⑤ 报表日期选择器不能选今天以后（已有行为），转单是未来日期时看不到。
>   - 检查：`tsc --noEmit` 过；eslint 无错误（`farm-out-notice-dialog.tsx` 一条旧的 exhaustive-deps 警告，不是这次加的）。套件（`fod` / `da` / `fo-settings` / `fr` / `cs`）的模拟接口和断言已改成真实形状（`da-mock.js` farm-out 段、`fo-settings-mock.js`、`fod-test.js`、`fo-settings-test.js`），**还没跑**，由主窗口跑。
>
> - **主窗口 c6 核对（2026-10-17）**：合最新 main 后 `tsc` / eslint / `next build` 通过；跑了 `fod` **34/34**、`da` **247/247**、`fo-settings` **66/66**、`fr` **18/18**、`cs` **64/64**、`nav` **29/29**、`orders` **26/26**、`fc` **140/140**；另外跑了没有 farm-out 专项断言但代码被这次改动碰到的三套确认没回归：`os`（顶栏订单搜索浮窗）**68/68**、`mt`（Morning 发送 / 追踪）**174/174**、`tt`（Tour Tracking）**111/111**。
>   - **修了一个测试脚本自己的 bug**：`fo-settings-mock.js` / `fo-settings-test.js` 默认端口是 3211 / 8811，和全套统一的 3198 / 8799（`run-all.js` 只起这一组）不一致，导致 `run-all.js` 跑这套时测试连不上服务，直接超时失败——不是业务代码问题。已把两个文件的默认端口改成 3198 / 8799（仍可用环境变量覆盖）；顺手把硬编码的 Chrome profile 目录 `fo-prof-tmp` 也改成可用 `CHROME_PROFILE_DIR` 覆盖，并把 `checks/headless/*-prof-tmp/` 加进 `.gitignore`（之前这个目录被当成普通文件生成在仓库里，103MB，已删除未提交）。
>   - **`dr` 这一套本来就是坏的，和这次改动无关**：查过 main 本身（farm-out-5b 合并前）就已经这样——`checks/headless/dr-test.js` 还在断言 Dashboard 上有一个 aria-label="Today's tasks" 的占位块（文字「Coming in a later phase」），但 Daily Tasks 任务框（`task/daily-tasks-page`，另一条线，已先合 main）上线以后，这块在没有真后端时是**直接不渲染**（`TasksSection` 404 时返回 `null`，`components/tasks/tasks-section.tsx:103`），`dr-mock.js` 也从来没 mock 过 `/api/tasks/today`。这是两条线各自改完、互相没对齐留下的检查缺口，不是 farm-out 引入的，这次不处理，另记一条「需要修的检查缺口」。
>   - 没有连真实后端 / 生产数据，和 5b 窗口做法一致，只对模拟接口验证。
>   - 还欠着的两条（见上面「还没核实 / 需要决定」①③）已原样转给后端主窗口 `npe-confirmation-service-c9`：① `GET /partners/{id}/locations`、`/timetable` 现在是 admin-only，staff 在 Dispatch 里选不了 pick-up hotel；② 查单 / 详情 / Tour Tracking 的 `farm_out_view`（G91）还没做。
>   - 上线后 Annie 要做的事：见本条上面「检查」之前几行列的「空状态」——admin 先在 Settings 建合作公司、结算价、上车点、时刻表（返回时间 / PLEASE NOTE）；然后用 ZZ Test 单走一遍 Dispatch 第二台车选 Farm out → 填酒店 → 发通知（只发给 Annie 自己）。

> ✅ **2026-10-17（98 窗口）`task/ticket-purple`：Ticket 相关的紫色统一成 `#6d5bd0`，票的图标换成浅灰线条，Annie 看过预览（选 D、图标浅灰）「动手」，已合 main 上线。** 预览 https://claude.ai/artifact/Ew212npTZ1pLjyd13hF8HM
> - 改了：侧栏 Ticket Reminder 的点（`nav-config.ts`）、Dashboard 快捷卡和消息卡的 Tickets 色（`dashboard/config.ts` `LANE_ACCENT.tickets`、`quick-cards.tsx`）、Ticket Reminder 发送页的 Tracking 键和模式标签（`tickets-send-view.tsx`、`legacy-ui.tsx`，原来是 `#6B4FBB`）、Content Studio 的 Tickets Reminder 卡片强调色（`content-studio-view.tsx`）。
> - Content Studio 卡片上红色的 🎟️ 表情符号换成线条 SVG（`TicketIcon`，`#cbd5e1`）；`icon` 字段类型改成 `ReactNode`。别处的 🎟️（发送页 Step 1 标题、Tour Tracking 的 Tickets 列）没动，Annie 没提。
> - **Farm out Notice 卡片的紫色改白色**（边框 / 标签 / 图标）**在 5b 的 `task/farm-out-5b` 里做**（那张卡片还不在 main 上）；它和这次改的是同一个文件，5b 合 main 前先合最新 main，注意 `MODULES` 里 `icon` 现在是 ReactNode。
> - 检查：tsc / eslint / build 过；`cs` **50 / 50**（加 1 项）、`nav` 29 / 29、`tsend` 43 / 43。Dashboard 的颜色没有自动检查，目测。

> ✅ **2026-10-17 凌晨（98 窗口）`task/antelope-seats`（第二批）：Forecast 居中 + 每列细线 + Antelope「销售 / 剩余」+ Session 行 + Notes 行名，Annie 看过预览第 6 版「好了，就这样」，已合 main 上线。** 预览 https://claude.ai/artifact/YcGUhmDSL22VJudSgQCzkE 。取代上一条（`121bd65`）里的「Seats left 三行」做法。
> - **居中 + 每列细线**：除了最左边一列，日期表头、人数、分项、Driver / Guide（`crew-cell.tsx` 按钮也居中）、手写格、Session 全部居中；日期列左边一条淡竖线（`styles.ts` `colLine()`），今天那一列左右蓝线（`TODAY_COL`）。
> - **Antelope 销售 / 剩余**：Upper / Lower / X 三个分项行，格子写 `12 / 18`（`SoldAvail`）：销售数照常（0 变小），剩余带颜色（0 红、1–`low_max` 黄、其余浅蓝，数字一样大）；Rezdy 没有那一场写灰色 `No data`、没拉过写 `Not synced`（鼠标移上去有原因）。行名后面小字 `Sold / Avail`（Avail 浅蓝）。
> - **Session 行**取代 Seats left：最左边只写 `Session`；格子里每天三行 `U 12:40p / L 1p / X 12:20p`（`SessionCell`，取 `allotments[].time[当天]`，日期段优先，所以冬季 11/2 起 X 改 1p 要在 Products 的日期段里设好才会显示；没有就退回平常时间）。不能点（每天上限 / 时间的编辑在这个模式下去掉，别的块照旧）。
> - **Notes**：「Notes / Number of vehicles booked」行名改成 `Notes`（`config.ts`、How to use、`fc` 检查跟着改）。
> - 检查：tsc / eslint / build 过；`fc` **130 / 130**（canyon 那一段重写：销售 / 剩余各状态、颜色和字号、Session 时间含某天 11a、居中、每列细线、Notes、Refresh 成功 / 失败、快照表空）。
> - ⚠️ 未动：Products → Bus Manifest setup 第 10 项的上限数字和「点格子改每天上限」还在（Antelope 这一行已经不显示上限数字）；等 Annie 说拆再拆。

> ✅ **2026-10-16 夜（98 窗口）`task/antelope-seats`：Forecast 里 Antelope 的剩余座位接后端快照（canyon-availability-sync，后端 main `bbff78d`，v102 Annie 已执行），Annie 看过预览第 8 版「动手」，已合 main 上线。** 预览 https://claude.ai/artifact/Y9rRUfCUTo3uN41gAYWVAu 。接口文档在后端 `docs/interfaces/canyon-availability-snapshot-2026-10-16.md`。
> - 接口：`GET /api/forecast/canyon-availability`（只读快照，随页面加载调，不触发 Rezdy）、`POST …/refresh`（向 Rezdy 重拉，返回新快照；5 秒内重复点后端合并；失败 400 detail 原话）。`lib/forecast-api.ts`、`types/forecast.ts`（`CanyonSnapshot`）。
> - 页面（`components/forecast/canyon.ts` 算法、`forecast-grid.tsx` 的 `SeatsLeftCell`）：Antelope 块里原来的 Max allotments 行改叫 **Seats left**；最左边只留 U / L / X 和原来的时间（上限数字不写）；格子里每档一行，**估算 = min(max(0, A0 −（现在销售数 − S0）), 总容量)**，现在销售数取 60-day 里同一行同一天的值；0 红、1–`low_max`（后端给，现 5）黄、其余浅蓝，数字一样大（0 也不变小）；拉过但没有 05:15 场次 ⇒ `No data`（不是 0）；这天没拉过 ⇒ `Not synced yet`。格子里的三行和最左边的 U / L / X 一行对一行（标题占 `h-4`，格子里先空一行）。
> - 页头条（`data-canyon-bar`）：「Antelope seats: updated 时间(LA) · estimate」+ **Refresh** 键；快照表空时写 not synced yet；刷新失败后端原话显示在条上、旧数字保留。点 Refresh 成功后顺带重拉 60-day。**页面打开不触发 Rezdy，也不定时自动刷新**（Annie：5 点后端自动拉、变红后端自己重拉）。
> - 快照接口 404 / 读失败 ⇒ 页面照旧显示 Max allotments（`blockHasCanyon` 为 false）。快照表现在是空的 ⇒ 每格 Not synced yet，**请 Annie 点一次 Refresh 首次填充**（或等明早 5:00）。
> - ⚠️ 这一行不再能点格子改每天上限（只在 Seats left 模式的块；别的有上限的块照旧）。Products → Bus Manifest setup 第 10 项（Max allotments）**还没动**：预览里写了「Antelope 不再用上限数字，一起去掉」，但只改了 Forecast 页，Products 页的第 10 项和每天上限编辑没拆，等 Annie 说拆再拆（拆之前它们设的上限对 Antelope 这一行没有显示效果，只有时间还在用）。
> - 检查：tsc / eslint / build 过；`fc` **126 / 126**（加 14 项：404 时照旧、状态条、最左边 Seats left、联动估算 / 总容量夹住 / 0 红 / No data / Not synced yet、颜色、三行对齐、不能点、Refresh 成功 / 失败、快照表空）。mock：`fc-mock.js` 的 `ctl.canyon`（空 = 404 / live / never）、`canyonRefreshFail`。
> - **等 Annie 线上验收**：先点一次 Refresh 填快照，看 Antelope 三行和 Rezdy 对不对；没有 05:15 场次的日子显示 No data 不是 0。

> ✅ **2026-10-16 夜（98 窗口）`task/reset-password`：Settings → Users 加 Reset password 按钮，Annie 看过预览说「可以」，后端 `c1ae99c` 已上线，已合 main 上线。** 预览 https://claude.ai/artifact/4XuVQYqkkeyVr5Zf3Tef9Y
> - 接口：`POST /api/users/{id}/reset-link` ⇒ `{ok, reset_url, reset_token}`（`lib/users-api.ts` `createResetLink`），只有 admin；链接只返回这一次、24 小时一次性、新链接让旧的作废。400 原话：`Cannot generate a reset link for your own account` / `Cannot reset a superadmin account's password` / `Cannot generate a reset link for an inactive account`；404 `User not found`。
> - 页面（`components/users/reset-link-dialog.tsx`）：每行一个 Reset password 键（待注册行没有）；自己、superadmin、已停用的灰掉，鼠标移上去写上面的原话。点了先确认（Create link），再显示链接 + Copy link + 「只显示这一次」黄框；复制不了时链接已全选可 Ctrl+C；关掉就没了，重开又从确认开始；出错原话留在确认框里。How to use 加一条。
> - 链接用 ops 自己的网址拼（`buildResetUrl`，同邀请链接的做法：`/reset-password/<token>` 经 fallback 转后端模板页），不用后端返回的 `reset_url`（经代理时主机名是代理目标）。staff 打开的重置页是后端模板，ops 没做。旧后台 Users 页不加。
> - 检查：tsc / eslint / build 过；`users` **53 / 53**（加 11 项：各种灰掉的行和原话、先确认再请求、出错留在框里、链接用 ops 网址、复制、关掉再开不显示旧链接）；mock 的 `reset=1` 现在连 reset-link 计数和日志一起清。
> - **等 Annie 线上验收**：用 ZZ Test 开头的账号点一次，把链接发给自己测一遍重置页。

> ✅ **2026-10-16 夜（98 窗口，原 73）`task/forecast-style`：7 Days Forecast 页样式调整，Annie 看过预览第 8 版「动手」，已合 main 上线。** 预览 https://claude.ai/artifact/Y9rRUfCUTo3uN41gAYWVAu
> - **日期行固定**：往下滚时只有日期那一行停在顶栏正下方（页头文字不固定）。表在 `overflow-x:auto` 容器里，CSS `sticky top` 对整页滚动不起作用，所以 `forecast-grid.tsx` 的 `useStickyDateRow` 在页面滚动时用 transform 把日期行往下推到 `[data-app-topbar]`（`components/nav/app-frame.tsx` 加的属性）底边，推不出表底。
> - **0 变小**：人数行、分项行里的 0 用 `Num`（`data-zero`，10px、不加粗、半透明白）。剩余座位格子里的 0 不变（Annie：三个数字一样大，靠红 / 黄 / 浅蓝分）。
> - **灰字改白**：`components/forecast/` 里 `text-white/NN` 全部改 `text-white`（弹窗里输入框的 placeholder 等没动）；团名（粗体行第一格）黄色 `#facc15`。
> - **今天那一列**：左右两条竖线，用边框 `TODAY_COL`（`styles.ts`），不再用 ring（ring 把每格框成一圈）。
> - 检查：tsc / eslint / build 过；`fc` **112 / 112**（加 8 项：团名黄色、0 变小、今天竖线、行名纯白、滚 700 后日期行在顶栏正下方且页头文字没固定、滚回原位）。
> - **没做**（等后端上线）：Antelope 剩余座位那一行（Rezdy 快照，GET /api/forecast/canyon-availability 读快照 + POST …/refresh；预览同上；格子里 U / L / X 三行要和左边三行一一对齐、数字一样大）。

> ✅ **2026-10-16 晚（c7 / 原 0e）`task/remove-live-link`：去掉 7 Days Forecast 的 Day Tour Live Link（Annie：「Live Link 撤销、不需要了」，前后端都删）。** 后端 `55eb308` 已先推 main：60-day 没有顶层 `live_link`，`PUT /cells` 传 `live_link` 回 400 `That row cannot be edited here`。页头 Live Link 行 + Edit 框、类型里的 `live_link` / `row_key: "live_link"`、How to use 里那一句都去掉；**Updated by 保留**（最后改手写格子的人，有 `updated_by` 就显示，不再依赖 `live_link` 字段）。`fc` 104 / 104（删 Live Link 的检查，mock 里 live_link 回 400 像真后端）。

> ✅ **2026-10-16 晚（0e 窗口）`task/forecast-day-edits`：7 Days Forecast 表上按天改 + Action Log（后端 G81，现编号 G90；预览 https://claude.ai/artifact/VamU4XqKTCmaAUW8R2njd6 Annie 已同意）。** 后端 `task/forecast-day-edits` @ 910ee7e，v99 Annie 已在生产跑，但**后端还没上 main**（f0：Annie 跑 release.py 后发提交号）。所有新字段都是可选：后端没上线时页面和现在一样（格子不能点、没有 Action Log）。
> - 粗体人数格点开（`day-running-editor.tsx`）：Running / Not running + 原因 / Back to automatic，`PUT /api/forecast/day-running`；Max allotments 格点开（`day-allotment-editor.tsx`）：每档 Max + Time，只存改过的档，时间一起传回，有手改的档 Back to usual（`max_pax: null`）；`PUT /api/forecast/day-allotment`。过去的日子不能点，所有 staff 能改。存完整张表静默重拉。
> - 手改过的格子右上角小黄点，鼠标移上去看内容 / 谁 / 何时。CCL Discord 写了 Closed 的那天选 Running 存得进去但不生效（`overridden_by_ccl`）：框里黄条说明，格子仍是 -。
> - 表下面 Action Log（`action-log.tsx`）：默认收起，展开才拉，50 条一页新的在上、Show more（`next_cursor` 原样传回 `before`），表上存一处就刷新；后端没带 `running_meta` 时不显示。
> - ⚠️ **和预览不同（后端限制，要告诉 Annie）**：预览里 Log 记「表上所有改动」，后端这一版**只记按天改的开关团和每档上限**；手写格子（Crew notes 等）、Live Link、导游排班、Products 9–11 的改动**不在 Log 里**（后端手写格日志有意不存内容）。另外后端小黄点只给「谁 / 何时 / 现值」，没有预览里的「原来的值」，原来的值看 Log 的 From → To。
> - 检查：tsc / eslint / build 过；headless `fc` **106 / 106**（加 21 项 G81：能不能点、关一天 / 撤掉、后端拒绝原话、CCL Closed 压过手动开团、改 Lower 只发一条且带时间、Back to usual、Action Log 50 条 + Show more + 存完刷新、后端没有 G81 时照旧；改 1 项 Max allotments 格对齐检查的取元素方式）。都是模拟接口。
> - **等**：后端 main 提交号 ⇒ 请 Annie 用 ZZ Test 关一天 Antelope 再改回来、改一档上限再撤掉，看 Log。

> 🚨 **2026-10-16（8c 窗口）`task/bus-windows-seats`：按人数自动开车窗的算法 bug 修正（Annie 紧急插队，不算样子调整、不等 preview），已合 main 上线。**
> - 起因：Antelope Canyon 59 人，Bus A 选了 59 座的车号 1960，明明坐得下，旧算法只看 `guests_per_bus` 算 `ceil(59/54)=2`，一直冒出多余的 Bus B、删了还会自动补回来。
> - 新算法（`components/dispatch/bus-windows.ts` `computeNeeded()`，和后端 `-84`、main `d53c941` 对过口径一致）：
>   已排的每台车，容量 = 这台车在 Vehicles 里填的 `seats`；没选车或没填 `seats` 就退回这个团的 `guests_per_bus`。按容量从大到小累加，够了就停，**返回用了几台**（不是排了几台，比如排了 3 台、最大的 1 台单独就够，返回 1）；全部加完还不够，剩下的按 `guests_per_bus` 再 `ceil`；一台车都没排 ⇒ `ceil(pax / guests_per_bus)`（`pax=0` 时就是 0，不额外兜底成 1）。`guests_per_bus` 缺失（老接口）⇒ 照旧退回服务端给的 `needed`，不现算。
>   `notNeededRows()` 同一套算法：排了 3 台、1 台够时会有 **2 台标黄**（预期行为，不自动删、不要为了"看起来合理"改掉）。
> - **现算，不等保存 / 刷新**：`openWindows` 原来只在 `need`/`closures`/`L`/`openTick` 变了才跑，staff 换车不会触发。加了 `busCapacitySignal`（巴士团每行 `manifest_id:vehicle_id` 拼成的字符串，和备注 / 酒店等无关改动不触发）当新的依赖项，换车当下就能重算，不用等自动保存 / 刷新。`notNeededRows` 本来就在渲染时直接算，一直是实时的。
> - `types/dispatch.ts` 的 `DispatchDay.vehicles` 加 `seats: number | null`（后端今天刚加的字段，`app/services/dispatch.py:314`，没填是 null 不是 0）。
> - mock / 检查：`da-mock.js` 车辆池加 59 座的「1960」（id 13）+ 一个新日期 `2026-10-17`（59 人、Bus A 已选 1960）；`da-test.js` 加两条：① 不冒出 Bus B；② 换成没填座位数的车（退回 54 座）后 59>54，不等存立刻补开 Bus B。
>   顺手发现并修正：2026-10-09 那天 West Rim / Hoover Dam 两张卡的 `guests_per_bus` 和已存的车数算出来对不上新算法（旧算法从不校验这层关系，纯数字巧合能过），调整成 5 / 3（West Rim 9 人两台 5 座够坐；Hoover Dam 5 人两台 3 座够坐），不影响这两张卡原来测的其他行为。
> - 检查：tsc / eslint / build 通过；`da` **231 / 231**（含新增 2 项）、`mf` **76 / 76**。
> - 后端 `-84` 服务端同一条算法已上线（main `d53c941`，只反映已保存的车；前端这边独立现算，两边口径一致，互不依赖）。

> ✅ **2026-10-16（85 窗口）`task/daily-tasks-page`：Daily Tasks（任务框，Dashboard 改版任务包阶段三）页面本身，Max 看过预览批了，已合 main 上线。Checkpoint 功能不在这次范围内，还在等 Annie。**
> - 预览：https://claude.ai/artifact/58eiPdG6fnQh2hMNZwwbH9 。后端还没有这些表 / 接口，接的是 ops 自己设计的 mock（`lib/tasks-api.ts` 顶部注释写了接口草案，等后端定了要核对字段名）。
> - **员工视角**（`components/tasks/employee-view.tsx`）：只看自己的任务，按截止时间排序；一小时内到期标黄、超时标红；顶部汇总；待接受的交接单独一块（Accept，没有拒绝）；右下角提醒弹窗（D2，30 分钟前 + 到点各一次，弹窗 + 响声，响声用 Web Audio 现拼不嵌文件）。
> - **主管视角**（`components/tasks/supervisor-view.tsx`）：按岗位（Opening / Pre-closer / Closer / 全队）分组看全部任务和完成进度；截止时间可直接改；交接通知列表（每次交接都通知，D1）；Add a task 选岗位或具体某人。
> - **任务模板种子数据**：严格按 Max 提供的「最新 Work Checklist」23 条原样导入（`checks/headless/tasks-mock.js` 的 `TEMPLATES`），不编示例任务；D4 共用清单（Opening 两人都能看、记录谁勾的）；第 16、17 条 Pre-closer / Closer 按截止时间是否晚于 Pre-closer 下班分；没有固定岗位的人（如 Anita）只做主管指定的任务。
> - **Dashboard 本周排班只读小表**（`components/tasks/week-schedule-widget.tsx`，D5）：挨着任务框显示，今天那一列高亮。⚠️ 占位数据——阶段二（在线排班，d3 在做）的数据结构还没定，字段名没对过，等那边定稿了要接真数据。
> - **任务的跳转页面**（`link_href`）核过代码后按 Max 10-16 的说明定了几条：
>   - Dispatch 本身是查 CCL（Pull from Discord）、排车、打开 Tour manifest（`/dispatch/manifest`，填确认号 / 打印 / 截图发司机）这几件 closing 工作的入口，不是分散的独立页面——「Manifest」「Driver manifests SCREENSHOTS」「Print Shuttle Manifest」都指向 `/dispatch/manifest`。
>   - 「Checking last mins on Manifest」（9pm）去的是 **Main Manifest、明天的日期**（`/manifests?date=<明天>`）——核对的是明天所有团有没有都上 manifest，是跨团总览，不是 Dispatch 的单团视图。
>   - 「CCL - Bus Assignments on 7 Days」「Check which tour need to be capped」**manual，不跳转**：CCL 的页面位置还没定；封顶要去 Rezdy 调库存 / 关闭销售，不是 ops 哪个页面的事（Max 原话确认）。
>   - ⚠️ 已知局限、按 Max 定暂不处理：「Hoover Dam Dispatch」（9-10AM）实际是头一天晚上的 Closer 起头、整夜 open 到早上才收口，归属上从 Closing team 开始，不是单纯 Opening 工作——现在单日排班的 mock 模型表示不了这种跨天任务，先按 role: opening 简化处理，记在代码注释里，以后真要支持跨天任务再设计。
> - **还没做**（checkpoint 功能，Max 定要先等 Annie 看过 preview 才能写代码，这个分支没有任何 checkpoint 相关代码）：
>   系统已自动完成的任务（Next 3 days confirmation、Checking last mins on Manifest）要在目标页面加一个「check point」确认键，staff 点一下才算完成（**不是检测到后端操作完就自动打勾**，任务包 Out of Scope 第一版不做这个，已经和后端对过这条边界）；
>   Next 3 days confirmation 这条设计成 inline（不跳页，直接读 Auto Send 的运行记录），Checking last mins on Manifest 要跳 Main Manifest（明天）；
>   接口草案：`PUT /api/tasks/today/<id>/done` 加一个可选字段 `via`（`"self"` 或 `"checkpoint:<page>"`），已经非正式对齐给后端（npe-confirmation-service-92），形状没问题，等阶段三正式开工时一起做。
>   其余还没做：任务模板管理界面（新建 / 改 / 停用）、D3（下班时既没完成也没交接，通知主管）、D8（7-day forecast 每小时任务，整点重置）。
> - 检查：tsc / eslint / build 通过；headless `tasks` 套 **26/26**（覆盖员工 / 主管视角、Accept、Pass over、勾选、改截止时间、Add a task、提醒弹窗、404 后端未上线安静收起、500、401）。
> - 过程中修了两处真 bug：「now」倒计时的竞态（ref 初值用 0 而不是 `Date.now()`，首次渲染 elapsed 算成天文数字，所有任务都误判超时）；Pass over 改成接受前任务仍在交出的人名下（任务包第 21 条，原设计会立刻把任务判给接收人）。
> - **等 Annie 线上用 ZZ Test 验收**；checkpoint 功能等 Annie 看过预览点头再动手，到时候还要先跟改 `components/dispatch/**` 的窗口（8c 在做 Private Dispatch 块）核对没有冲突。

> ✅ **2026-10-16 公司（8c 窗口）`task/cs-single-back-2`：Content Studio 页「← Back」文案改成「← All modules」，已合进 main 上线。**
> - 起因：10-14 晚就留意到的「一页上有两个 ← Back」（`task/greeting-name-only` 那条待查）。查清楚了**不是真的重复**：顶栏下面导航条的 ← Back（`router.back()` / 跳 `/dashboard`）是离开整个页面；Content Studio 自己那个 `setModule(null)` 只是从某个模块收回到模块网格、人还留在页面上，两者目标不一样，功能不冲突，只是字面撞了。
> - 现在也没有别的路能在不离开页面的前提下回到模块网格（侧栏再点一次 Content Studio 不会重置已选的模块），所以直接删掉会丢功能，不是单纯去重。改成只换文字：「← Back **{模块名}**」→「← All modules」，位置 / 样式 / 行为都不变（`components/content-studio/content-studio-view.tsx`）。
> - 全站搜过一遍：这种「选了子项、面包屑写 ← Back 收回上一级」的写法只有 Content Studio 一处，别的页面的「← Back to Orders」「← Back to N matches」本来就带后缀文字、不会跟导航条撞；不用跟着改。
> - 按「只修 bug、样子不变」直接改，没走 preview；`cs-test.js` 里两处点击面包屑的选择器跟着改成找「← All modules」。
> - 检查：tsc / eslint / build 通过；`cs` **49 / 49**。

> ✅ **2026-10-16 公司（8c 窗口）`task/auto-send-split`：Settings → Auto Send 总开关拆成巴士团 / 门票各自一个（后端定稿，分支 `task/auto-send-split`，`e8063dc`，还没推 main），已合进 ops main 上线。**
> - 后端接口：`config.enabled` 没了，改成 `config.tour.enabled` / `config.tickets.enabled` 各自布尔值；其余字段不变。门票汇总邮件跟着 `tickets.enabled` 走。
> - `components/auto-send/auto-send-view.tsx`：原来页面顶部的总开关去掉，两个开关分别挪进 Tour confirmations、Ticket reminders 两张卡片的标题区（`EnabledSwitch`），样式照旧（开绿关灰，不用蓝色）、点了先确认、确认就存，和卡片下面字段的 Save 完全独立——开关存的是**当前已存的字段值**，不会把卡片里没点 Save 的草稿带上，也不会被开关的确认冲掉（字段草稿的 `savedKey` 不含 `enabled`）。
> - 每张卡自己算「下一批」（`nextRun`），不再两张卡合在一起看；Tickets 卡把汇总邮件时间也算进去、带「summary」字样区分。
> - `types/auto-send.ts`、`lib/auto-send-api.ts` 跟着改；`as-mock.js` / `as-test.js` 重写了开关相关的检查（两个开关分别测、互不影响）。
> - 这次不算新设计调整（开关位置照现有卡片的做法搬），没走 preview，按 ff 的指示直接改。
> - 检查：tsc / eslint / build 通过；`as` **67 / 67**（开着的那部分重写：两个开关各自确认 / Cancel / 400 / readable:false / 字段草稿不被冲掉 / 下一批各自算）。本机没连真实后端，接口形状按后端分支代码核对的。

> 📋 **交接给公司窗口（2026-10-16 凌晨，家里 a6；3c 已收工，Dispatch 归接手的窗口）**——下面各条细节都在本节里。
> - **等 Annie 线上验收**（只用 ZZ Test）：① Dispatch 自动保存（改一处停 3 秒看「All changes saved」；加车不选司机看底部红条）；② Transfer & Charter 报价页（先开 tcq destination）；③ Private Tour 收起；④ Dispatch Upload Rezdy CSV；⑤ 7 Days Forecast（先在 Bus Manifest setup 设 9 / 10 / 11）。Annie 还要把 Work item 前缀改成 WorkSpace。
> - **等后端，回了就做**：
>   - -ec「自动保存不放锁」⇒ `save()` 带上、`lock.forget()` 改续占、`da` 补一项（见「需要后端」G71 那条）；
>   - 4f Farm out 接口形状 ⇒ 从 main 拉 `task/farm-out`，照原 Dispatch 版式做（简化版已作废），**先给 Annie 预览**；
>   - -75 巴士团 tour type 按节存 + **Products 页也保留可设**（Annie 10-16 凌晨定，见下面 `task/auto-send` 那条的 🔁）⇒ **先给 Annie 预览**。
> - 跑 headless 前先看 8799 / 3198 有没有别的窗口占着（run-all 会用 3198 上现成的 next dev，可能是别的文件夹的代码）。家里 worktree `D:\npe-ops-frontend-ds` 已和 main 同步、干净，公司不用管它。

> ✅ **2026-10-16 公司（8c 窗口）：My Workspace → Transfer & Charter Quotation 真连生产后端走通一遍（ff 派的任务，只验证，没改代码）。**
> - 本地起后端（真实生产库，`DISABLE_SCHEDULER=1`；本机 `.env` 缺 `SESSION_SECRET` / `TOKEN_SECRET` 读不出来，临时用随机串启动，只影响本地 session 签名、不碰生产 Railway 的值，没改任何文件）+ 前端，Annie 本人用真账号登录 `localhost:8000/auth/login`、cookie 带到 `localhost:3100` 验证。
> - 确认 `tcq` 这个唯一去向已经是 `is_enabled = true`（Max 当时也截图确认过，「1 of 1 destinations on」）。
> - 粘贴一封真实的 ZZ Test 邮件（Annie 本人邮箱 / 电话，场景是「transfer for 4 guests from Las Vegas Airport to Bellagio Hotel on 11/20」），完整走了一遍：Generate → 审核页勾车型、改 Pax → Save draft → Generate quote → 生成真实报价号 **NPE-2026-0001**（$195.70）。
>   报价单预览格式完整：National Park Express 抬头、Transportation Quotation、车型明细表、Subtotal / State excise tax / Total、Inclusions / Not included / Pricing assumptions / Terms 四段——和之前 Annie 看过的样张一致。PDF 下载链接存在、点了有反应（本地解析 PDF 文件最终落地到哪一步因为系统另存为对话框没细究，Annie 已确认「可以」）。
> - 🔍 **真实链路发现一个解析局限（记录，不算 bug）**：解析是按「行」抓日期 + 人数的；测试邮件里日期「on 11/20」和人数「4 guests」分别写在两个不同的句子/行里，解析器没法跨行关联，人数没识别出来（黄字 `Number of guests not found`，Pax 格子空着但能手动填，不影响继续走流程）。以后如果要提升解析质量，这是一个可以改进的点：同一个服务的日期和人数经常会分写在相邻的句子里，不一定在同一行。
> - 结论（供 ff / Annie 定是否放给全体 staff）：代码层面、真实后端层面，这条链路目前都是通的；入口本身对所有 staff 开放，只有 tcq 这个开关要 Annie 开。

> 🟢 **收工交接（2026-10-16 凌晨，家里，3c 窗口）**：本窗口的改动全部已合 main 上线，没有 WIP 分支；本窗口开的临时 worktree 都已删；本机没有本窗口的进程（10-15 留在 3198 的 `-as` next dev 已由 Annie 同意关掉）。
> - 今天（10-15）本窗口上线的：G61 / G62 / G74（`69bbfe0`）、定时自动发送 G76 的 ops 页面（`34e576f`，开关仍关着）、G71 Dispatch 编辑锁（`d1a4458`，a6 之后在上面加了自动保存 `768fae5`）、短信两段（`71a14c6`，当晚被下一条取代）、短信 300 字 + 不能有特殊字符（`task/sms-300`，见下一条）。
> - **等后端**：
>   ① -75：巴士团默认 tour type 改按节设（v96 + Manifest setup 接口），到了以后撤掉 Products 那一列、Manifest setup 加按节设置（先给 Annie 看预览）、Auto Send How to use 第 3 条改「每一节要配」——见「进行中」auto-send 那条下面的 🔁。
>   ② -ec：短信 300 字后端那一块（分支 `task/sms-two-segments` `049cc77`）：staff 写的短信超 300 / 有特殊字符回 400；Tour 确认、门票提醒照 E49 挑名字（只印名、特殊字符换 Dear Guest）；所有自动拼的短信量最坏长度、超 300 怎么办出方案给 Annie。上线后 ops 只需确认 400 的原话能显示（页面已照原文显示 detail）。
> - **等 Annie**：线上用 ZZ Test 单验收 G61 / G62 / G74、G71（现在是自动保存版）、短信 300 字；Auto Send 开关由她第一次打开。
> - Dispatch 归 a6（自动保存、Farm out），本窗口不碰 `dispatch-view.tsx` / `use-edit-lock.ts`，要碰先合 main、先跟 a6 说。
> - 下次开工：`git fetch --prune`、从 main 拉 worktree 做；看后端 main 从 `1f8fec6` 往后、-75 / -ec 有没有来信。

> ✅ **2026-10-16 凌晨（家里，3c 窗口）`task/sms-300`：全部短信 300 个字符以内、不能有特殊字符（Annie：「全部短信都限制在300以内」+ 不能有 emoji / 特殊字符；预览第 2 版 https://claude.ai/artifact/VypHrqN6d3VuzSA4kucXcD 说「可以」），已合 main 上线。** 取代当晚的「两段」规则。
> - `lib/sms-limit.ts`：`SMS_CHAR_LIMIT = 300`；GSM-7 基本表 / 扩展表**照抄后端 `app/services/gsm7.py`**（单一真源在后端，后端改了这里跟着改）；`smsCheck()`（「N / 300 chars」，扩展表字符算 2；特殊字符只查 staff 写的原文，客人名字里的不算）、`smsProblem()`、`expandForCount()`、`tourDateText()`。
>   é è ñ ü à ö Ç É 等在表里、可以发；á í ó ú â ê î ô û ç、弯引号、长破折号、emoji、中文不行。
> - Tracking 群发、Main Manifest Send message、对话弹窗回复：超 300 或有特殊字符 ⇒ 字数变红、点发送先问改发 Email（点名是哪几个字符）；没邮箱的只能改字。Content Studio 短信模板 / 群发模板：超了或有特殊字符不让存（已经存好的不动，下次改了保存才查）。
> - How to use：Manifests 和三个 Tracking 页改成「at most 300 characters, plain characters only (no emoji, curly quotes or long dashes)」。
> - 检查：tsc / eslint / build 过；headless `mt` 174 / 174、`man` 208 / 208、`tt` 111 / 111、`tk` 120 / 120、`cs` 49 / 49（3198 / 8799 被 `-ds` 窗口占着，在临时复制的套上用 3298 / 8899 / 9433 跑的，复制品已删）。

> 🟢 **收工交接（2026-10-16 凌晨，家里，17 窗口 ⇒ Annie 回公司接着做）**：本窗口的改动全部已合 main 上线，没有 WIP 分支；本机 3198 / 8799 没有本窗口的进程。
> - **已上线**：G63 7 Days Forecast + Products Bus Manifest setup 第 9–11 项（`eee8d06`）；逐单列订单那行行名靠上（`5116ceb`）；Max allotments 格子居中、三行左对齐（Annie 10-16「把 ULX 的数字居中」，`fc` 84 / 84）；`products` 加「切到 Private 团」检查（130 / 130）。
> - **🔜 下一件：Forecast 表上手动改 + Action Log**（Annie 10-16：「antelope 全年开团，一般是临时关，你把整张表都改成可以手动改吧，然后在表的底部加 active log」）。
>   预览已同意：https://claude.ai/artifact/VamU4XqKTCmaAUW8R2njd6 。**Annie 已定（⛔ 不再问）**：
>   ① 人数自动、不能改，其余都在表上改：粗体人数格点开改「这天开不开团 + 原因」；Max allotments 格点开改这一天每档上限 / 时间（有 Back to usual）；手写格照旧。② **所有 staff 都能改**（Products 9–11 照旧只有 admin）。
>   ③ **Products 第 9、10 项留着**管长期的，表上改的只管某一天、优先于 Products。④ 手改过的格子**右上角小黄点**，鼠标移上去看谁 / 何时 / 原来的值。
>   ⑤ 表底部 **Action Log**：默认收起、最近 50 条新的在上、Show more；记表上所有改动（开关团、上限、手写格、Live Link）和 Products 9–11 的改动；列 When / Who / Tour / Day / What / From → To。
>   **已发后端 `npe-confirmation-service-4f`（10-16 凌晨）**，请它登记、先回形状再做。ops 建议的形状：`PUT /api/forecast/day-running {date, manifest_id, section, running: true|false|null, reason}`（60-day 加 `running_meta`）；
>   `PUT /api/forecast/day-allotment {date, manifest_id, row_label, time_label, max_pax|null}`（每档加 `day_meta`）；`GET /api/forecast/log?before=&limit=50` ⇒ {at, by, tour, date, what, from, to} + next_cursor；都是 staff、过去的日子不能改。
>   ✅ **4f 已回定稿形状（后端登记 G81；要新表 migrate_v97，Annie 今天审完执行后上线，4f 会发 commit）**：
>   · `PUT /api/forecast/day-running {date, manifest_id, section, running: true|false|null, reason ≤200}`：null = 清掉；true 压过 Products 的每周不开 / 停开日期，false = 关；**CCL Discord 写 Closed 仍压过手动 true**。每块加 `running_meta: [{updated_by, updated_at, was: {running, reason}} | null × 60]`。
>   · `PUT /api/forecast/day-allotment {date, manifest_id, row_label, time_label, max_pax: 1–9999 | null}`：null = 清掉；压过日期段和平常上限。每档加 `day_meta: [{updated_by, updated_at, was_max, was_time} | null × 60]`；只有按天覆盖的行也会出现（normal_* 是 null）。
>   · `GET /api/forecast/log?before=<cursor>&limit=50`（最多 200），新的在前 ⇒ `{items: [{at, by, tour, date|null, what, from, to}], next_cursor|null}`；from / to 是显示用文字，空是 ""；上线前的旧记录（10-15 晚的设置和手写格）from / to 都是空、what 是笼统的。
>   · 三个都是 staff，日期规则同手写格（今天到 +PLAN_MAX_DAYS_AHEAD，过去的拒）；Products 设置照旧 admin。
>   **接着做**：等 4f 发 G81 的 commit ⇒ 从 main 拉 `task/forecast-day-edits` ⇒ 照预览写：`components/forecast/` 加两个弹框（照 `cell-editor.tsx` 的深色弹框）、粗体格 / Max allotments 格变可点、小黄点、表下面 Action Log 卡；`lib/forecast-api.ts` / `types/forecast.ts` 加接口；
>   `fc-mock.js` / `fc-test.js` 加检查（含后端没上线时照旧）⇒ tsc / eslint / build / `fc` 过了合 main ⇒ 请 Annie 用 ZZ Test 关一天 Antelope 再改回来验收。
> - **Private 第 11 项**：4f 查生产——Private 是 manifests.id 7、bus_tour，设置接口里有它；`forecast_order_detail_blocks` 现在是 `[]`（Annie 10-15 23:33 PT 存的，勾了又取消 Antelope）。ops 用模拟数据切到 Private 一切正常 ⇒ 当时多半是页面打开时后端还没部署完。
>   **Annie 要做**：刷新 Products → Bus Manifest setup → 选 Private → 勾第 11 项，看 Forecast 的 Private 块。还看不到第 11 项就开浏览器看 `GET /api/settings/forecast` 回什么。
> - 已设（4f 查到）：Antelope Canyon X 30 @12:20P + 11/2–11/30 改 30 @1P、LOWER 35 @1P、UPPER 30 @12:40P。Antelope 全年开团 ⇒ Running days 不用设，临时关团等上面那件做好在表上点。
> - 等 Annie（不急）：要不要在第 11 项下面加一行「现在勾着的团：…」（= 第 11 项勾在哪几个团，不是订了的团；Annie 一度理解成订了的团，已解释）。
> - 之后：全深色（night 主题），见「待做」最上面那条；先挑一页出预览。
> - Farm out 归另一个 ops 窗口（a6 / 家里窗口），本窗口不碰。

> ✅ **2026-10-15 晚（家里，17 窗口）`task/forecast-g63`：7 Days Forecast 接 G63 + Products 第 9–11 项，后端 4f 上线（confirm `eeb8452` / merge `94a2641`，migrate_v96 已跑）后对过真接口，已合 main 上线。等 Annie 设好再用 ZZ Test 验收。**
> - 照 Annie 定稿的预览第 10 版 https://claude.ai/artifact/PC9PryVB1PxzWW7TkBAQ3V 和 4f 的接口形状（见「需要后端」G63 条）。所有新字段都是可选：后端没上线时页面和现在一样（手写格子也不能点）。
> - **Forecast**（`components/forecast/`）：不开团看 `running`，「-」鼠标移上去看 `closed_reason`；去掉「Lower or Upper inventory」行，Max allotments 左边写平常上限（`normal_*`，U / L / X 首字母，撞了写全名），格子每档一行剩几位（浅蓝 #7dd3fc、负数红、日期段不同补黄字「/20 11a」）；
>   有上限的日子列宽 88；CCL 车号 `no_gps` 标红；Sunset depart times 用 `depart_times`；Private 块逐单列 `orders`；手写格（Crew notes、Pax、Driver / Vehicle type、整页一行 CCL major events）点开 `cell-editor.tsx` 写，过去的日子只读，鼠标移上去看谁 / 何时；
>   页头 Day Tour Live Link（Edit、`rel="noopener noreferrer"`）+ Updated by。How to use 改了三条。
> - **Products → Bus Manifest setup**（`components/products/forecast-setup.tsx`）：9 Running days（七天按钮马上存 + 停开日期表）、10 Max allotments（每行时间 / 上限，点出框存，两格清空 = 删；下面「Different cap on these dates」表）、11 List each order（勾选整组 PUT）；
>   有 Own block 的团按块切标签；对不上的旧设置黄框列出可删（照 4f 说的删法）。设置接口 404（后端没上线）时三项不显示；staff（403）写一句只有 admin 能改。右边示意图 7 Days Forecast 那块加了 9–11 的编号。
>   面板的共用样式 / MapField / Saved 挪到 `components/products/setup-ui.tsx`（原样搬，没改样子）。
> - 检查：tsc / eslint（只有原来那条 `public/window-hscroll.js` warning）/ build 通过；`fc` **83 / 83**（加 25 项 G63 + 后端没上线时照旧；改 2 项：今天那列有上限变 88、Sunset 块多 Crew notes 行）、`products` **128 / 128**（加 24 项）。1600 宽截图看过两页。都是模拟接口。
> - 对过后端代码（只读）：字段名和形状都对得上；唯一改的是清空格子时后端回 `updated_at: null`、`updated_by: ""` ⇒ 页头 Updated by 不改（原来会显示 1969 年），mock 跟着改、`fc` 加了这条断言。
> - 🐞 10-15 深夜 Annie 截图：Antelope 下面多了一大片逐单订单——是 ops 的设置说明把「Private 勾 11」和「Antelope 设 9、10」写在一句里，Annie 在 Antelope 也勾了 11。已请她在 Antelope 取消勾选。顺手修：逐单那行很高时行名居中被挤出屏幕 ⇒ 改成靠上（`fc` 84 / 84）。
> - **Annie 要做（后端说「还什么都没设」）**：Settings → Products → Bus Manifest setup 选 Private 组勾 **11 List each order**（不勾 Private tours 那行是空的）；Antelope 设 **10 Max allotments**（每行时间 + 上限）和 **9 Running days**；然后到 7 Days Forecast 看、用 ZZ Test 写一格 Crew notes 再清掉。

> ✅ **2026-10-15 深夜（家里，3c 窗口）`task/sms-two-segments`：短信最多两段，超了改发 Email（Annie：「还是按照老规矩，最多两段，不可以超过规定的字数，否则发邮件」；预览 https://claude.ai/artifact/7o3VCNwZKQ9zHKnQkaa9mA 说「同意」），已合 main 上线。** 起因：后端 -ec 上了 1,600 字硬上限（`1f8fec6`），要页面提示字数。
> - 规则放在 `lib/sms-limit.ts`：`SMS_MAX_SEGMENTS = 2`、`describeTwoSms()`（「N chars, X of 2 SMS」，超了红字）、`expandForCount()`（{first_name} 用最长的名字、{tour_date} 用日期，按最坏情况算）、`tourDateText()`（从 Tracking 群发搬过来）。Tracking 群发行为不变，只改用共用的。
> - Main Manifest Send message：字数提示改两段；勾着 SMS 又超了，点 Review 先问「Yes, use Email only」（会写几位没邮箱，只在名单有 email 列时），选了就只发 Email、照常查重确认。⚠️ 名字按名单的 Guest 列算，列没拉到就按 Guest 算。
> - 对话弹窗（三个 Tracking 页的 Notes / WhatsApp）：字数提示改两段；有邮箱的点 Send 先问「Yes, send by email only」，改字就收起；没邮箱的一直提示、Send 灰掉只能缩短；Save note 不受限。
> - How to use：Manifests 和三个 Tracking 页各加一句。⚠️ 这一版的「两段」规则当晚就被「300 个字符、不能有特殊字符」取代（见「进行中」`task/sms-300`），Content Studio 也一起改了。
> - 检查：tsc / eslint / build 过；headless `man` 194 / 194、`mt` 157 / 157、`tt` 104 / 104、`tk` 108 / 108。

> ✅ **2026-10-15 深夜（家里，worktree `D:\npe-ops-frontend-ds`，分支 `task/dispatch-simplify`）：Dispatch 自动保存，已合 main 上线。** Annie 看完简化版预览后改主意：「算了我不改了，就保留原来的版式吧，就改一下可以自动保存，然后把点击保存的键都撤了」+「how to use 照预览那样精简一下，rezdy 的同步按钮应该在 guest list 旁边」。**下面那条简化版（新版式、检查清单、Send 摘要）作废，不做。**
> - **自动保存**（`dispatch-view.tsx`）：staff 改了、停手 3 秒就整天存（同原来 Save schedule 的请求）。Save schedule、Discard 两个键和底部保存条撤掉；Step 2 标题行写状态：`Saving…` / `✓ All changes saved · 11:35 PM`（换天清掉）/ 存不上时 `Not saved - see the message at the bottom`。
>   存不上（车没司机、服务端 400、网络）⇒ 底部红条写原因（`Not saved: a vehicle needs a driver (…). Pick one, or type the name.`），那一行标红，Assign 标签旁黄字 `not saved`，不滚动；同一份不再自己重试，staff 再改才试。409 照旧红条 + Reload。
>   只是打开不存：CCL 预填、按人数补开的空车、补编的字母都等 staff 动了手才一起存（不占这一天）。Completed：先把还没存的存好再标完成，存不上就不标。离开 / 换天时有还没存的（3 秒内）照旧先问「This day has changes that are not saved yet」。Send 那边黄条改成「Assign is not saved yet…」。原来「存好滚到 Completed」去掉。
> - **G71**（`use-edit-lock.ts`）：去掉 10 分钟「Still editing?」提醒；占着 15 分钟没动手 ⇒ 放开、写一句「You stopped editing this day after 15 minutes without changes…」（不弹窗，没存上的改动留在页面上，再改会重新占）。检查脚本可设 `window.__dispatchAutosaveMs` / `window.__dispatchIdleExitS`。
>   ⚠️ 后端每次存都会放开锁，所以停手 3 秒存完别人就能占这一天——**要后端（G71 / -ec）：自动保存不放锁**（建议 save 带个 `keep_lock: true`，存完照旧占着、续时）。没改之前问题不大：只有 Annie 在用 ops。
> - **How to use 精简**：Step 1 Guest lists 5 条、Step 2 Buses & drivers 5 条、Send to drivers 3 条、Morning Relay 3 条。Step 1 说明改一句话（点 Assign Bus / Check the bus）。页头那句去掉「and save」，Step 2 说明去掉「then Save schedule」；右栏、CCL 蓝条、座位提示、manifest 页里提到 Save schedule 的都改了。
> - **Sync Rezdy 键挪到 Step 1 标题 Guest lists 旁边**（`SyncRezdyButton` 加 `align="start"`，上次更新写在键右边），How to use 在它后面；Main Manifest 那边不变。
> - 检查：tsc / eslint / build 过；headless `da` / `mf` 全过（da 的 Save schedule / Discard / 提醒那些改成自动保存的测法：缺司机不发请求、400 原话、同一份不重试、预填不存不占、Completed 先存、15 分钟退出放开、Sync 键位置）。都是模拟接口。**等 Annie 线上用 ZZ Test 那天试。**
> - 已合 main 上线（`768fae5`）；合前合了最新 main 复测 `da` **229 / 229**、`mf` **76 / 76**、`man` 194 / 194（`mt` 157、`imp` 25、`nav` 29 合前跑过）。已告诉 3c（可以动 dispatch-view / use-edit-lock 了；简化版作废，Farm out 照原版式做）。
> - **收工交接（2026-10-16 凌晨，a6）**：这件事做完了，worktree `D:\npe-ops-frontend-ds` 干净。下一步：① 等 Annie 线上用 ZZ Test 那天验收自动保存；② 等 -ec 回「自动保存不放锁」的字段名，回了在 `save()` 里带上、`lock.forget()` 改成续占（测试补一项）；③ Farm out 等 4f 的接口形状（见「需要后端」第一条）。
>   ⚠️ 跑 headless 前看 8799 / 3198 有没有别的窗口占着：run-all 会直接用 3198 上已有的 next dev（可能是别的文件夹的代码），结果不算数。

> ❌（作废，见上一条）**2026-10-15 深夜：Dispatch 简化版——预览已给。** 预览 https://claude.ai/artifact/J8AHKpuWhfMPHmHRqWyYh5
> - 起因：Annie 觉得 Dispatch 太复杂（贴了一份分析：staff 只做三件事——核对司机、看 Bus Manifest 填确认号、看巴士安排，做完点 Completed，Send 只确认后发出）。ops 对照代码核过：Send 不看 Completed；How to use 共 46 条；Pull from manifests / Check the list / Need a look / Copy 1st Round / Save first 都还在。
> - **Annie 已定（⛔ 不再问）**：① **自动保存 + 只留 Completed**（去掉 Save schedule 键；Completed = 先存再标完成；Send 只认 Completed）；② **Relay 每轮一套固定的默认酒店路线**（Settings 里存，新的一天自动套，staff 只改例外——要后端）；
>   ③ **先定新版式，G71 编辑锁（3c 已合 `d1a4458`）和 Farm out 的 ops 页面都做在新版式上**（后端 4f 的 Farm out 数据 / 接口照常做）。3c 已答应新版式批之前不动 Dispatch 界面。
> - 预览：Assign 顶上「Before you finish this day」三行检查清单（Drivers to check / Bus Manifest / Buses，写还剩几处、点了跳过去、全绿 Completed 才亮）；没问题的团收成一行；Pull from Discord / Sync Rezdy 退成小链接；Upload CSV 只在同步失败的红字里；Need a look 挪进 Buses 那一行；How to use 5 条。
>   Send：没 Completed 只写「Complete ① Assign first」；打开就是摘要（司机 / 导游 / 1st / 2nd Round 一组一行、要发 · 已发、一个 Send）；Completed 之后新增 / 改了的客人单独一块补发；How to use 3 条。Settings · Morning Relay route。
> - 等 Annie 回的 4 个问题（预览底部）：清单要不要「OK, leave it」标已看过；自动保存停手 3 秒存、请后端改「自动保存不放锁」；G71 的 10 分钟提醒改成 15 分钟没动手自动退出编辑；摘要行不放 Send anyway。
> - **Annie 补的环节（10-15 深夜，⛔ 不再问）**：staff 要进 Bus Manifest 填**羚羊谷**的确认号；**只有羚羊谷要确认号和 check-in 那一行**，别的团不要。
>   check-in / tour time **按节在 Products → Bus Manifest setup 里新设**（Annie 选），Bus Manifest 自动带出、可改，staff 只填 Confirmation #。ops 建议不写死「羚羊谷」：setup 里设了时间的节才显示那一行（预览第 2 版「Bus Manifest」标签）。
>   查过：现在 Products / 后端都没有这个时间，Bus Manifest 那一行（`tour_manifest_attraction`）每一节都有、全手填 ⇒ 要后端加。
> - **Annie 又定（10-15 深夜，⛔ 不再问）**：⑤ **只展示问题**——车、司机、导游、座位、Relay 酒店都已自动排好，Assign 只列「To fix」（一处一行、改的控件就在那行、改完消失），其余收进一行「Everything else is set」，点开才是完整排车；「from Products」这类说明一律不写。
>   ⑥ **司机 / 导游名字对不上不让过、没有「OK, leave it」**：从 HR 选或手写（现有的 typed name，存时记住 + 发邮件请 Annie 加进 HR）。预览第 6 版。还在问：别的问题要不要 leave it（建议不要）。
>   ⑦ Annie 回 4 个问题：**一律不能 leave it、三行全绿才 Completed**；**自动保存停手 3 秒存 + 请后端改自动保存不放锁**；**去掉 G71 的 10 分钟提醒、15 分钟没动手自动退出编辑**；摘要行放不放 Send anyway 要看预览 ⇒ 预览第 7 版 ② Send 里 A（不放，建议）/ B（放「Send all again」）等 Annie 挑。
> - 要后端（Annie 批了再发）：默认路线的存储 + 套用；Send 名单只读 Completed 时的排车；自动保存不放编辑锁（G71）；检查清单三项的计数（司机没对上、缺确认号、巴士异常）最好后端算好给；
>   **Bus Manifest setup 按节存 check-in / tour time，manifest 接口带出默认值，只有设了时间的节给 `attraction`**。

> ✅ **2026-10-15 晚（家里，3c 窗口）`task/dispatch-edit-lock`（worktree `D:\npe-ops-frontend-el`）：跟后端 G71「Dispatch 同一天同时只能一个人编辑」（confirm `3e394ac`，后端 -ec 来信；接口说明 `docs/interfaces/dispatch-edit-lock-2026-10-15.md`），Annie 看预览 https://claude.ai/artifact/7PRV5MUZnrr7Pzem9TdVYp 说「可以」，已合 main 上线。**
> - 计时 / 心跳 / 占住 / 放开在 `components/dispatch/use-edit-lock.ts`；接口 `lib/dispatch-api.ts`（acquireEditLock / editLockHeartbeat / releaseEditLock / releaseEditLockOnLeave，save / copy 多带 edit_token）。
> - `dispatch-view.tsx`：`edit()` 第一次动手先占（占的那一下控件灰掉）；409 ⇒ 琥珀条 `🔒 <原话>` + Check again，并按 heartbeat_every_s 自动再查，放开了就重读这一天；GET day 的 edit_lock 是别人 ⇒ 同样只读；stale ⇒ 重读 + 提示「Someone saved this day after you opened it…」，这一下不算。
>   Save / Copy 没占也先占；成功后算放开。Save / Copy / 心跳 409 ⇒ 红条原话 + Reload。Discard、换日期放开；关页面 / 离开用 keepalive 放开。
>   最后一次动手 remind_after_s 后弹「Still editing?」倒数 auto_save_after_s，Exit = Discard，Save = Save schedule，到 0 自动存（存不成写在保存条上）。保存条在改的时候多一句「You are editing this day…」。How to use 加一条。
>   `disabled` 拆成 `navDisabled`（换日期、Send 标签、挪座位，别人在改时照样能用）和 `disabled`（改排车）。Step 1 的同步 / 上传 CSV / Completed 后端没要求锁，没动。
> - 检查：tsc / eslint / build 过；headless `da` 226 / 226（新加 49 项 G71）、`mf` 76 / 76。3198 被 `-as` 留下的 next dev 占着，在临时复制的套上用 3298 / 8899 / 9433 跑，复制品已删。
> - 已告诉 a6（它接下来要在 dispatch-view / seating / dispatch-api 做 Farm out，会先合 main）。

> ✅ **2026-10-15 晚（家里，3c 窗口）`task/auto-send`（worktree `D:\npe-ops-frontend-as`）：跟后端定时自动发送（G76，confirm `3c5c22b`，后端 -75 来信；接口说明 `docs/interfaces/auto-send-2026-10-15.md`），Annie 看预览 https://claude.ai/artifact/6eqEam8LpuQQLdBSCoyUmZ 说「可以」，已合 main 上线。开关上线时是关的，由 Annie 第一次打开。**
> - **Products**（`components/products/`）：Tour type 一列，门票产品照旧存 `ticket_tour_type`；其他产品（含没分类的）选巴士团默认 tour type，存 `bus_tour_type`（`PATCH …/{id}/bus-tour-type`），没配时橙框「— not set: auto-send skips —」。批量 Tour type：选中的全是门票 ⇒ 门票清单；全不是 ⇒ 巴士团清单；混着 ⇒ 不让 Apply。Action Log 多「Bus tour type」。How to use 改写 tour type 几条。
>   ⚠️ 行为变了：不是门票、却还留着旧 ticket_tour_type 的产品，以前显示门票下拉（只能清空），现在显示巴士团下拉。
> - **Send tour confirmation 弹窗**（`components/manifests/send-dialogs.tsx`）：每节按产品默认值预填（勾的客人都是同一个值才填，下面绿字 From Products；混着 / 没配就空着、橙字说明），staff 改了以 staff 为准。取代 10-09「不预选」。
> - **新页面 Settings → Auto Send**（`/settings/auto-send`，admin；`components/auto-send/auto-send-view.tsx`、`lib/auto-send-api.ts`、`types/auto-send.ts`；侧栏在 Products 下面）：总开关（绿开灰关，点了先确认，确认就存）、巴士团确认 / 门票提醒两张卡片（时间、提前天数、收件人、门票汇总时间，各自 Save，存的时候另一张卡片用已存的值）、最近 30 批记录（Done / Failed / Off / Running / Stuck）、How to use。
> - 检查：tsc / eslint / build 过；headless `products` 104 / 104、`ptt` 44 / 44、`man` 174 / 174、新套 `as` 61 / 61、`nav` 29 / 29。
> - 下一步（同一个后端窗口 -ec 发来、还没做）：短信 1,600 字上限（`docs/interfaces/send-dedup-2026-10-15.md`「短信 1,600 字上限」），两处群发和回复气泡要加字数提示——先给 Annie 看预览；和 10-14 定的「群发最多两条短信」要一起看。
>   ✅ Annie 定「还是按照老规矩，最多两段，不可以超过规定的字数，否则发邮件」——群发和单条回复都按两段，已上线（见「进行中」`task/sms-two-segments`）。
> - 🔁 **Annie 10-15 晚改主意（后端 -75 转达）：巴士团默认 tour type 按节设，不按产品设**（「都同一台车在一个 section 的，就共用一个啊」；巴士团现在只有 Antelope 分了 4 节）。后端明天做 v96（存在组上、按节名对应，同 section_order；删 `manifest_products.bus_tour_type`）+ Manifest setup 按节设置的接口；`GET /api/manifests` 的 `values.bus_tour_type` 字段名不变（改从节上取）⇒ 人工发送弹窗预填不用改。
>   ops 等新接口到了一次做：撤掉 Products 页非门票产品的巴士团 tour type 下拉（`components/products/products-table.tsx` / `products-view.tsx` 的 busTourTypes、批量、How to use、Action Log 的 Bus tour type）+ Manifest setup 按节设置（**先给 Annie 看预览**）+ Auto Send How to use 第 3 条改「每一节要配」。现在只有 Annie 用 ops，Products 那一列先不单独撤。
>   🔁 **Annie 10-16 凌晨又定：Products 那边也保留可以设**（「还是保留在 products 那边也可以设吧」）⇒ **不撤 Products 页的下拉**。按节存（同一节共用一个值）不变，Products 页和 Manifest setup 两处都能改同一个值。
>   ops 建议的做法（做之前先给 Annie 看预览）：Products 页那一格显示这个产品所在节的值，改了就是改整节（同节别的产品跟着变，下面灰字写「Applies to all of <节名>: 产品 A、B」）；没分节 / 没分组的产品照旧按产品存。批量 Tour type 同理。
>   要后端（-75）：v96 别删 `manifest_products.bus_tour_type` 的写入口，或者给一个「按产品改 ⇒ 写到它所在的节」的接口；Products 列表接口带回每个产品的节名和节上的值。✅ 已发 -75（10-16 凌晨，a6）。**-75 回**：沿用 `PATCH /api/settings/products/{id}/bus-tour-type`，后端内部写到所在节、回节名和受影响的产品（没分节 / 没分组照旧按产品存）；`GET /api/settings/products` 每个产品带节名和节上的值；`/api/manifests` 不变。迁移用 v97 起（v96 被 G63 用了）。Annie 10-15 晚已用 SQL 给 12 节 111 个巴士团产品填好值（现存在产品上），后端改按节存时一起迁、不丢。形状定了 -75 会发来，到了先出预览。
> - 🔵 **G71 Dispatch 同一天只能一个人编辑**（后端 -ec `3e394ac`，接口说明 `docs/interfaces/dispatch-edit-lock-2026-10-15.md`；a6 说归 3c 做）：✅ Annie 说「可以」，已上线，见「进行中」第一条。a6 接下来要在 `dispatch-view.tsx` / `seating.tsx` / `lib/dispatch-api.ts` 做 Farm out（G40），G71 上 main 后要告诉 a6 一声。

> ✅ **2026-10-15 晚（家里）`task/dispatch-csv-fallback`：Dispatch Step 1 每个团加「Upload Rezdy CSV」——同步失败时的后备，不用再去旧网站（Annie 经后端 4f 转：「直接把它做了吧」；照旧页面 `_tour_manifests_panel.html` 的流程搬，所以没另出预览），已合 main 上线。**
> - 每张团卡片最下面一排多一个白键 Upload Rezdy CSV（文件框只收 `.csv`）→ `POST /api/dispatch/manifests/preview`（不写库）→ 弹窗表格 Added / Removed / Changed（列照旧页面：Change、Order #、Pickup、Location、Guest、Pax、Note、Tour；状态是彩色字不做胶囊）→ 蓝色 Apply N changes → `POST …/apply`（文件再传一次）→ 弹窗关、Step 1 说明后面写「团名: applied — N orders, N pax.」，卡片和 Step 2 车下面的名单重读。
>   Cancel / Esc / 点背景 = 什么都不改；Apply 出错弹窗留着写后端原话；选了 Excel 等被拒的文件：不弹窗，卡片上方红字写团名 + 后端原话。
> - 同步失败的红字和 How to use 最后一条改成指向这个键（不再写去 confirm 旧网站）：只收 Rezdy 原样下载的 CSV、Apply 前什么都不改、同一位客人保留车和上车标记、下次同步成功会再按主 Manifest 核一遍（只增不删，G65）。
> - 文件：`components/dispatch-manifest/csv-upload-dialog.tsx`（新）、`manifests-panel.tsx`、`lib/dispatch-manifest-api.ts`（`previewUpload` / `applyUpload`）、`dispatch-view.tsx`（Apply 后 `setManifestVersion`）。
> - 检查：tsc / eslint / build 通过；`mf` **76 / 76**（加 12 项：键和 accept、preview 请求、弹窗内容、HTML 当文字、Cancel、Apply 失败、Apply 成功重读、Excel 被拒、没有变化、Esc；改 2 项旧的「去旧网站 / 没有上传键」）、`da` 177 / 177。截图看过。**等 Annie 线上用 ZZ Test 团的 CSV 试一次。**

> ✅ **2026-10-15（家里，3c 窗口）`task/send-dedup`（worktree `D:\npe-ops-frontend-sd`）：跟后端 G74 / G61 / G62（confirm `56a7c2a`，后端 -ec 来信；接口说明 `docs/interfaces/send-dedup-2026-10-15.md`），Annie 看预览 https://claude.ai/artifact/CEsBwbALjgL19i1bbPhGWm 说「可以」，已合 main 上线，等 Annie 用 ZZ Test 单线上验收。**
> - **Morning Relay（G61，`components/dispatch/relay-panel.tsx`）**：两轮表格加勾选（表头全选只管没发过的；没发过的默认勾）和最后一列 Send anyway（表头 Send anyway (all)）。发过的整行淡黄、黄标签「Sent by 谁 on 时间」，发过之后改了的下面橙字「Changed after sent: …」；原来的 Sent / Not sent 胶囊去掉，No show 照旧红胶囊、不能勾；列名 Text → Status。
>   点发送：先调 preview 看拉名单之后别人发过谁（确认框写「Sent by someone else since you pulled, skipped」），只发勾的（`order_numbers`），Send anyway 的放 `send_anyway`、`preview_at` = relay-pull 的 `checked_at`。结果框多黄框（跳过的 / 重发的单号）、红框（不在这一轮的）。How to use 两条改写。
> - **群发（G62）**：Main Manifest 的 Send message（`components/manifests/send-dialogs.tsx`）点 Review 先调 `/api/manifests/broadcast/check`；Tracking 两页的群发（`components/ui/broadcast-dialog.tsx`）点 Send broadcast 先调 `/booking-notes/broadcast/check`（`next.config.ts` 加了这条转发）。收过一模一样消息的列出来、默认跳过、可逐个 / 全部 Send anyway；人数跟着变，全部收过又没勾时发送键灰掉。发完写跳过几单；409（同一天别人在群发）= 什么都没发。Main Manifest How to use 和弹窗说明各加一句。
> - **Sync Rezdy（G74）**：Main Manifest 那边回 `guest_lists_error` 时，按键下面一行橙字写后端原话。
> - 检查：tsc / eslint（全仓只有 `public/window-hscroll.js` 一个旧 warning）/ build 过；headless `da` 177 / 177、`man` 161 / 161、`tt` 102 / 102、`tk` 106 / 106（3198 / 8799 被别的窗口占着，在临时复制的套上用 3298 / 8899 / 9433 跑的，复制品已删）。
> - 没覆盖：Relay「Tick at least one guest.」那句 UI 上到不了（什么都没勾时发送键已灰掉）。Dispatch 的 driver-notice 发送后端这次没加查重，没动。

> ✅ **2026-10-15（家里）`task/dispatch-csv-only`：后端 4f 来信（confirm `dbd0b12`，Annie 10-15 定，G72）：Dispatch 的名单手动上传只收从 Rezdy 下载的 CSV，Excel 一律 400。已合 main。**
> - ops 的 Dispatch 本来就没有上传框（名单自动同步，手动上传只在旧网站 confirm 上做，是后端的页面）⇒ ops 只改了两处指去旧网站的说明：Step 1 How to use 和同步失败的红字，加「as downloaded from Rezdy / Excel files are not accepted」。Tour / Morning / Tickets 发送页照旧收 .xlsx，没动。
> - 检查：tsc / eslint 通过；`mf` 65 / 65。`manifests-panel.tsx` main 上本来就有 prettier 格式差异，没整份重排（3c 也在改这个文件）。

> ✅ **2026-10-15（家里）`task/dispatch-private-tour-collapse`（从 main 拉出）：Dispatch Step 2 的 Private Tour 当天没车时也收起来（Annie 看预览 https://claude.ai/artifact/Hx3T4Fc88mo8dz3CUYJ5Fi 选写法 A），已合进 main 上线。**
> - Private Tour 没有 Step 1 卡片，所以看这一块有没有车（`rows` 里有没有 `private_tour` 的行），不看客人。没车就收进 Step 2 原来那一行「没客人的团」，同一个开关、点了一起展开。
> - 文案（`EmptyToursToggle` 新增 `extra`）：同时有没客人的巴士团 ⇒「▸ 1 tour with no guests yet · **Private Tour (no vehicles)** — Hoover Dam (click to show)」；只有 Private Tour ⇒「▸ **Private Tour (no vehicles)** (click to show)」。Step 1 那一行不变（Step 1 没有 Private Tour）。
> - 点开照旧有 + Add vehicle；一加车（还没 Save 也算）Private Tour 就回到上面、收起条里不再写它（和巴士团「排了车就不收」是同一个判断）。Relay 两轮不收。
> - 检查：tsc / eslint / build 通过；`da` **155 / 155**（改：10-05 那条，现在 Hoover Dam 和 Private Tour 一起收；加：只有 Private Tour 没车时单独一句、点开能 + Add vehicle、加车后回到上面）、`mf` 65 / 65。**等 Annie 线上验收**。

> ✅ **2026-10-15（家里）`task/workspace-tcq`：My Workspace 第二期 ops（Transfer & Charter Quotation，后端 G66），Annie 看预览说「就用这个吧」，已合进 main 上线。** 预览 https://claude.ai/artifact/VFKkNAZ1mHVA6yuW1CEyQz（第 2 版：报价单照 Annie 在公司看过的 PDF 样张 NPE-2026-0001 https://claude.ai/artifact/V8fw6boDyE9ujhgPHSC9Mh 改成一模一样的版式）
> - 文件：`components/tcq/`（`tcq-review.tsx` 审核 + 报价、`quote-sheet.tsx` 报价单、`settings-view.tsx` 设置页、`config.ts` 草稿 / 请求 / 金额日期格式）、`lib/tcq-api.ts`、`types/tcq.ts`、`app/settings/transfer-charter/page.tsx`；
>   `components/workspace/item-view.tsx`：去向是 tcq 时 Review 那块换成审核页（别的去向照旧占位）；Generate 后上面 Work item 的状态 / 下一步跟着变。侧栏 Settings 加 Transfer & Charter（admin）。
> - 做法：价一律由后端按当天价目表算。每改一下（等 0.45 秒）发两次 preview：一次是真的报价单；一次「probe」把每项服务坐得下的车全勾上、说明写成 `#probe-<key>`，用来显示没勾的车的价和算式（preview 只算勾了的车）。都不存、不取单号。
>   草稿（`edited`，形状前端定：`module: "tcq", version: 1`）存服务、改过的价（美元文字）、手动行、小费 / 税 / 三段条款、剩下的没读出来的行。Generate quote 先存草稿再出单。
> - 顺手处理的两种情况：停用了的车型勾着 ⇒ 不放进报价、卡片上写一句（不然后端整单 400）；人数改大后勾着的车坐不下 ⇒ 照样列出、写「Only 6 seats for 8 guests」，能取消。刚打开没改过不算没存的改动（不弹离开提示）。
> - 检查：tsc / eslint / prettier / build 通过；新套 `tcq` **79 / 79**（模拟接口照后端 tcq_pricing / build_quote 写的计价）；`ws` 56 / 56（审核页占位那条改成查审核页）、`nav` 29 / 29。宽屏 / 420px 截图看过，没有横向滚动。**没连真实后端**。
> - ⚠️ **上线后还看不到**：生产上 tcq 去向是 `is_enabled = FALSE`（后端 4f 说页面做好再开）。**Annie 在 Settings → My Workspace 把 Transfer & Charter Quotation 打开**，staff 才能选。验收：粘一封 ZZ Test 邮件 → Generate → 审核页勾车 / 改价 / 切 Rate → Save draft → Generate quote → 下载 PDF 看和样张一样。
> - 原来写的预览说明（保留）：
> - ① 工作项页 `/workspace/[id]` 原来的「Review」占位换成：1 Services（每项服务：车型勾选 + 改价 + 算式、包车 Hours / Rate Auto·Normal·Event、黄字待查、Edit / Remove、没读出来的行 + Add as a service）→ 2 Extra lines and quote options（手动行、小费两种、税开关、三段条款这张单自己的）→ 3 Quote（照接口按车型分块，改了就调 preview；Save draft 存 `edited`、Generate quote；`pdf_problems` 红框）→ 4 Quotes generated（历次单号 + PDF）。深色卡片同阶段一。
> - ② Settings → Transfer & Charter（admin，`/settings/transfer-charter`）：车型价目表（每行 Save，停用变灰）、活动日历、费用和条款（一次 Save）、读取词、航空公司、地点。白卡片同别的 Settings 页。
> - 对齐后端：`阶段二_接口说明.md`（confirm main `01bca8a` / `f77889b`）。

> 📨 **2026-10-15 后端 `npe-confirmation-service-4f` 来信：My Workspace 第二期（Transfer & Charter Quotation，G66）后端已合进 confirm main（merge `e5d2ab7`），生产已跑 migrate_v93。**
> 接口说明在后端仓库 `docs/previews/my-workspace-2026-10/阶段二_接口说明.md`（流程、读取结果 `parsed` 的 JSON 形状、报价请求 / 预览的 body、PDF 下载路由），可配置项在同一文件夹的 `阶段二_可配置项清单.md`。
> ✅ 4f 复查完已推 confirm main（`01bca8a`，Railway 部署中），接口没变，上面两份文档仍准。tcq 去向在生产上保持 `is_enabled = FALSE`，ops 页面做好后再打开。**ops 这边是新功能，要先给 Annie 看预览再写代码；Annie 还没说开始做。**

> 🟢 **收工交接（2026-10-15，公司，ba 窗口）**：本窗口做的都已合进 main 上线，没有 WIP；本机 3198 / 8799 / 3297 上没有本窗口的进程；临时 worktree `C:\Code\npe-ops-frontend-ba` / `-dt` 已删（主目录是别的窗口在用，没动）。
> - 今天上线：群发最多 2 条短信、超了建议改 Email（`a36ddd8`）；`da` 测试预期跟上 Copy 1st Round（`3748a24`）；Send 页一打开就显示发给司机 / 导游的原文（`62142e7`）；Users 页 guide 说明（`e4d0c3e`）；G65 只增不删（`57c0b7f`）。
> - 转出去的：Sync Rezdy 按键 ⇒ 1a 已做完上线（`faf108a`，已合 G65）。
> - 等 Annie：① 线上用 ZZ Test 单验收 G65 + Sync Rezdy（取消 / 改期 / 恢复；没变化时点 Sync 不清 Completed）；② G75 导游短信谁做、短信原文批不批。
> - 等后端：G75（导游短信 + `/guide?date=`）、G63（Forecast 数据）、G64（Category）、G61 / G62（Relay / 群发 Send anyway）。
> - 下次开工：`git fetch --prune`、从 main 拉；看后端 main 从 `8c9f3d8` 往后。主目录常被别的窗口切分支，自己开 worktree 做。

> 🔁 **2026-10-15 收工交接（公司，`task/dispatch-collapse-completed`，已全部合进 main，没有没提交的东西；合并时把别的窗口同一天推的几条一起拉了进来，见下面）**
> - 今天上线的：下面那条 Dispatch 收起 / 人数 / Completed / 步骤条。**等 Annie 线上验收**。
> - 下一步（按顺序）：
>   1. ~~Private Tour 没车也收起~~ ✅ 10-15 家里已做完上线（见最上面 `task/dispatch-private-tour-collapse`）。
>   2. 「需要后端」第一条导游短信已经有人发了（G75，b7 登记），但还没覆盖 Annie 这次追加的「SMS / Email / Both 可选」——我已把这点并进那条目末尾，等后端回字段名再做 Send 页（先预览）。
> - 做法提醒：Annie 讲需求时会分几句说，**等她说「动手」再开始**；样子改动先预览、同意了再写代码。
> - ⚠️ 这台电脑的 `C:\Code\npe-ops-frontend` 有几个窗口共用：今天跑检查时分支被别的窗口切到 main，造成一次假失败；合并到 main 时另一个窗口已经推了好几条新的、push 被拒绝过一次（没强推，已 merge 拉下来重新检查）。跑套之前先 `git branch --show-current`；合 main 先 `git fetch` 确认没有新提交再推，有就先 `git merge origin/main` 处理冲突、重新跑检查再推，不在共用文件夹里 checkout main。

> ✅ **2026-10-15 公司 `task/sync-rezdy`（从 main 拉出，worktree `C:\Code\npe-ops-frontend-rz`）：Sync Rezdy 按键（后端 G70，`e4779ac`；Annie 2026-10-15 定，预览第 3 版 https://claude.ai/artifact/W7jjHfsjKNQSMKX4N2BuRm；ba 窗口转来），已合进 main 上线。**
>
> - 两处：Main Manifest 顶部那一排最右边；Dispatch ① Assign Step 1 Guest lists 标题行最右边（How to use 展开时挪到下一行，按键留在标题行）。② Send 不放，Relay 发送前也不自动同步。
> - 按键只有两个图标：Rezdy logo（`public/icons/rezdy.png`，rezdy.com 的 apple-touch-icon 180×180）+ 同步双箭头圈，不写字，aria-label / title「Sync Rezdy」。共用组件 `components/rezdy-sync/sync-rezdy-button.tsx`，接口 `lib/rezdy-sync-api.ts`、类型 `types/rezdy-sync.ts`。
> - 左边一行：「Last updated from Rezdy: 7:58 AM by veronica」（洛杉矶时间；不是今天点的加日期；没同步过写 Not updated from Rezdy yet）；点完加「· N new · N cancelled · N changed」（failed 不空加「· N failed」）。同步中圈转、不能点；出错红字写后端原话（`error`，400 读 `detail`），后面括号留上次更新。过去的日子灰掉（title 写 Past days cannot be synced）。
> - 点完：Main Manifest 重读列表，新单那行标绿 4 秒；Dispatch 用返回的 `guest_lists` 当名单同步结果（不再调 /sync）、重读 Step 1 卡片和车下面的名单。
> - How to use：没有另开一个框，两页各在原来的 How to use 里加一条（文字照预览建议）；Manifests 那条「each pill shows its orders and pax」顺手改成「its pax」（胶囊上午改成只写人数）。
> - 检查：tsc / eslint / prettier / build 通过；`man` **141 / 141**（加 7 项）、`da` **152 / 152**（加 6 项，整套跑完）、`mf` 61 / 61。都是模拟接口，没连真实后端；**真点要 Annie 用 ZZ Test 单验收**（Rezdy 取消一张、改一张接人时间 → 两页都看到变化；名单没变时点 → 不写、Step 1 Completed 不被清；Rezdy 连不上 → 红字）。
> ✅ **2026-10-15 公司（ba 窗口）`task/g65-add-only`：跟后端 G65 Dispatch 名单只增不删（后端 a1，main `e4bda16`，migrate_v94 已执行），Annie 看过预览说「可以」，已合 main 上线。**
> - Bus Manifest 页（`components/dispatch-manifest/manifest-view.tsx`）：
>   - `sync_status = "missing"` 的客人（主 Manifest 里找不到、原因不明）照样在原来的车上、人数照算，单号下面橙字 `sync_note`（「Not in main manifest — check Rezdy」）。
>   - 接口新的 `gone`（取消 / 改期，不在车上、不算总数）：页面最下面单独一块「Cancelled / moved · N orders」「0 pax — not counted, not printed」，每行单号划线、「0 (was N)」、原来的车、原因（取消红字 / 改期蓝字）。`GoneCard`。
>   - How to use 加两条（更新不删单、取消 / 改期移到最下面；橙字是什么）。
> - Dispatch Step 1 团卡片（`manifests-panel.tsx`）：`missing_orders` 橙字「N orders not in main manifest — check Rezdy」、`gone_orders` 灰字「N cancelled / moved — 0 pax, listed on the manifest」；How to use 加一条。
> - 类型（`types/dispatch-manifest.ts`）：卡片 `gone_orders` / `missing_orders`、客人 `sync_status` / `sync_note`、`ManifestView.gone`、同步结果 `kept`，都是可选（旧后端没有也不出错）。同步结果的 `kept` 页面暂时不用（卡片已有计数）。
> - 后端管、ops 不用改：司机页 / 导游页 / Morning Relay / 自动分车 / 总数 / 午餐 / 打印 / Excel 都没有取消 / 改期的行；对它们改车、上车会 400。
> - **待 Annie 线上验收**：用 ZZ Test 单在 Rezdy 取消 → 留在名单 0 人 + 原因；改到别的日子 →「Moved to …」；恢复 → 原人数。
> - 检查：tsc / eslint / build 通过；`mf` **65 / 65**（加 4 项：卡片两行、橙字、最下面那块、页头总数不含取消的单）、`da` **146 / 146**。
> - 顺带：「Sync Rezdy」按键（后端 4a 转来，G70 改做法）Annie 让转给做 Manifests 的窗口 ⇒ 已原样转 `npe-ops-frontend-1a`（不是它就转 8d），ba 没做。会和本条改同一个 `manifests-panel.tsx`，已提醒。

> ✅ **2026-10-15 公司（ba 窗口）`task/users-guide-wording`：Users 页角色说明里 guide 那句改掉（Annie：「改——因为这是旧网页没有的功能」），已合 main 上线。**
> - 原来照旧页写「Placeholder page for now」，实际导游登录后的 `/guide` 已经是 Bus Manifest 的 Guide view ⇒ 改成「Sees the Guide view of the bus they guide today: the guests on it. Same: no back office.」（`components/users/role-legend.tsx`）。
> - 导游账号怎么开（后端 b7 答，不用改代码）：Settings → Users 建账号、角色 guide；Settings → HR 打开导游档案、Login Account 下拉选上这个账号。导游短信接口 b7 会登记（编号待告知），谁做 Annie 定。
> - Annie 同意 G65（只增不删）上线后 ops 跟：后端 a1 正在上线，等返回形状。
> - 检查：tsc / eslint / build 通过；`users` 套本机没有 `puppeteer-core` 跑不了（老问题），只改了一句文字。

> ✅ **2026-10-15 公司（ba 窗口）`task/driver-text-visible`（worktree `C:\Code\npe-ops-frontend-dt`）：Dispatch Send 页一打开就显示发给司机 / 导游的短信原文（Annie：「还是要显示一下发给司机和导游的内容是什么」，看过预览说「可以」），已合 main 上线。**
> - 起因：Annie 问 Send 给司机的是什么、「看不到这个链接」——原文（`GET /api/dispatch/driver-notice` 的 `text`，后端 `driver_notice.notice_sms`：
>   「NPE: Your manifest for Mon, Oct 5 is ready. Log in to see your bus and guests: https://confirm.nationalparkexpress.com/driver?date=…」）原来要点 Check the list 才出现。
> - 现在 Step 1 下面两格（`relay-panel.tsx` `OutgoingTexts`，用打开这天就拉的 hint）：**Text to drivers** = 原文、网址可点（新标签页）；**Text to guides** =「Guides don't get a text yet — guide logins aren't set up.」（后端确实不发导游）。
>   Check the list 后名单上方那行「Text each driver gets」去掉（不重复）；说明里「Click Check the list to see the exact text」改成只说看名单。
> - ✅ Annie 答：**导游看到的就是 Bus Manifest 的 Guide view** ⇒ 后端其实已有（`/guide` 和 Guide view 同一个模板、同一份数据），缺 `/guide?date=`、导游通知短信接口、导游账号 ⇒ 已发后端 `npe-confirmation-service-b7`（见「需要后端」第一条）。
> - mock 的原文换成后端真实格式；`da` 加一项（没点 Check the list 就显示原文、链接、导游那格）。
> - 检查：tsc / eslint / build 通过；`da` **146 / 146**（3198 空出来后整套跑）。

> ✅ **2026-10-15 公司 `task/dispatch-collapse-completed`（从 main 拉出）：Dispatch Assign 收起没客人的团、Step 2 写人数、Completed 挪到 Step 2 底下 + 两处自动滚动、步骤条左对齐（Annie 看过预览 https://claude.ai/artifact/DNhMaqVGRShZXpSTAWXJES 说「同意」），已合进 main 上线。**
> - Step 1：No guests yet 的团收进最下面一行「▸ N tours with no guests yet — 团名（click to show）」，点开才显示卡片（`manifests-panel.tsx` `EmptyToursToggle`）。
> - Step 2：巴士团跟着 Step 1 收（同一个开关，点哪一行都两边一起开 / 收）；万一没客人的团排了车就不收（Annie：CCL 看 7 days forecast 派车，不会给没客人的团派车，只是保险）。
>   Relay 两轮、Private Tour 不变。有客人的团标题右边「85 pax · 2 vehicles · 1 hotels」。说明后面加「Only tours with bookings need a bus.」。
>   Step 1 没客人的卡点 Assign Bus：Step 2 先展开再滚过去。
> - Completed：从 Step 1 底下挪到 Step 2 底下（`CompletedBar`），用 Save schedule 的蓝（`BTN_BLUE`，原来 `TM_BTN_BLUE` 深蓝在深底上看不见）。
>   Save schedule 存好 → 滚到 Completed；点 Completed → 滚到最上面步骤条、② Send 黄框闪 2 秒，**不切过去、不发东西**（staff 那时不一定要发）。
>   点过显示「Dispatch completed by 谁 · 时间. Next: go to ② Send to send the links to drivers, tour guides and guests.」——⚠️ 导游现在还收不到，等后端（「需要后端」第一条）。
> - 步骤条：第二行小字和 Assign / Send 字头左对齐（圈数字单独一栏）。How to use（Step 1）两条跟着改。
> - 检查：tsc / eslint / build 通过；`da` **145 / 145**（新增：Step 2 收起 / 两边同一开关 / Assign Bus 先展开 / Save 后滚到 Completed / 人数；步骤条三栏）、`mf` **61 / 61**（新增：Step 1 收起、Completed 在 Step 2 用 #3b82f6、步骤条对齐、点 Completed 滚到步骤条 ② Send 闪、Next 那句）。
>   `da-mock.js` 加了 `emptyHoover` 开关。
> - ✅ **（已做，见最上面 `task/dispatch-private-tour-collapse`，Annie 选写法 A）原待做（Annie 2026-10-15：「先收口，private tour 回头再做」）**：Private Tour 当天一台车都没有时也收进 Step 2 那一行（Private Tour 没有 Step 1 卡片 ⇒ 看有没有排车）。
>   提过的写法：「▸ 3 tours with no guests yet · Private Tour (no vehicles) — …」；只剩 Private Tour 时写「▸ Private Tour (no vehicles)」（Annie 还没回）；点开照旧能 + Add vehicle，存了车回到上面。Relay 两轮不收。**动手前先给 Annie 看预览。**

> ✅ **2026-10-15 公司（ba 窗口）`task/broadcast-two-sms`：Tracking 群发最多两条短信的量，超了建议改 Email（Annie：「如果我们允许最多两条信息的量，超过了就建议发email吧」），已合 main 上线。**
> - 三个 Tracking 页共用的 `components/ui/broadcast-dialog.tsx`：上限从 Twilio 的 1600 字改成 **2 段短信**（`BROADCAST_MAX_SMS`，段数照 `lib/sms-limit.ts` `smsSegments`：纯英文 2 条 = 306 字，有中文 / emoji 等 2 条 = 134 字）。
>   计数写「306 chars, 2 of 2 SMS」，超了变红「… 3 of 2 SMS - over the 2-SMS limit for broadcasts. Shorten it or send by Email.」；点发送弹昨天那个建议框（「would go out as 3 SMS … Broadcasts allow up to 2 SMS」+ Yes, use Email only / No, edit the message）。
>   打字不拦（不然到不了建议改 Email 那一步）。字数仍按签名 + 最长的名字 + 展开的日期算。单条对话框（Notes 里回客人）的 1600 字拦截没动。
> - 检查：tsc / eslint / build 通过；`tk` **96 / 96**（加：正好 306 字 = 2 条直接进确认、307 字 = 3 条变红并弹建议）、`tt` 89 / 89、`mt` 139 / 139。

> ✅ **2026-10-15 公司 `task/manifests-row-count`（从 main 拉出）：Main Manifest 单号左边加计数、胶囊数字加 orders，已合进 main 上线。**
>
> - 计数列（表头 `#`）在勾选框和第一列字段之间，不能拖、不进 CSV；每个团（节）各自从 1 排，**按单算**：同一单有几行时只在第一行写号，最后一个号 = 节标题的「N orders」。没分节时整张表从 1 排。三个标签（Bus / Tickets 等）都一样。
> - 胶囊：「15 · 52 pax」→「15 orders · 52 pax」（1 单写 1 order）。上面的标签（Bus Tour 4 · 10 pax）没改，Annie 只说了胶囊。
>   ⇒ **同日 Annie 又改：胶囊里的单数拿掉，只写「52 pax」**（Bus / Tickets 都是，`task/manifests-pill-pax-only`，已合进 main）；上面的标签和节标题照旧有单数。`man` 134 / 134。
> - 检查：tsc / eslint / build 通过；`man` **134 / 134**（加计数列一项；按位置取列的地方往后挪一列；胶囊文字两项改预期）。

> ✅ **2026-10-15 公司 `task/manifests-sent-black`（从 main 拉出）：Main Manifest Tickets 发过提醒的行不再变灰，已合进 main 上线。**
>
> - Annie 截图：Tickets 里一整组都是灰字（「不是已经要求把全域的灰色字体改成黑色了么」）。原因：发过门票提醒的行整行 `opacity-60`，10-14 全站改黑时被当成「灰掉」留着了。
> - 改成字照常黑，整行用发送页统一的淡黄底 `#fff8e1`（同 legacy-ui / manifest-preview）标出发过；后端照旧把它们排到最后。勾选框还是关着（发过的不能再勾，规则没变）。
> - 全站其余整行变灰的只剩停用 / 被取代的行（Products、Pickup locations、Vehicles、Users、Dispatch Imports），是 10-14 Annie 定的「保持灰」，没动。
> - 检查：tsc / eslint / build 通过；`man` **133 / 133**（「发过提醒的行变灰」那项改成查淡黄底 + 字是 `#1a1a1a`）。

> ✅ **2026-10-15 公司 `task/dispatch-steps-search`（从 main 拉出）：Dispatch 步骤条 / 页头说明 / 输入框提示字，Annie 提的三处，已合进 main 上线。**
>
> - 步骤条每块只留两行：去掉 FIRST / THEN 那一行，改成圈数字放名字前「① Assign」「② Send」（当前那块数字琥珀色），下面一行说明不变（`dispatch-view.tsx` `TABS`）。
> - 页头那句「Assign the buses, drivers and hotels and save, then Send…」改黄色（`#fbbf24`，同步骤条当前块的琥珀色）。
> - 输入框点进去提示字就消失：Annie 是在搜索框上提的，做成全站单行输入框一起（`app/globals.css` `input:focus::placeholder`）；多行框（发消息的 textarea）没动。
> - 检查：tsc / eslint / build 通过；`da` 加一项（两行、圈数字、黄色、提示字透明）PASS。⚠️ `da` 这次在 3198 上只跑到 99 项就提前结束（不算失败），同时 main 不带改动也只到 62 项 ⇒ 跑不全是环境原因，不是这次改的，下次在空闲的 3198 上整套再跑。

> ✅ **2026-10-15 公司（ba 窗口）：把 10-14 晚留下的「下次在空闲的 3198 上整套跑 `da` / `man`」跑了**（3198 / 8799 空着）：`man` **133 / 133**、`mf` **56 / 56**、`da` 137 / 138 ⇒
> 没过的是「How to use 写了 Copy 1st Round」：页面的说法在 `fb3e4c2` 按「只有空车也能复制、Send 页也有」改过，测试还认旧句子 ⇒ 只改 `da-test.js` 的预期（`task/da-test-copy-wording`），**`da` 138 / 138**，已合 main。页面没改。

> 🔵 **2026-10-14 晚：Tour Confirmation / Tickets 定时自动发送——方案已和 Annie 定完，写进「需要后端」第一条，等有后端窗口上线就发过去。**
> ops 这边要等后端加 `tour_type`（bus 团默认模板）字段上线才能动手：Products 页加设置项、Manifests 发送弹窗读它预填下拉框。现在没有 ops 能先做的部分。

> ✅ **2026-10-14 晚（家里）`task/tour-color-pipeline`（worktree `D:
pe-ops-frontend-tc`）：团色统一到整条流程（Annie：「把从 main 到 dispatch 到 bus manifest 等所有一系列表格都统一颜色」；预览 https://claude.ai/artifact/4yEJvpbn2UC61wStZZ38Re），已合进 main 上线。**
> - 规则同 `lib/tour-colors.ts`（Antelope 紫、West 橙、Bryce 蓝、South Rim 绿、其他灰）。Main Manifest 表格卡片：左边 5px 团色条 + 团名前色点；Dispatch Step 1 团卡片：团色条（图标已是团色）；
>   Step 2 每个团的车卡片：团色条 + 图标块改团色（原来一律蓝）；Bus Manifest：页面标题前团色方块。
> - Bus Manifest 每台车的大标题带照旧用 **Products → Manifest setup 的团颜色**（Annie 选：以 Products 为准，她自己去 Products 里把各团设成同样的颜色）。后端把这个颜色带到 Manifests / Dispatch 接口后，ops 改成全读它（「需要后端」第一条）。
> - Work Sheet / Guide Sheet（打印）没加团色（问过 Annie，没说要）。
> - 检查：tsc / eslint / build 通过；`man` 133 / 133、`dr` 50 / 50、`mf` 55 / 56（打印链接那项 main 上一样不过，见上一条）。

> ✅ **2026-10-14 晚（家里）`task/soft-white-game-pills`（含 `task/manifests-pill-text`，worktree `D:\npe-ops-frontend-os`）：全站样子一批，Annie 逐项看预览定的，已合进 main 上线。**
> - **白卡片上的灰字改黑**（Annie：「全域白色底板的灰色字体都改成黑色——其他颜色的字体除外」）：说明、小字、表头、数量、时间、空格「—」→ `#1a1a1a`，105 个文件（4 个子代理按目录分组改，规则统一）。
>   **保持灰**：输入框 placeholder、disabled / 灰掉不能点的、停用 / 已取消 / 不会导入的行；彩色字不动；压在深色外框上的字（页面标题旁的数量、翻页、侧栏、顶栏）和整页深色的页面（Dashboard、Morning Tracking、My Workspace 主页）不动；`night:` 一律不动。
>   预览：https://claude.ai/artifact/E59Sx38y65qUmd5hCzaGqP
> - **标题条 / 表头的米灰底改白**，悬停、选中时的浅灰保留（Annie：「当选中或者悬停的时候变浅灰色，不是一直变浅灰」）。
> - **柔和白**（Annie：「白色要柔和一点，不然太刺眼」，选 B）：全站 `bg-white` → `bg-paper`（238 处），颜色在 `app/globals.css` 的 `--paper: #f4f3ee` 一处；打印用的 Work / Guide Sheet（`components/dispatch-sheets`）照旧纯白。
>   以后新写白卡片 / 白表格请用 `bg-paper`，不要用 `bg-white`。预览：https://claude.ai/artifact/MKwSZnfHPmCS3MTk76wPBC
> - **Manifests 组 / 产品按钮**：原来的白色胶囊 → 「游戏按钮」：平涂（Annie：中间不要高光）、底下一道同色系阴影边、悬停微抬、选中按下去（更深、加粗）、黑字；
>   人数数字蓝色 `#0066ff`（Annie 选 ②；先试过她指定的 `#48a0c7`，不够显眼）。浓度「中」。
> - **团色跟着团名走**（`lib/tour-colors.ts`）：Antelope 紫 `#7a6ba8`（Annie 截图取色）、West 橙 `#ee8a2b`、Bryce 蓝 `#3b82f6`、South Rim 绿 `#4c9a5b`，其他和「还没分组」灰 `#8f8c82`。
>   用在 Manifests 按钮、Dispatch Step 1 团卡片图标（原来按顺序轮蓝 / 绿 / 紫 / 橙）。色卡：https://claude.ai/artifact/ScZAL9mhgZuNXUJPGHeYe2
>   ⚠️ 团色以后要以 **Settings → Products → Manifest setup 的团颜色**为准（Annie 选的做法，见「需要后端」第一条）；后端没给之前用代码规则，Annie 自己在 Products 里把各团设成同样的颜色。
> - 顺带修测试：bugs / pl / products 的搜索框选择器限定 `main`（顶栏搜索上线后会先找到顶栏的框）；mf 的「Handled 白键」改认 `bg-paper`；olog 兜底颜色改认黑色。
> - ⚠️ 换 `bg-paper` 时把 `print:bg-white` 也换了（打印底色变米色，sheet 套查出来）⇒ 已改回，打印一律纯白。
> - 检查：tsc / eslint / build 通过；在 3298 / 8899 / Chrome 9433 跑（不占 run-all 的端口）：blog 24、bugs401 1、catchup 27、cs 32、dr 50、fc 60、hr 44、imp 25、man 133、mt 136、nav 25、olog 19、ops 12、orders 23、os 68、pl 41、products 103、ptt 21、sales 13、
>   sheet 24（打印白底修好后）、sheetcmp 4、tb 28、tk 89、tour 54、tsend 43、tt 89、veh 33、ws 56 **全过**。
>   **没过、但用 main 原来的代码跑也一样（不是这批改出来的）**：bugs（展开评论那几项后崩）、da（中途停住）、mf「打印链接：全部 / 单台车」（打印相关代码和 main 一样，没动过）——要另查。
>   teams 套自己起模拟接口、端口写死 8799，没在另一组端口跑；users 套本机没有 puppeteer-core 跑不了。

> ✅ **2026-10-14 晚（家里）`task/send-flow-cleanup`（worktree `D:
pe-ops-frontend-wc`）：Main Manifest → Dispatch → 发送 审计后 ops 自己的几件事（Annie：「第八条做吧」），全部已合进 main 上线（② 看过预览）。**
> - 审计结论（前后端只读）：主线走通、接口字段都对得上；后端卡点 6 条写在「需要后端」第一条（**还没发出去**：Annie 让发 -37，-37 已下线）。
> - ① **发送弹窗的 Pickup time 不再退回 Departure time**（`components/manifests/config.ts` `guestPickupTime`）：补拉不到 `guest_pickup_time` 时宁可空着，不显示比客人收到的早 15 分钟的原时间；补拉的列去掉 `pickup_time`。
> - ② **Morning Relay 发完照全站发送页格式 + ✕ Close + 第 2 轮 Copy 1st Round（Annie 2026-10-14 看过预览第 2 版说「可以」，已合 main）**：
>   - 结果卡片 = Morning Pickup 发送页的 `MorningResults`：五个数字（Sent / Failed / No address / Skipped / To send）+ 这次逐单（单号、名字、电话、接客时间、SMS / Email 状态）。只是这次的结果，不是 Send Log。
>     「以前发过」只加进 Skipped（修了被算进 Failed、显示 -2）。右上角 ✕ Close 收起；没有 Not selected / Send Another。
>   - **Copy 1st Round**：原来只在 Assign、而且第 2 轮一台车都没有时才出现（Annie 那天第 2 轮有一行空车 ⇒ 键藏起来了）。
>     现在「没选车也没选司机」的空车算没排（`config.ts` `isBlankRow`），照样给复制、空车被换掉；排过车或司机的不盖掉。
>     Send 页第 2 轮旁边也有这个白键：复制后切回 Assign，绿条提示「Check them, click Save schedule, then go back to Send and pull again」。不存不生效。
>   - 预览网页：https://claude.ai/artifact/GwBpyncmBWQoApFF7zGoPb
>   - 合并后检查：tsc / eslint / build 通过；puppeteer 对模拟接口点一遍 **8 / 8**（Copy 键白色、结果数字 1,0,0,2,1、逐单表、发送请求仍只送日期和轮、✕ Close、Copy 后切回 Assign + 提示 + unsaved、
>     2nd Round 有复制来的车、Copy 不自己存）。⚠️ 完整 `da` 套这次在这台机器上起不来（它自己拉起的 Chrome 调试连接一启动就静默退出，和改动无关）；`da-test.js` 已加 ✕ Close / Copy 两项，下次在 3198 整套跑。
>     「第 2 轮只有空车」那种情况模拟接口里没有现成数据，没单独点过（逻辑：没选车也没选司机 = 空车，`isBlankRow`）——**线上 Annie 验收时看一下**。
> - ③ Users 页 Supervisor 照旧页面：徽章 `#e0e7ff` / `#3730a3`、头像 `#4338ca`，底部说明和 How to use 那句照旧页面原文（后端 82 已上 `ee101a8`）。
> - ④ PROGRESS 清理：减 15、supervisor 两条「需要后端」改成 ✅。
> - 检查：tsc / eslint / build 通过；`users` **42 / 42**；针对改动的小检查（Manifests：没有 guest_pickup_time 不显示 7:00 / 7:15、有就写 6:45）**2 / 2**；Relay 分支的小检查 3 / 3。
>   ⚠️ **完整的 `da` / `man` 套这次没跑通**：3198 / 8799 被别的窗口占着、改用 3196 / 8797，机器上几个窗口同时在编译，套里固定等待时间不够，开头几项就超时（和改动无关的地方）。
>   `man-test.js` 已按新行为改了预期（6:45 / 不退回 7:00；`da-test.js` 的 Relay 结果表预期在 relay 分支上），**下次在空闲的 3198 上整套跑一次**。

> ✅ **2026-10-14 晚（家里）`task/order-search-name-phone`（worktree `D:\npe-ops-frontend-os`）：顶栏订单搜索按单号 / 客人姓名 / 电话三选一（Annie 要的；预览第 9 版 https://claude.ai/artifact/GNfogCDgfDztbYDfgx46JB，Annie 说「继续」），已合进 main 上线。**
> - 不改后端：用 Orders 页同一个 `GET /api/operations/orders?q=`（后端逐列 ILIKE：单号、名、姓、邮箱、电话、产品名），`page_size` 200（`fetchOrders` 加了 pageSize 参数，Orders 页照旧 50）。
>   前端只留单号 / 姓名 / 电话对得上的（产品名、邮箱碰巧对上的不算），按单号去重（新表一单多行）。`lib/order-lookup-api.ts` `searchOrders`。
> - 姓名带空格（名 + 姓）原样搜不到 ⇒ 用最长的词再搜、按全名过滤；电话格式不同 ⇒ 依次用纯数字、最后 4 位再搜、按数字过滤。
> - 只有一张单或单号完全一样 ⇒ 直接打开（同原来）；好几张 ⇒ 浮窗里先列名单（单号、客人、电话、产品、团期、状态彩色字），点一行打开，上面「← Back to N matches」回名单。
>   超过最近 200 条提示「Type more … to narrow it down」。提示文字改成「Order #, guest name or phone」。
> - 顺带修测试：`orders` 套原来用 `input[type=search]` 找页面搜索框，顶栏框上线后先找到顶栏那个 ⇒ 改成 `main input[...]`（页面本身没问题）。
> - 检查：tsc / eslint / build 通过；`os` **68 / 68**（加了姓名 / 电话 / 名单 / Back / 产品名不算）、`orders` 23 / 23、`dr` 50 / 50、`nav` 25 / 25（3298 / 8899 / Chrome 9433 跑）。

> ✅ **2026-10-14 晚（家里）`task/order-lookup-tickets`（worktree `D:\npe-ops-frontend-os`）：订单查询搬到顶栏 + 问候语进顶栏 + 门票块加 Cfm # / Check-in location，Annie 逐版看预览定的（https://claude.ai/artifact/GNfogCDgfDztbYDfgx46JB 第 1–8 版），已合进 main 上线。**
> - **搜索框在顶栏右上角**，用原来照旧后台搬的那个假搜索框的位置（`components/order-lookup/top-order-search.tsx`，AppFrame 里的 `OrderLookupProvider` 管状态）。所有有顶栏的页面都有，**三个发送页也有**（Annie：要；旧后台在发送页藏掉假框，现在框能用了）。三个 Tracking 页本来没有顶栏，没有搜索框。
>   样子：1px 亮黄细线框（`rgba(251,191,36,.8)`）、底色很淡、四角 6px、框里的提示文字和 ⌕ 是白色高亮（Annie：显眼一点、角方一点、不要底部加粗线、黄线高亮就好、字换成白色高亮——最后一条 `task/search-white-text`）。窄屏只露一个黄框 ⌕ 键，点了输入框铺满顶栏一行。
> - **结果一律在页面正中间的浮窗**（Annie 选 B，dashboard 也一样），背后整页变暗；上下各一个「✕ Close」（Annie 要的），点暗处 / Esc / 换页也关；再点输入框重开上次的结果；Clear 清空。浮窗挂在 body 上（顶栏有 backdrop-blur，fixed 放顶栏里会被困在 64px 里）。
> - **dashboard 问候语进顶栏**：顶栏左边「Good morning, 名字」+ 日期（Annie：问候语不需要那么多位置），页面上原来的大标题和说明拿掉，发送卡片直接往上。dashboard 页面里原来那个 Order lookup 框拿掉。
> - 门票块加 **Cfm #**（产品名后面）和 **Check-in location**（整行；**要后端**，见「需要后端」第一条，后端没给时不显示这一格）。
> - 检查：tsc / eslint / build 通过；`os` **58 / 58**（顶栏框、黄细线、问候语、浮窗居中 / 变暗 / Close / Esc / 暗处 / 里面点不关 / 重开、Clear、发送页也能查、Open tracking 换页……）、`dr` 50 / 50（问候语那条改成查顶栏）、`nav` 25 / 25（发送页现在有搜索框）、
>   `ws` 56 / 56、`tt` 89 / 89、`tk` 89 / 89、`mt` 136 / 136（都是 `--skip-poll`）。这次在 3298 / 8899 / Chrome 9433 跑（3198 上挂着主目录别的窗口的 dev），套的复制品跑完已删。

> ✅ **2026-10-14 晚（家里）`task/supervisor-role`（worktree `D:\npe-ops-frontend-wc`）：Users 页先认 supervisor 角色（Annie 10-14 定，后端 7c 还没做），写成兼容的，已合进 main 上线。**
> - 后端没上线时页面**和原来一模一样**：判据是 `/api/me` 有没有 `is_supervisor` 字段（`components/users/config.ts` `supportsSupervisor`）。
> - 后端上线后：superadmin 的 Role 下拉多一项 **Supervisor**（Admin 和 Staff 之间），改它没有外勤那种红色警告；徽章 / 头像玫红（`#be185d`，旧页面没有这个角色，挑了和其他五个都分得开的颜色）；
>   底部角色说明多一句「Everything Staff can do. Will also manage the daily task list, the staff schedule and daily report follow-ups once those pages open. Cannot access Settings or Users.」。
> - 检查：tsc / eslint / build 通过；`users` 套加了 9 项（没上线时没有选项和说明、上线后选项顺序、说明、改成 supervisor 无警告、POST body、admin 看到徽章），**全部通过**。
>   本地 3198 / 8799 被别的窗口占着，这次用临时复制的套在 3196 / 8797 跑的（复制品已删）。
> - 7c 做完要核对：`/api/me` 字段名是不是 `is_supervisor`、改角色接口收的值是不是 `supervisor`；不一样就改 `config.ts` 一处。

> ✅ **2026-10-14 晚（家里）`task/dashboard-order-search`（从 main 拉出，worktree `D:\npe-ops-frontend-os`）：dashboard 加「Order lookup」订单查询窗口（Annie：「输入订单号之后呈现订单详情和现在的状态——operation system 里的状态，就是 tracking 页面的简要」），已合进 main 上线。**
> - 位置：dashboard 发送卡片下面、My shortcuts 上面（`components/dashboard/order-lookup.tsx`）。新功能，旧 dashboard 没有，不受「和旧版一模一样」约束；想挪位置只改 `dashboard-view.tsx` 一行。
> - **不用新接口**：后端没有「按单号查 Tracking」，`lib/order-lookup-api.ts` 先调 `GET /api/operations/orders/{单号}`（Orders 详情页同一个）拿团期，
>   再拉那天的 Tour / Tickets / Morning 三张 Tracking 表、按单号（不分大小写）挑出这一单。全部只读。输入小写查不到时再按大写查一次。
> - 显示：订单（单号、Rezdy 状态、产品、团期 + 时间、客人、人数、电话、邮箱、接客、司机 / 车、确认号、代理商，右上「Order details →」去 `/orders/单号`）；
>   下面每条线一块——Tour：客人回复（YES / Modify / Modified / Pending / Cancel）、SMS、Email、Submitted、午餐、MTLV、消息（⚠️ Needs action / 谁处理过）、最新一条消息；
>   Tickets：回复、产品、Check-in / Tour 时间、SMS、Email、Submitted、消息；Morning：签到、接客、司机 / 车、SMS、Email、客人看过车辆链接没有、消息。
>   这天表里没有的线只写一行灰字；三条都没有写「Not on any tracking list for <日期> yet」；某条线拉不到只在那块写原因。状态是普通彩色文字，不做胶囊；Search 键不用蓝色（不是提交）。
> - 每块右上「Open tracking →」带 `?date=团期&q=单号`：三个 Tracking 页新读 `?q=`，搜索框预填这一单（读完从地址栏去掉，`lib/utils.ts` `takeSearchParam`）。
> - ⚠️ 已知局限：一单多个产品（`item_count` > 1）只按第一个产品的团期查，页面上有一行黄字说明；没有团期的单写明对不上 Tracking。
> - 检查：tsc / eslint / build 通过；新套 `os` **43 / 43**（字段、三条线的状态和配色、大小写、YYYY-MM-DD 团期、没团期 / 都没有 / 一条线失败 / 查不到 / 出错 / Clear / Enter、
>   三个 Tracking 页 `?q=` 预填和去掉、401 跳登录）；`tt` 89 / 89、`tk` 93 / 93、`mt` 139 / 139、`dr` 50 / 50。截图看过（模拟数据，宽屏和 420px 窄屏）。**没有连真实后端测**——线上验收时查一张真单对照 Tracking 页。

> 🔵 **2026-10-14 16:0x（家里）开工**：main 拉到 `dd26929`、依赖没变。只读看了后端 main `ae4a427..f196e00`：`d4ae671` 交接（E189 Tracking 日期按 UTC 只登记）、
> `8de88d2` 登记 G63–G65（Category = **G64**）、`f196e00` **G66** My Workspace + Transfer & Charter Quotation（前端将在 ops 新 Dashboard 做，**任务包是草稿、等 Annie 批 W1–W10**）——都没有接口，ops 暂无要跟的。
> ①「需要后端」第一条（减 15 / Pickup time / Relay 第 2 轮）✅ 已发后端；**Annie 定由 `npe-confirmation-service-7c` 做**（37 不再碰），字段名和接口形状由 7c 发来。**以后后端需求发 7c。**
> ② Tracking ③ 补录弹窗：Annie 说「跟旧页面一样」⇒ 已做，见下一条。下次看后端从 `f196e00` 往后。

> ✅ **2026-10-14 晚（家里）`task/my-workspace`（worktree `D:
pe-ops-frontend-ws`）：G66 My Workspace 第一期 ops 前端，Annie 看预览通过（https://claude.ai/artifact/1qPo9G48qUzUFp1E4MHH82），已合进 main 上线。**
> - 后端已上 main / 生产（confirm `9392bf5`，migrate_v91 已跑）。设计照后端仓库 `docs/previews/my-workspace-2026-10/` 的可交互预览；接口问题找 `npe-confirmation-service-37`。
> - `/workspace`：粘贴 / 上传（类型、大小在页面上先查；.xls / .doc 提示另存）→ 选去向 → Generate → 跳到工作项；My work：Mine / Whole team、Open + 每个状态的筛选带数量，Done / Cancelled 默认不显示。
> - `/workspace/[id]`：客户 / 主题、状态、下一步（Save）；Reassign（记谁、何时）；读取失败黄框 + Read again；原文 + 附件下载；历史。审核页（读出的服务、价格）是第二期 Transfer & Charter。
> - `/settings/workspace`（admin）：去向、状态（Draft 不能停用 / 关闭）、General（前缀、上限 MB、类型），每行自己的 Save。后端 PUT general 回 upload_max_bytes，`saveGeneral` 换回 MB。
> - 入口：侧栏 Operations 第二项 My Workspace（黄点，能钉到 My shortcuts）、Settings 组加 My Workspace。**dashboard 上没另放入口**（问过 Annie，没答，先只放侧栏）。后端 nav-config 种子里还没有 workspace，`resolveNav` 会把它补在 Operations 末尾，superadmin 可在 Settings → Navigation 挪。
> - 和任务包预览不同（预览页写给 Annie 看过）：状态用彩色字不做胶囊；选中用黄框不用蓝；线上 tcq 关着 ⇒ staff 看到「Nothing is turned on yet」，Annie 在设置里打开才出现。
> - 所有客人内容按普通文字渲染（`ws` 套有 `<img onerror>` / `<script>` 不执行的检查）。
> - 检查：tsc / eslint / build 通过；新套 `ws` **56 / 56**；`dr` 50 / 50（侧栏条目多了 workspace，改了 3 处预期）、`nav` 25 / 25、`imp` 25 / 25、`fc` 60 / 60、`tour` 54 / 54、`da` 135 / 135。
>   ⚠️ 这次在另一组端口跑（dev 3298 / mock 8899 / Chrome 9433，`ws-mock.js` 认 `MOCK_PORT`），因为 3198 上挂着主目录的 dev（f8 的）；先在 3198 跑的一轮连到了别人的代码，作废。

> ✅ **2026-10-14 晚（家里）`task/greeting-name-only`：名字只留问候语 + My shortcuts 当别的页面的顶部导航 + 每页 ← Back + Dashboard 区块顺序（Annie 2026-10-14，preview 改了两版，第二版 Annie 说「可以」），已合进 main 上线。**
> - Annie 的话：「太多地方显示名字也就没意义了，dashboard 就留问候语是名字就好了，然后把问候语的字体改大一点」；「把 my shortcut 放到 4 个发送框上…进入其他页面后 Dashboard 永远默认为第一个。然后把 message 排到 todays tasks 上面」；
>   第一版（shortcuts 在每页都是一条、dashboard 也是）被否：「在 dashboard，你要用原来的格式，叫 my shortcut，给 staff 选择放哪些 icon 进来，只有当 staff 点击进其他页面时这行 shortcut 才变成置顶的导航。然后每个页面还是要安排一个返回上一页的按键」。
> - 做了：
>   - **Dashboard**：问候语 15 → 20px；区块顺序 My shortcuts（原来的虚线框，`shortcuts-section.tsx` 不变）→ 发送卡片 → Messages → Today's tasks → Daily Operation Report（`dashboard-view.tsx`）。Dashboard 上没有导航条。
>   - **别的页面**（套外框的都算）：顶栏下面一条 `components/nav/shortcut-bar.tsx`，和顶栏一起 sticky 钉在上面：最左 **← Back**（站内点过来的 `router.back()`；直接打开 / 刷新过的回 `/dashboard`，用 `in-app-history.tsx`），
>     然后 **Dashboard 固定第一个**（不能删、不能拖），后面是同一份 shortcuts（同 `useNav`，改了两边一起变）：拖动排序、× 删除、从侧栏拖进来，右边 Reset；当前页那格蓝边。
>   - **侧栏**：「Operations Center」下面那行名字拿掉；底部账号卡片（缩写、名字、角色 + Sign out）留着。
> - preview 网页：https://claude.ai/artifact/DwjhzXswRyTPevpr3mtBPu
> - 检查：tsc / eslint / build 通过；`dr` **51 / 51**（改：区块顺序；加：dashboard 没有导航条、问候语 20px）、`nav` **29 / 29**（加：导航条在顶栏下、← Back 和 Dashboard 在前、sticky、侧栏顶部没名字、直接打开点 Back 回 Dashboard）。
> - **全量回归（除 users）**：除 `bugs` 外全过（catchup 27、cs 32、mf 56、mt 139、olog 19、pl 41、products 103、tb 28、da 135、man 132、os 68、tt 89、tk 93、teams 54、ws 56 …）。
>   修了的测试（都是测试找错了元素，页面没问题）：导航条也有「Reset」「← Back」⇒ catchup / olog 的 `$btn('Reset')`、cs 的「← Back」改成只在 `main` 里找；
>   **顶栏订单搜索框（`type=search` + `<form>`，另一个窗口 18:33 上线）** 让 bugs / tb / pl / products 的「第一个搜索框」、mf 的「第一个 form」找到顶栏 ⇒ 改成 `main` 里的。
>   ⚠️ **`bugs` 3 项没过、不是这次弄的**：「展开才拉评论和任务详情」「描述、最新一条」「附件配到最新一条评论」——把这次改动整个拿掉照样 37 / 40；截图看 Bug Reports 页本身正常（展开、评论、附件都在），像是测试 / 模拟接口跟不上，下次查。
>   🔍 **2026-10-16 查过（8c 窗口，只读定位，未修）**：是 `bugs-test.js` 等的时机不对，不是页面 bug——点开卡片后 `waitFor` 等的是「评论历史」这个标签文字，这段文字在面板刚挂载、还在 loading 状态时就已经渲染（不依赖评论 / 任务详情请求是否返回），所以比 mock 接口收到请求还快就通过，接着立刻去查 `mockLog()` 时请求还没记录上。
>   要改成等真正依赖请求结果才出现的内容（例如评论正文「Amy: looking」）再去查 log，而不是等那个标签文字。挂起未修，下次接着做从这里改 `bugs-test.js` 展开那一段即可，不用重新定位。

> 🟢 **收工交接（2026-10-14 晚 23:xx，家里，f8 / 现在叫 ops-89 窗口）**：本窗口今晚的改动都已合进 main 上线，没有 WIP 分支；本机 3198 / 8799 没有本窗口的进程。
> - 今晚上线（都 preview 过、Annie 说「可以」）：Manifests 窄标签、搜索框写哪一天、顶栏拿掉名字 + 搜索框 phone #、**名字只留问候语（20px）+ My shortcuts 在别的页面变顶部导航（← Back、Dashboard 第一个）+ Dashboard 区块顺序**；之前：Manifests 换列顺序、减 15 对齐、补录弹窗照旧页。
> - **新规矩**：新功能、页面设计调整一律先 preview（Artifact 网页链接，不发本地路径），Annie 同意了再动手（CLAUDE.md 已写）。preview 网页 https://claude.ai/artifact/DwjhzXswRyTPevpr3mtBPu 。
> - 等 Annie：线上看 Products → Bus Manifest setup 第 8 项每团的 Morning Relay round 设对没有；线上看 Dashboard / 顶部导航。
> - 待查：上面 `bugs` 那 3 项；Content Studio 页自己也有「← Back」，现在一页上有两个 Back（导航条一个、页面里一个），Annie 没提，留意。
> - 测试端口：几个窗口共用 run-all 的 3198 / 8799 会互相打断；`-76`（worktree `-os`）改用 3298 / 8899 / 9433。开跑前先看端口。
> - 下次开工：`git fetch --prune`、从 main 拉；看后端 main 从 `9102912` 往后（G66 My Workspace 由做 Order lookup 的窗口接）。

> ✅ **2026-10-14 晚（家里）`task/header-name-search-text`：顶栏拿掉右边的登录名、订单搜索框灰字 phone 后面加 #（Annie：「把右边这个名字拿掉，然后在框里的 phone 后面加 #，保持文字格式的整齐」），preview 过、Annie 说「可以」，已合进 main 上线。**
> - `components/nav/app-frame.tsx`：顶栏右边只留 `TopOrderSearch`（侧栏底部仍有名字）。`components/order-lookup/top-order-search.tsx`：灰字 `Order #, guest name or phone #`（aria-label 没动）。
>   ⚠️ 顶栏搜索框是做 Order lookup 的窗口（worktree `D:\npe-ops-frontend-os`）的活，以后改那个文件别把「phone #」改回去。
> - 检查：tsc / eslint 通过；`nav` 25 / 25（改：顶栏有搜索框、不写登录名）、`os` 68 / 68（改：灰字带 #）、`man` 132、`dr` 50。

> ✅ **2026-10-14 晚（家里）`task/manifests-search-hint`：Manifests 日期旁边的搜索框写明搜哪一天（Annie：「需要在框里标注一下是搜今天的订单」），preview 过、Annie 说「可以」，已合进 main 上线。**
> - 灰字 `Search Oct 14 orders: #, name, phone, email…`，日期跟着所选的那天变（搜的是所选日期、不一定是今天，已跟 Annie 说明）；框 260 → 300 宽（`manifest-search.tsx` `dayLabel`）。
> - 检查：tsc / eslint 通过；`man` **132 / 132**（加：灰字跟日期）。第一次跑超时是机器忙（一页 73 秒加载），重跑正常。

> ✅ **2026-10-14 晚（家里）`task/manifests-tab-compact`：Manifests 标签改窄（Annie：「框做得实在太大了…bus tour 和数字完全可以并排，框做窄一点，preview」），preview 给 Annie 看过、她说「可以」，已合进 main 上线。**
> - 名字和「单数 · 人数 pax」同一行，框只有文字那么宽、和普通按钮差不多高（14px），两个框连在一起；选中的黄边 + 浅黄底 + 底边 2px 黄线，没选中的灰框。下面那条大框的版本被取代。
> - preview 网页：https://claude.ai/artifact/DwjhzXswRyTPevpr3mtBPu（截图对比，模拟数据）。
> - **新规矩（Annie 2026-10-14，已写进 CLAUDE.md「已定的决策」）：新功能、页面设计调整一律先 preview，Annie 同意了再动手。** 这次大框就是没 preview 直接上线、被 Annie 说了。
> - 检查：tsc / eslint 通过；`man` **131 / 131**。

> ✅ **2026-10-14 晚（家里）`task/manifests-tab-boxes`（已被上面的窄框取代）：Manifests 的 Bus Tour / Tickets 标签改成 Dispatch Assign / Send 那样的黄框（Annie：「能不能像 dispatch step 那样黄色框」），已合进 main 上线。**
> - 两个并排的框（窄屏上下排），选中的黄边 + 浅黄底 + 底边黄条，没选中的灰框；大字标签名、下面一行「单数 · 人数 pax」（`manifests-view.tsx`，样式同 `dispatch-view.tsx` 的 tablist）。文字没变，只换样子。
> - 检查：tsc / eslint 通过；`man` **131 / 131**（加：选中的黄边和底边黄条、没选中的没有）。截图看过（模拟数据）。

> ✅ **2026-10-14 晚（家里）`task/manifests-col-order`：Manifests 换列顺序（Annie：「我最后加了 pick up time，就被排到最右边了」「在 columns 的勾选页给我一个拖拽的选项，一行排列出来，把这些 box 拖到我要的位置」），已合进 main 上线。✅ Annie 线上验收：「好了，非常棒」（10-14 晚）。**
> - **☰ Columns 弹窗**顶上加「Column order」一排：勾了的列按现在的顺序排成带序号的小格（`field-picker.tsx`），拖格子换位置（往左落在前面、往右落在后面），✕ 取消勾选；**Apply 才存**（同原来）。格子和落点线用灰色，不用蓝。
> - **表头也能拖**（先做的，Annie 提议弹窗前已做好，留着）：拖表头到别的表头上换位置，马上存进账号（`manifest_cols_bus` / `_tickets`）；存不上改回原顺序、写原因（`manifests-view.tsx` `reorderFields`）。Annie 不要就删这一块。
> - How to use 一条、弹窗说明一句。新功能，旧页面没有。
> - 检查：tsc / eslint / build 通过；`man` 加了拖表头 5 项、Column order 8 项（排序、左 / 右落点、✕、没 Apply 不存、Apply 按格子顺序存、拖回原顺序）。

> ✅ **2026-10-14 晚（家里）`task/pickup-minus15-ops`：跟后端 7c「减 15」的接口形状先做 ops（后端代码在审、还没上线：Annie 要先跑 migrate_v90 再推），写成兼容，已合进 main 上线。**
> - 7c 发来的 Annie 10-14 新定：**Morning Relay 按团分轮、不按时间**（Antelope / BZ / South Rim = 1st，West Rim = 2nd；Products → Bus Manifest setup 里每团设；没设的团不进 Relay、也不进 Need a look；两段时间只当提示）；
>   **第 2 轮「Copy 1st Round」只在页面上复制、照常 Save**（`POST /api/dispatch/day` 不变），第 2 轮已有车时不给。
> - ops 做了：
>   - **Dispatch Step 2**：2nd Round 没车时空白处多一个白键「Copy 1st Round」（和 + Add vehicle 并排）⇒ 第 1 轮每台车（车、司机、酒店）复制成第 2 轮新行、没存；How to use 加一条。同一司机在两轮不算重复（重复检查按块算）。
>   - **Relay 面板说明**改成按团分轮、Need a look 三个新原因（`relay-panel.tsx`）。后端上线后又照旧页面的新说明逐字改过（见下面「后端已上 main」）。
>   - **Manifests 团确认弹窗**名单：表头 Pick-up time → **Pickup time**；补拉的列加 `guest_pickup_time`（后端没上线时不认、放 unknown 不报错），有这一列就用它（读不出 = 空，不退回发车时间），没有就照旧 `pickup_time`（`config.ts` `guestPickupTime`）。
>     send-tour 新的 400 原话 ops 照常写在弹窗里，不用改。
>   - **Products → Bus Manifest setup**：接口有 `relay_rounds` 时多第 8 项「Morning Relay round」下拉（Not on Morning Relay / 1st / 2nd），选了就 `PUT …/groups/{id}/relay-round`，失败写原话、改回已存的值；
>     右边 Dispatch 示意多一块（8），写这团在哪一轮 / 不进 relay；How to use 加一条。**后端没上线时整项不显示**（7 项照旧）。
> - 检查：tsc / eslint / build 通过；`products` **103 / 103**（8 项顺序、下拉三项、PUT relay_2 / 空串、失败改回、指到亮、没 relay_rounds 时不显示）、`da` **135 / 135**（Copy 键白色只在 2nd Round、复制后一样、键消失、Save 多一行 relay_2）、
>   `man` **118 / 118**（模拟接口开 minus15：表头 Pickup time、CHD1001 6:45、读不出的空着；关着照旧 7:00）、`tt` 89、`tk` 93。
> - ✅ **后端已上 main `9102912`（migrate_v90 已在生产跑过，7c 10-14 晚通知）**。线上接口要登录，ops 窗口登不了 ⇒ 对着后端 main 代码只读核对：
>   `guest_pickup_time` 读不出时是**空串、键一直在**（`pickup_time.py` + `values_for`）⇒ 名单不会退回发车时间，不用改；`relay_rounds` / `relay_round` 形状一致，PUT 清空回 `""`（GET 里是 null，ops 两种都认）；
>   Need a look 新原话 ops 照接口显示。旧页面说明改了 ⇒ ops 照抄：Relay 面板 How to use（按团分轮、没轮的团不进、显示和发出去的是 Rezdy 减 15、别自己减）、Setup 的 How to use 那条。
>   模拟接口跟着改（PUT 清空回 ""、400 原话、Need a look 新原因）。
>   ⚠️ 7c：有一个账号存过 Bus 列表的列，里面是 Departure time，要手动勾上 Pickup time。**请 Annie 在线上 ops 看 Manifests、Dispatch Relay、Products → Bus Manifest setup。**
>   ✅ 那个账号就是 Annie 的：她在 ☰ Columns 勾上 Pickup time 后已看到（10-14 晚）。不做「自动把 Pickup time 加进存过的列」。

> ✅ **2026-10-14 晚（家里）`task/tracking-upload-legacy`（从 main 拉出）：Tour / Tickets Tracking 的 ⬆ Upload 补录弹窗改成和旧页一样（Annie：「补录的就跟旧页面一样吧」），已合进 main 上线。**
> - 共用新组件 `components/ui/import-dialog.tsx`（两页原来各写一份），`tour-upload-dialog.tsx` / `tickets-tracking/upload-dialog.tsx` 只给标题、下拉、列。照旧 `tracking_tour.html` / `tracking_tickets.html` 的 imp-*：
>   ① 小弹窗（420 宽）标题「Select Tour Type」/「Select Tour / Operator」、Cancel + 蓝色 Continue；Continue 后选团弹窗关掉、直接弹系统选文件（选文件框点取消 = 整个补录结束）；
>   ② 「Upload to List」预览（1150 宽）：标题后同一行写「团名 · N row(s) · N new · N already in list」，右上「Insert anyway (all)」；已在列表的**整行淡黄 `#fff8e1`** + 橙标签「Already in list」（`#F5C36B`），逐行 Insert anyway；
>   读文件时表里写「Reading file…」、解析失败红字写在表里（同旧页，原来是退回第一步）。门票标题后只写所选产品（「Ken's Tours」，同旧页 option 文字，原来带分组名）。
> - 和旧页仍不同（登记过的 36 / 126 条）：没选团点 Continue 写红字「Select a tour type.」、插入结果写在弹窗里，不用 alert。
> - 检查：tsc / eslint / build 通过；`tt` **89 / 89**、`tk` **93 / 93**（新加：第一步标题 / Continue、没选团提示、Continue 后弹窗关、整行淡黄 + 标签颜色、失败红字在表里、门票标题后的产品名）。截图看过（模拟数据）。
>   `tt` 测试的 `goto` 改成等新页面换上来再往下（原来只睡 300ms，dev 慢时偶发读到上一页 ⇒「默认洛杉矶今天」「按 ?date= 查」失败）。

> 🟢 **收工交接（2026-10-14 13:4x，公司，减 15 讨论窗口；今天收工线 14:30，Annie 经 e2 转达）**：本窗口只改了 PROGRESS（都已推 main），没有 WIP、没有代码改动。
> - 今天和 Annie 定了「接客时间 = Rezdy 发车时间减 15，Main Manifest 的 Pickup time 是唯一口径」，连带 Dispatch 早班分轮改法 ⇒ 全部在「需要后端」第一条（①–⑤），**还没发后端窗口**，下次开工先问 Annie 要不要直接发 e2。
> - 查到的两个线上漏洞（Manifests 发 Tour Confirmation、Dispatch 发早班都没减 15）也在那条里；Dispatch 那个可能已影响在发的早班，建议后端先做。
> - 本机：主目录 `C:\Code\npe-ops-frontend` 有别的窗口在用（今天 `d043d5b` 是它合的），别动它的改动；`.next-diag/` 是 10-09 的旧构建产物，eslint 会扫到它报 6 个 error，可删。

> 🟢 **收工交接（2026-10-14，公司，ba 窗口；今天收工线 14:30 PT，Annie 经 e2 转达）**：本窗口做的都已合进 main 上线（`d043d5b`，见下一条），没有 WIP 分支；本机 3198 / 8799 没有本窗口的进程。
> - 等 Annie：① Tracking ③ 补录弹窗（Tour / Tickets 的 ⬆ Upload）要不要改回旧页「先选团 → Continue → 选文件 → 预览」两步、已在列表的行整行黄底（ops 现在一个弹窗、灰字胶囊）；② 线上看 Forecast 的「-」和群发超长的 Email 建议；
>   ③ 旧页「勾了 SMS 时超长打不进去」要不要也加（和「建议改 Email」冲突，现在没加）。
> - 等后端：G63（Forecast 数据）、G64（Category）、G65（G35 只增不删）、G61 / G62（Relay / 群发 Send anyway）——都只登记、还没人做，接手的会先给 ops 接口形状。
> - 工作区里的 `.next-diag/` 不是本窗口建的，没动。
> - 下次开工：`git fetch --prune`、从 main 拉；看后端 main 从 `8de88d2` 往后。

> ✅ **2026-10-14 公司（ba 窗口）`task/forecast-closed-dash`（从 main 拉出）：Forecast 不开团标「-」+ 群发超长建议改 Email，已合进 main 上线。**
> - Annie 对昨天几件待定事的答复：
>   - Forecast 对照 CCL 表的行**都要做**；库存 / Max allotments **在 Products 设上限、自动算剩余**；不开团的日子**在 Products 设**；Crew notes 和车号红字（没 GPS）**staff 在 ops 填**；
>     Notes 行要用来表示导游 confirmed，**Annie 回头自己设计，先占位**（现在就是占位，不动）。这些都要后端，已直接发 `npe-confirmation-service-e2`（见「需要后端」第一条）。
>   - **不开团的日子标「-」不标 0**，一眼分清没开团和没销售。现在只能认 CCL Discord 写 Closed 的天 ⇒ 先做了这部分：粗体行和分项在那天写「-」；
>     Closed 却有人订（不该有）照样写人数，不藏（`config.ts` `isClosedDay` / `cellValue`）。Products 设开团日的接口来了以后，`isClosedDay` 加上它。How to use 加一条。
>   - Tracking ①（对话框没电话 / 邮箱）：**客人至少有电话或邮箱一项** ⇒ 两个都没有不会发生，ops 现在的做法（缺的那一路灰着不勾、另一路照发）保留，不改。
>   - Tracking ②（群发超长）：照旧页显示字数上限（ops 本来就有：`N / 1,600 chars, N SMS`、超了变红）；**超过上限时建议改发 Email、问 staff 愿不愿意**（Annie 新要的，旧页只是拦下叫你删短或自己改渠道）：
>     点 Send broadcast ⇒ 红框「This message is too long for SMS (…) We suggest sending it by Email only. Would you like to switch to Email only?」，没有邮箱的人数会写出来；
>     「Yes, use Email only」⇒ 渠道换成 Email only、进正常确认；「No, edit the message」⇒ 回去改。三个 Tracking 页共用 `components/ui/broadcast-dialog.tsx`。
>     旧页「勾了 SMS 时超长的字打不进去」**没照做**：打不进去就到不了「建议改 Email」这一步，和 Annie 要的冲突（要的话再加）。单条对话框的超长拦截没动。
>   - Tracking ③「补录弹窗」：Annie 问是指什么，已在对话里解释，等她回。
>   - Settings → Products 组改短名 / West-Sunset 独立组：Annie 说「对」（她自己在 Products 做）。
>   - 「等后端」的几件（Category、Morning Relay / 群发 Send anyway、G35 只增不删）：Annie 让 ops 直接发后端 ⇒ 已和 Forecast 的需求一起发 e2。
> - 检查：tsc / eslint 通过；`fc` **60 / 60**（加：Closed 那天 West Rim 粗体行和分项都是 -、别的 0 照旧；Closed 却有人订照样写 18）、`tk` **91 / 91**（超长改成：弹建议框、No 回编辑渠道不变、Yes 换 Email only 进确认）、`tt` 85 / 85、`mt` 139 / 139。

> 🟢 **收工交接（2026-10-14，家里，Forecast / Tracking 窗口）**：今天的改动全部已合进 main 上线（最后 `c156530`），没有 WIP；本机 3198 / 8799 没有进程。
> - 今天上线：三个 Tracking 页拖列宽 + 自动列宽、全站屏幕底部横向浮条（`1362f44`）；三页逐项对照旧页改回没登记的差异（`c156530`），详见下面两条。
> - 等 Annie：① Tracking 下面那条「没改、等 Annie 定」的 ①②③（对话框没电话 / 邮箱时怎么发、群发超长和确认、补录弹窗样子）；② 线上看 Tracking 的拖宽和底部滑条；
>   ③ 前一天留的：Settings → Products 组改短名 + West-Sunset 独立组（见下面 10-13 的 🟡）、CCL 对照改指 West-Sunset 转后端（「需要后端」第一条）、Forecast 占位行的数据从哪来。
> - 检查环境：`users` 套要 `puppeteer-core`，本机（主目录和 worktree）都没装，跑不起来，和代码无关。
> - 本机：worktree `D:\npe-ops-frontend-fc`（分支 `task/tracking-diffs`，已推、和 main 一致）用完可删；主目录 `D:\npe-ops-frontend` 是另一个窗口在用，别动它的未提交改动。
> - 下次开工：`git fetch --prune`、从 main 拉；先看后端 main 新提交（这次看到 `d4ae671`，E189 Tracking 页日期按 UTC 登记了、还没改）。

> ✅ **2026-10-14 `task/tracking-diffs`（从 `task/tracking-resize` 续）：三个 Tracking 页逐项对比旧页面，把没登记过的差异改回旧版，已合进 main 上线。**
> - Annie 看了旧网页截图又强调一次：滑条要贴**屏幕**底部、跟着页面往下滚，不是滚到页面底部才出现 ⇒ 上一条的 window-hscroll.js 就是这个行为（线上 `/window-hscroll.js` 已 200）。
>   加了「真实场景」检查：只把行复制成长表、不改样式，页面在顶部时浮条已在屏幕底部，往下滚仍贴屏幕底部（三页都过）。
> - 改回旧版的（都是子代理对比出来、PROGRESS 里没登记过的）：
>   早班：往右拖列落在目标**后面**（原来落在前面）；Notes 表头数字按**筛选后**的行算；司机按钮组永远有 All（加载完才带人数）；去掉 Today 后面多出的日期文字；截止前不写「Auto-refreshes every minute until…」。
>   Tour：Guest Name 没有 guest_name 时用 first_name + last_name（原来少了姓）；Party 空字符串写 —；午餐卡「🦃 1  🥗 1  🥩 0」用空格不用中点；去掉「Auto-refreshes every minute.」。
>   Tickets：Notes 表头数字按筛选后的行算；Reset to default 只复原显示哪些列、不动列顺序；新消息提示条「💬 单号 · 单号 +N more」（去掉 New messages:）；空值同旧页（只有 Phone / Confirmation# 写 —，其余和上传列留空）；去掉「Auto-refreshes every minute.」。
>   三页：没消息的 Notes 格整格可点开对话；空的 WhatsApp 格不可点、不显示手形；对话弹窗输入框随内容自动长高（最矮 70px，同旧 `_noteAutoGrow`）。
> - **没改、等 Annie 定**（和旧页不同，但是有意的或改了会变行为）：
>   ① 对话弹窗没电话 / 邮箱时：旧页勾选框禁用但**保持勾着**、照发、后端跳过后提示「Saved, but NOT delivered」；ops 显示成没勾、两路都没有时直接拦「Tick SMS or Email…」（早班页是登记过的差异，Tour / Tickets 没登记）。
>   ② 群发：旧页选了 SMS 时超长的字**打不进去**、只在取消勾选收件人时才确认；ops 只显示字数、点发送才拦，每次都先确认。
>   ③ 补录上传弹窗：旧页「选团 → Continue → 选文件 → 预览」两步、已在列表的行整行黄底；ops 一个弹窗、灰字胶囊。
>   ④ Tickets 的「✓ 名字 (click to undo)」ops 点了真撤销（Annie G47 定的，保留）；旧页点了是开对话。
>   ⑤ 浏览器标签页标题、只有确认页留言时 Notes 预览画网页图标（旧页不画）等小事。
>   ⑥ 登记过的差异（整表每分钟重拉、改完重拉、失败提示写在页面里而不是 alert 等）照旧保留，见 `docs/旧页面差异清单.md`。
> - 检查：tsc / eslint / build 通过；`mt` 139 / 139、`tt` 85 / 85、`tk` 89 / 89（tk 拖列那条原来假定 Reset 会复原顺序，改成不依赖拖之前的顺序；连跑 3 次都过）。
>   全量回归 31 套：29 套全过；`tk`「发完重拉群发记录」偶发一次、单独重跑 89 / 89；`users` 崩溃是本机没有 `puppeteer-core`（不在 package.json，主目录也没有），和这次无关。

> ✅ **2026-10-14 `task/tracking-resize`（从 main 拉出，worktree `D:\npe-ops-frontend-fc`）：三个 Tracking 页拖列宽 + 自动列宽 + 屏幕底部横向浮条（Annie：「header 的宽窄没有办法调整」「页面下方的横向滑条也没有——是屏幕的页面不是表格的页面」），已合进 main 上线。**
> - 先让三个子代理逐项对比了旧模板和 ops（Morning / Tour / Tickets），结论三页一致：都缺这三样。旧实现：`tracking_*.html` 的 `initColResize` / `autoFitCols`、全站 `app/static/window-hscroll.js`。
> - **屏幕底部浮条**：把旧后台全站共用的 `window-hscroll.js` 原样放进 `public/`，`app/layout.tsx` 全站挂一次（旧后台 base.html 也是全站挂）⇒ ops 每一页凡是能左右滑、底边在屏幕外的区域，都在屏幕最底下浮一条同步的滑条。
>   唯一改动：带 `data-own-hscroll` 的区域跳过（HR 页自己有一条，免得两条）。
> - **拖列宽 + 自动列宽**：共用 `components/ui/column-sizing.tsx`（`useColumnSizing` / `ColResizer` / `autoFitCols`，算法照旧：90 百分位、表头宽是下限、不封顶、用 Range 量）；`globals.css` 加 `table.afm`。
>   表头右边 5px 手柄、最小 40px、**宽度不存**（Annie 09-12）、拖过以后本屏不再自动量（每分钟刷新不会抹掉）。Notes / WhatsApp 跳过：Tour / Tickets 固定 200 / 180（旧页写死的），Morning 由预览块 260px 定。
>   手柄悬停色照各页旧样式。⚠️ 和旧版一处不同：旧门票页只有第一 / 最后一列显示拖宽光标（其余列看不见、摸到能拖），ops 每列都显示。
> - Tour / Tickets 格子去掉 ops 多加的 `overflow-wrap:anywhere`（旧页只在空格处折行）。工具条文字改回旧版「⇆ Drag to reorder · ↔ Drag to resize」（早班「⇆ Drag columns to reorder · ↔ Drag edges to resize」），How to use 补回「Drag its right edge to make it wider.」。
> - 检查：tsc / eslint / build 通过；新共用检查 `checks/headless/resize-checks.js`（手柄、自动列宽、Notes/WhatsApp 跳过、拖 80px、拖了不顺带换列、刷新不还原、浮条出现 / 对齐 / 拖条带表格 / 放得下时藏），
>   `mt` 128 → **137**、`tt` 72 → **83**、`tk` 75 → **86**，`hr` 44 / 44 不受影响。

> 🔴 **收工交接（2026-10-12，家里）：线上 ops 上线后连不上后端，没修好，下次开工第一件事。**
> - 现象：main `5394f32` 部署后，ops 自己的页面（`/manifests`、`/dispatch`、`/dashboard`、`/forecast`）能打开，但**凡是转给后端的都 500**：
>   `/auth/login`（⇒ 登录不了 ops）、`/api/*`（页面拉不到数据）、旧后台页面 `/admin/*`、`/static/*`。响应是 Next 自己的纯文本 `Internal Server Error`，
>   后端本身正常（`https://confirm.nationalparkexpress.com/auth/login` 200）。旧后台 confirm 不受影响，staff 照常在旧后台跑业务。
> - 判断：ops 服务器连不上转发目标。`lib/api-proxy.ts` 读 `API_PROXY_TARGET`（**build 时固化**），没设就落到 `http://127.0.0.1:8000`。
>   **等 Annie 看 Railway**：ops 服务的 Variables 里 `API_PROXY_TARGET` 有没有、值是什么（应是 `https://confirm.nationalparkexpress.com` 或 Railway 内网地址 + 8080），
>   以及最新部署的 Logs 里有没有 ECONNREFUSED。变量补好 → Redeploy 即可，代码不用改。
> - 备选：在 main 上加一个提交把代码退回上线前的 `0664487`（不强推）——但如果是变量问题，旧版本一样连不上，所以先查变量。
> - 还不确定上线前的旧版 ops `/api` 转发是不是本来就好的（没在部署前测过）。
> - 本机：前端（3100）已关；工作区干净；`task/manifests-v2` 比 main 多这一条交接（只改 PROGRESS，没推 main，免得再触发部署）。
> - **2026-10-12 公司开工复查**：还是 500（`/auth/login`、`/api/*`、`/static/*`、不存在的路径都 500，`/dashboard` 200）。500 在 0.2 秒内就回来，
>   是「立刻连不上」而不是超时，和「build 时没有 `API_PROXY_TARGET`、落到 127.0.0.1:8000」对得上。公司电脑没有 Railway CLI，仍等 Annie 看 Railway 变量。
>   后端 main 看到 `f3fab21` 为止：`33da023`（Sunset 块放 CCL 车，纯后端）不用跟；G50（节的顺序，Manifest setup 要加一格）还在后端 `task/section-order` 分支，等上 main。
>   ✅ **已确诊**：Annie 发来的 Railway 日志（部署 `fc0664b3`）每条都是 `Failed to proxy http://127.0.0.1:8000/... ECONNREFUSED` ⇒ build 时没有 `API_PROXY_TARGET`。
>   仓库里没有 Dockerfile / railway.json，Railway 自己的构建会把服务变量带进 build，所以只要在 ops 服务 Variables 加 `API_PROXY_TARGET=https://confirm.nationalparkexpress.com` 再 Redeploy。
>   ⚠️ 设成 `https://confirm.nationalparkexpress.com` 重新部署后：500 没了，变成 **403，Cloudflare「DNS points to prohibited IP」（Error 1000）**——
>   Railway 上的 ops 经 Cloudflare 公网域名回连 confirm 被 Cloudflare 拦（本机直连 confirm 正常 200）。改成绕开 Cloudflare 的地址：
>   后端服务在 Railway 的 `https://<xxx>.up.railway.app` 公网域名（首选，最稳），或内网 `http://<后端服务名>.railway.internal:8080`
>   （后端 uvicorn 绑 `0.0.0.0` 只有 IPv4，老环境的 Railway 内网只走 IPv6 会连不上，所以不首选）。
>   ✅ **已修好（2026-10-12）**：`API_PROXY_TARGET=https://npe-confirmation-service-production.up.railway.app`，Redeploy 后
>   `/auth/login` 200（后端登录页）、`/api/*` 和 `/admin/*` 未登录 401（正常），ops 自己的页面 200。⚠️ 以后别把它改回 confirm 域名。
>   后端静态对照提了两处 ops 小问题，等 Annie 定要不要改：① Tickets Tracking 的 How to use 少了旧页那句 Cancel 说明；② tour 类型接口失败时 Tour 发送页「Upload & Preview」一直灰着。

> 🟢 **收工交接（2026-10-13 晚，家里，21:3x PT；Annie 今晚收工改到 22:00，经 npe-confirmation-service-37 转达）**：本窗口做的都已合进 main 上线，没有 WIP 分支。
> - 今晚上线：后端 E188 电话 AI 留言的 ops 跟进（`task/voice-in-note`，见下一条）。
> - 新登记「需要后端」第一条：**Products 的 Category 改成页面上自己加**（Annie 选的做法、CHD 组手续费的例子、费用算进 Sales Report 总额都写在那里）。
>   给后端的话已交给 Annie 去转；后端发来接口形状后，从 main 开分支做 Products 分类管理 + Sales Report 费用明细。
> - ⚠️ 本机主目录同时有别的窗口在改 7 Days Forecast（会切分支）；`checks/headless/tour-import.csv` 只是换行符变了，不是本窗口改的，没提交。
> - 下次开工：看后端 main 从 `ae4a427` 往后；问 Annie 后端有没有接 Category 的需求。

> ✅ **2026-10-13 晚（家里）`task/voice-in-note`（从 main 拉出）：跟后端 E188 电话 AI 留言（confirm `ae4a427`），已合进 main 上线。**
> - 后端：电话 AI 可以替客人留言，记成 `direction = voice_in`、`author_username = voice_agent` 的备注（不发给客人），Tour / 早班 Tracking 的 Notes 列和 dashboard Messages 都算未处理；同一句也发 reservations@。
> - ops 照旧模板改：对话弹窗加标签「Phone AI」（早班 `#c3a6f0`、Tour `#6f42c1`；`components/ui/conversation-modal.tsx`）；不进 `isInbound`，所以表格预览写作者 voice_agent、不写 Guest，气泡位置也和旧页一样
>   （早班在右、Tour 在左）。Tour / 早班 Tracking 的 How to use 各加旧页那一条「A Phone AI message means …」。门票 Tracking 旧页没改，ops 也不改。
> - 检查：tsc / eslint / build 通过；`mt` **83 / 83**、`tt` **72 / 72**（模拟接口加一条 voice_in，验标签和 How to use）。
>   `tt` 开头顺带清掉本机的列显示设置（`npe_ops_tour_col_vis`）——上次跑到一半断掉时会留着「隐藏 Phone」，后面每次都错。
> - 下次看后端从 `ae4a427` 往后。

> ✅ **2026-10-13 23:xx（Annie 说继续做、做完自己提交合并收工）：7 Days Forecast 照 CCL 表占好全部行，已合进 main 上线。** 取代下面「🔴 对照 CCL 表补分项」里能先做的部分。
> - Annie：「全部保留它的表格，做好了我们再加其他板块的时候才知道数据从哪里来」⇒ CCL 表里 ops 还没数据的行先按 CCL 的位置和名字占好、格子空着（`config.ts` 的 `cclExtraRows`，按块名认）：
>   每块 Driver / Guide 下面：Crew notes（CCL 那行人员备注，例 Scarlett N/A）、Notes / Number of vehicles booked；
>   Antelope：粗体行上面 Lower or Upper inventory (ref only)、分项下面 Max allotments；Sunset：粗体行上面 Sunset depart times（块的粗分隔线跟着画在它上面）；
>   Private：上面 CCL major events，Driver / Guide 下面 Private tours (CHD#, pax, tour, pick-up place & time)、Pax (tour 1, tour 2)、Driver / Vehicle type。How to use 加一条「这些行先空着」。
> - **VOF 改回只显示粗体行**：CCL 表里 VOF Half-Day / VOF and Hoover Full-Day 没有分项 ⇒ 恢复「只有一个分项、等于粗体行就不画」（99deeed 一度全列）；有几个分项的块（Hoover、Antelope、B&Z…）照样列。
> - 没做（等数据来源）：这些行的内容；车号红字（没 GPS）；GC South 的「vf」行（看着是 Notes 行写错名，算进 Notes）；Sunset 不开的日子写 x；页面的 Day Tour Live Link / Updated by。
> - 检查：tsc / eslint 通过；`fc` **58 / 58**（加：普通块占位行顺序和空格子、Sunset 块的出发时间行在粗体行上面）；1440 宽截图看过。

> ✅ **2026-10-13 21:5x：Dispatch Step 1 卡片按钮 + 说明（Annie），已合进 main 上线。**
> - 卡片按钮：**还没排车（0 bus）叫 Assign Bus、实心**；排了车以后沉下去（描边）、改叫 Check the bus；排了车但还要多开一台时照旧实心。点哪个都跳 Step 2 这个团的车。
> - Step 1 说明原来写「The buses on each card come from the schedule saved in Step 2.」（Annie：跟没说一样），改成告诉 staff 点 Assign Bus（排车后叫 Check the bus）去给这个团排司机 / 导游和接客酒店。How to use 那条跟着改。
> - 检查：tsc / eslint 通过；`mf` 56 / 56（改一条：排了车的卡 Check the bus、没排车的卡 Assign Bus 实心）、`da` 130 / 130（两处点按钮认两种名字）。

> 🔴 **下次开工第一件（Forecast）：对照 CCL「Forecast 2026」表补分项**（Annie 2026-10-13 21:4x 发了 5 张 CCL 截图：「你仔细看一下 CCL 产品组下面的分项，你缺了好多」；21:46 离收工 22:00 太近，只做了对照，没动代码）。
> CCL 每块的行 vs ops 现在：
> | 块 | CCL 的行 | ops 现在 | 缺 |
> |---|---|---|---|
> | 每块都有 | Total；DRIVER（红色车号 = 没 GPS）；一行人员备注（例 Scarlett N/A、GIA RX OFF）；**NOTES / Number of Vehicles Booked**（例 Glenn Confirmed） | Total；Driver / Guide（CCL Discord + Plan） | 车号红字（没 GPS）；人员备注行；NOTES / 订了几辆车 |
> | Antelope | Upper / Lower / Canyon X / Secret / Outbound / Inbound；**Lower or Upper Inventory (Ref ONLY)**（例 14lw,10U avail）；**Max Allotments**（35Lw 1p 30U 12:40p (aact) 30X 12:20p） | 分项看节设置（G46：UPPER / LOWER / X / VIP LOWER / SECRET ANTELOPE） | 库存行、Max Allotments 行；分项名 / 顺序要对 |
> | Bryce & Zion、GC South、GC West | Tour / Outbound / Inbound | 同（有 shuttle 产品才有那两行） | GC South 下还有一行「vf」（像是导游确认） |
> | GC West Sunset | **Sunset Depart Times**（2:20 PM）、GC WEST SUNSET #s、Tour / Outbound / Inbound、DRIVER；不开的日子写 x | 独立组后有 Tour / Out / In | 出发时间行；不开的日子显示 x |
> | Hoover | Bus Tour / HD RAFT / BOULDER CITY | 看节设置 | 产品挂 HD RAFT / BOULDER CITY 节 |
> | VOF Half-Day、VOF and Hoover Full-Day | 只有 Total + DRIVER + NOTES（**没有分项**） | 99deeed 起多了一行分项 | 这两块也许要改回不列分项 |
> | Private | CCL MAJOR EVENTS；PRIVATE TOURS（CHD#、人数、团、接客地点 / 时间）；PAX (tour1, tour2)；DRIVER / VEHICLE TYPE；GUIDE / DRIVER | 只有人数 + Driver / Guide | 整块是另一种排法 |
> | 页面 | Day Tour Live Link；Color Legend；Updated by 谁 | 有颜色说明 | Live Link、谁最后更新 |
> 要 Annie 定：哪些行要（CCL 自己用的库存 / allotment / 确认备注，NPE 要不要）、数据从哪来（**ops 没有这些数据**：要么 staff 在 ops 里填——要后端加存储，要么从 CCL Discord 读）。定了再做；只是显示已有数据的（VOF 不列分项、Sunset 不开写 x）可以先做。

> 🟢 **收工交接（2026-10-13 21:3x PT，家里，Forecast 窗口；今晚收工线 22:00，Annie 经后端 -37 转达）**：Forecast 今晚的改动全部已合进 main 上线（最后 `99deeed`），没有 WIP。
> - 今晚上线：粗体行不写 TOTAL / Driver·Guide 左对齐 / 图例白字 / 页头说明不限宽（`f2ad632`）、黄框挪最下 + Full screen（`c547690`）、手机左列 112px（`631f251`）、每块列出分项（`99deeed`）。
> - 等 Annie：① 在 Settings → Products 改组短名、把 West Sunset 做成独立组并排在 West Rim 后、去掉 West Rim 的 Own block SUNSET（见下面两条 🟡）；② 把「需要后端」第一条（CCL 对照改指 West-Sunset）转后端；
>   ③ 设好以后看 Forecast 各块分项是否和 CCL 表一致（缺的行是设置问题）；④ 没 shuttle 的团要不要也固定显示 Outbound / Inbound 两行（现在不显示）。
> - 本机：worktree `D:\npe-ops-frontend-fc`（分支 `task/forecast-phone`，已推、和 main 一致）用完可删；3198 / 8799 上没有本窗口的进程。主目录 `D:\npe-ops-frontend` 是另一个窗口在用（它的分支），别动它的未提交改动。

> ✅ **2026-10-13 晚 `task/forecast-phone` 续：7 Days Forecast 每块都列出分项，照 CCL 的表（Annie）——已合进 main 上线。**
> - 去掉「一块只有一个分项、且等于粗体行就不画」（原接口契约）：Hoover、VOF、Private、Multi-day 也列出分项。勾 Hide rows that are all 0 才藏全零的分项。How to use 那句跟着改。
> - 分项**有哪几行、什么顺序**是设置决定的（后端：组里有哪些节 / shuttle 产品就有哪几行，顺序按 G50 Section order）。CCL 样表（10-11 截图）：
>   Antelope = Upper → Lower → Canyon X → Secret → Outbound → Inbound；Hoover = Bus Tour → HD Raft → Boulder City；其余 = 团 → Outbound → Inbound。
>   ⇒ 对不上的地方 Annie 在 Settings → Products 设（产品的节、Section order），例如 Hoover 要有 HD Raft / Boulder City 两行，就得有产品挂这两个节。
>   没有 shuttle 产品的组不会凭空多出 Outbound / Inbound 行（不造假的 0 行）。
> - 检查：tsc / eslint 通过；`fc` 56 / 56（Hoover 那条改成「单行也列出分项」）。

> 🟡 **2026-10-13 晚：组改短名（Annie 定，等 Annie 自己在 Settings → Products → Groups 改显示名，是生产数据、ops 不改代码）**
> Antelope → Antelope Canyon；Bryce & Zion → Bryce&Zion；GC West → West Rim；GC South → South Rim；Hoover Dam → HooverDam；VOF Half-Day → VOF-H/D；
> VOF and Hoover Dam Full-Day → VOF&Hoover F/D；Private 不变；Multi-day → Multi-Day。**不另建 VOF-F/D**（全天 VOF 一直就在 id 6 那组，Annie：按原来的）。
> **Sunset 重复（Annie 截图确认，已定）**：线上有两块——West Rim 组拆出来的「West Rim Bus Tour · SUNSET」（G48）和另建的独立组「West Sunset」。
> Annie 定：**留独立组**，改名 West-Sunset，**位置仍在 West Rim 后面（第三个）**——Groups 的 Order 照顺序往后挪（West-Sunset 4、South Rim 5 …… Multi-Day 10）或填和 West Rim 一样的数（同号按显示名排，West Rim 在前），Annie 选，ops 不改代码。
> Annie 在 Settings → Products 做：Sunset 产品 `PKWJEV` / `PE4GYZ` / `PJAMTM` / `P30FJB` 放进 West-Sunset（节回默认，单程 shuttle 保留去 / 回程类型）；West Rim 的 Bus Manifest setup 第 7 项去掉 SUNSET。
> **要后端**：`dispatch_ccl_section` 里 `WEST RIM SUNSET` / `GC WEST SUNSET` / `SUNSET` 三行的 `manifest_id` 改指 West-Sunset 组（没有页面能改，只能 SQL）；
> 顺带查 `forecast_guide_plan` 有没有 West Rim + section `SUNSET` 的排班要搬。见「需要后端」。

> ✅ **2026-10-13 晚（家里）`task/forecast-phone`（从 main 拉出，worktree `D:\npe-ops-frontend-fc`——主目录被另一个窗口切到它的分支了）：7 Days Forecast 手机上左边一列收窄，已合进 main 上线（`631f251`）。**
> - Annie 看手机预览后说「名字都改简短一些，都是内部看的」。查了：块名 = 组名（Settings → Products 的组）+「 · 节名」，小行名 = Bus Manifest setup 的节名，**都是后端按设置给的**；
>   生产里组名本来就短（Antelope / BZ / CHD / Hoover Dam / South Rim / West Rim），预览里的长名字是模拟数据。真正占地方的是左列**写死 190px**，名字再短也一样宽。
> - 改法：窄于 640px 时左列 112px（`FIRST_COL_WIDTH_PHONE`），名字可以折两行、行距收紧，分项行 / Driver / Guide 缩进从 `pl-6` 变 `pl-3`；宽屏一点不变。手机上一屏能看到两天左右。
> - 名字本身要再改短，在 Settings → Products 改组名 / 节名（会一起影响 Manifests 胶囊、Dispatch、Bus Manifest 打印），ops 不用改代码。
> - 检查：tsc / eslint 通过；`fc` 56 / 56；390 / 1440 两个宽度截图看过。
> - worktree `D:\npe-ops-frontend-fc` 用完可删（`git worktree remove ../npe-ops-frontend-fc`）。

> ✅ **2026-10-13 晚（家里）`task/forecast-fullscreen`（从 main 拉出）：7 Days Forecast 黄色提醒框挪到最下面 + 全屏键（Annie），已合进 main 上线。**
> - 「N products … not grouped to any route」黄框挪到页面最下面（How to use 后面），文字 below → above。Annie：看 Forecast 的人不用管这些技术问题，内容发邮件给 azhou / lxu——
>   **后端 G51 已经在发**（2026-10-12 上线，每 15 分钟扫 Order List，没进 Products 或没归组的产品每个发一次给 azhou@ / lxu@nationalparkexpress.com），不用再找后端。
> - 选项那行最右加「⛶ Full screen」键（再点 / Esc 退出，键变成「✕ Exit full screen」）：整个 `<main>` 进浏览器全屏（编辑框也在里面，全屏时照样能开），全屏时自己给深色底、留白、上下滚。
>   浏览器不支持全屏（iPhone Safari）就不显示这个键。样子用描边、不用蓝（蓝色只给提交键）。
> - 手机（390 宽）预览给 Annie 看过：左边路线名那一列占半屏，一次只看得到一天，要横着滑。
> - 检查：tsc / eslint 通过；`fc` **56 / 56**（加：黄框在最下面、Full screen 键）。
> - ⚠️ 本机主目录里同时有别的窗口在改 Tracking 几页（`mt` / `tt` / conversation-modal 等未提交），这次只提交了 forecast 的文件。

> ✅ **2026-10-13 晚（家里）`task/forecast-no-total`（从 main 拉出）：7 Days Forecast 再改四处——Annie 看预览截图后提的，已合进 main 上线。**
> 1. 每块粗体那行（路线名）后面不再写小字 TOTAL（长名字如「Grand Canyon West · Sunset」时它挤到格子外）。How to use 那两句跟着改成「粗体第一行（路线名）」。
> 2. Driver / Guide 标签改成和上面分项行一样左对齐（`pl-6`），取代下午的居中。
> 3. 颜色说明（Sprinter (≤ 20) …）文字高亮白（原来 `/60`）。
> 4. **全站规矩（Annie）：页头标题下面的说明文字不限宽，一行放得下就不折，除非旁边有别的区块。** 全站查过：只有 Forecast 页头说明有 `max-w-[640px]`，已去掉；
>    其余页头说明本来就不限宽（Teams / Users 在窄的页面容器里，但说明很短）。How to use 框、发送页卡片的 `max-w` 不是页头说明，没动。
> - 检查：tsc / eslint / build 通过；`fc` **54 / 54**（改 2 项期望、加 2 项：页头说明 1440 宽一行、图例白字）。

> 🔵 **2026-10-13 晚（家里）开工**：main 拉到最新、`npm install` 无变化。只读看了后端 main `350a7c4..1310e13`：只有电话 AI（voice-rezdy-lookup，纯后端）和文档，**ops 没有要跟的**。
> 新登记、还没做的：**G61**（Morning Relay 发送加 `order_numbers` / `send_anyway` / 返回跳过单号）、**G62**（群发 Send anyway）——就是上面「等后端」①②，后端做完会通知；
> E68 sunset shuttle 回程时间按日期段变（要加设置，后端先等 Annie 答 4 个问题，做好后 Main manifest / Bus Manifest 显示会变，到时看 ops 要不要跟）。下次看后端从 `1310e13` 往后。
> 等 Annie：线上 7 Days Forecast 看完的意见（见下一条）。

> ✅ **2026-10-13 收工：7 Days Forecast 样式改动（分支 `task/forecast-full-height`）——Annie 14:3x 说「直接推吧，我回家检查」，已合进 main 上线。**
> - 来源：Annie 经后端 e2 转达两条 + 直接在本窗口说的三条：① 表格不设高度上限、有多少行就多高、整页滚，不要大窗口里套小窗口（去掉 `max-h-[72vh]`，只留左右滚；表头随表滚走）；
>   ② 颜色说明和「Color totals by vehicle / Hide rows that are all 0」对调（说明在左、选项在右）；③ 分项行文字和数字高亮白；④ Driver / Guide 居中；⑤ 拿掉 CCL / PLAN 胶囊、司机导游安排字号调小（10px）、有安排的那几天列加宽到 150（最多两行）。
> - 预览截图给 Annie 看过（模拟数据）。prettier 顺带把 forecast 目录几个文件排了版（只动格式）。检查：tsc 通过、`fc` **52 / 52**。
> - **下次开工**：问 Annie 回家在线上看 7 Days Forecast 的结果；要改就从 main 拉新分支改，改完直接上线。

> 🟢 **收工交接（2026-10-13，公司，c3 窗口，14:30 PT 收工——Annie 经 d3 转达）**：今天做的全部已合进 main 上线（含收工前的 7 Days Forecast 样式，见上一条），工作区干净，没有 WIP 分支；本机没有在跑的 dev / 模拟接口。
> - 今天上线：G47 Take action want=on/off（`6854663`）、发送表格全选 / 单选 / Send anyway（`d6307c8`）、G36 往返 shuttle（`513691e`）、G50 Section order（`58bdae4`）、G56 最终接口对齐（`46317ca`）。
> - **规矩改了**（CLAUDE.md「分支和上线」）：做完直接合 main 上线，Annie 在线上 ops 验收；新分支一律从 main 拉。
> - 等后端（来了就从 main 开分支做、做完直接上线）：① Morning Relay 发送加 `order_numbers` / `send_anyway` / 返回跳过单号（已发 d3 → e2 登记）；② 群发 Send anyway（口径：同团期、一模一样的消息发过才算，已发 d3 → e2）；③ G35「只增不删」的 `/sync` 返回形状（8e 那边和 Annie 定的设计，见「需要后端」）。
> - Annie 要做的：Bus Manifest setup 里把 PKWFT0 / P30FJB / PTHWQ1 设成 Shuttle round trip 并填回程时间 / 地点；线上看今天上线的几样。
> - 其他窗口：8e 在 worktree `C:\Code\npe-ops-frontend-schedule`（`task/staff-schedule`，dashboard 阶段二设计，只写文档），不碰 dispatch / 发送页。
> - 下次开工：`git fetch --prune`、`git switch main`、`git pull --ff-only`、`npm install`；先看后端 main 新提交（这次看到 `350a7c4`）和有没有窗口发来的消息。

> ✅ **2026-10-13 公司：`task/dispatch-pending-final`（从 main 拉出）对齐后端 G56「Completed 之后的变化」最终接口（confirm `350a7c4`，后端 a2 发来，同时发了 8e，8e 让本窗口做）——已合进 main 上线。**
> - 和草稿比只多两样：① `relay`（"= 不影响 Morning Relay）：短句（「1st Round · 2656 · Driver A」）前面加 Morning Relay:，本身以 Morning Relay 开头的（「Morning Relay · Need a look」）原样用、不重复；
>   ② `POST /api/dispatch/seating/move` 回 `auto_skipped`（Completed 那天选 Auto 不自动分车，客人留在 Not on a bus）⇒ 车下面写「This day is Completed — pick a bus.」。
> - 待处理接口线上已经不是 404（ops 网址下未登录 401），ops 的保护自动打开：点过 Completed 的日子下拉没有 Auto、显示变化那一块。How to use 早已分 Before / After Completed，不用改。
> - 检查：tsc / build 通过；`mf` **56 / 56**（relay 两种写法）、`da` **130 / 130**（auto_skipped 提示）。

> ✅ **2026-10-13 公司：`task/section-order`（从 main 拉出）跟后端 G50 节的顺序（confirm `0e3d9aa`，migrate_v85 10-12 已执行）——已合进 main 上线。**
> - Products → Bus Manifest setup 左边插第 3 项「Section order」，后面编号顺延（Extras 4、Lunch 5、Guests per bus 6、Own block 7）：逗号分开的节名，离开框整组 `PUT …/groups/{id}/section-order`（同旧面板），
>   重复 / 超 20 个写服务端原话、框里的值不动。右边示意图的节按它排（列了的在前、没列的 A–Z、班车最后去程在前），指到时 Bus Manifest 节标题和 Forecast 节行亮。How to use 照旧页加一条。
> - `/manifests` 分节和 7 Days Forecast 的小行：后端按它排好，ops 照接口顺序画，不用改。只有 admin 能存（后端管）。
> - 检查：tsc / build 通过；`products` **97 / 97**、`man` 117、`fc` 49。

> ✅ **2026-10-13 公司：`task/roundtrip-shuttle`（从 main 拉出）跟后端 G36 往返 shuttle（confirm `a39bd20`，v88 已在生产）——已合进 main 上线。**
> - Products → Bus Manifest setup：Type 下拉照 `setup.kinds` 多了 Shuttle round trip；选它才出现「Return pickup time / Return pickup place」两格（最长 20 / 80，离开格子存，PUT 带 `return_pickup_time` / `return_pickup_place`，同旧 `_manifest_setup_panel.html`）；
>   右边示意图往返的产品去程、回程各算一节；How to use 照旧页加一条。
> - `/manifests` 团确认弹窗：`leg = return` 的行灰底、不勾、不能勾、写「Return trip: no tour confirmation」（后端会整批拒发回程）。自定义消息不受影响（后端按单去重）。
> - Dispatch / Bus Manifest / 7 Days Forecast：回程行和 Total 都是后端算好给的，ops 照接口画，不用改。
> - 检查：tsc / build 通过；`products` 85 → **92 / 92**、`man` **117 / 117**、`fc` 49、`mf` 55、`da` 129。
> - Annie 要做的：在 Settings → Products → Bus Manifest setup 把 PKWFT0 / P30FJB / PTHWQ1 改成 Shuttle round trip，填回程时间和地点。PHN0QB 不是往返，在 Rezdy 拆单。

> 🟡 **2026-10-13 公司：`task/send-format-unify` 续——所有发送表格加全选、单选、Send anyway（Annie 2026-10-13，本窗口做，已告诉 8e 窗口别碰这些文件）。10-13 已把 main 合进来。✅ 2026-10-13 合进 main 上线（Annie：做完直接上线、线上验收）。**
> - Annie 定：每张发送表格都要 **全选、单选、Send anyway**；Tracking 群发和 Multi Orders 回复**也要 Send anyway**（要后端，见「需要后端」第一条）。
> - 统一的规矩（几页一样）：没发过的默认勾、可逐个取消；表头 Select all **只管没发过的**（同早班页，碰不到发过的）；发过的整行淡黄，勾 Send anyway 才发，
>   行里的勾选框灰着、跟着 Send anyway；文件里第二次出现的灰着不发。没勾的不发、也不算「跳过」，确认框写「N not ticked, not sent.」。
> - 做了：
>   - **Manifests 两个弹窗**（`components/manifests/send-dialogs.tsx`）：名单表加第一列勾选、最后一列 Send anyway，**Send anyway 第一步就能勾**——
>     `preview_at` 用页面上显示的那个发送时间（勾的几单里最晚的，原样字符串）：后端只重发「最近一次发送不晚于 preview_at」的单，看名单之后又有人发过照样跳过。
>     发完的跳过名单（别人刚发过的那种）照旧能再勾 Send anyway。没选 tour type 的节只算勾了的人。
>   - **Tickets / Tour 发送页**（`components/tickets-send/manifest-preview.tsx`、`tickets-send-view.tsx`、`components/tour-send/tour-preview.tsx`、`tour-lane.tsx`）：预览表加第一列勾选 + 表头 Select all。
>   - **Tracking 群发**（`components/ui/broadcast-dialog.tsx`，三页共用）：名单顶上加 Select all（逐个勾本来就有）。
>   - **Morning 发送页**不改：全选 / 按地点 / 逐个勾 / 已发过那块的「Send anyway (all N)」本来就齐，样子照旧页面。
> - 没做（要后端，见「需要后端」第一条）：群发的 Send anyway、Morning Relay 的全选 / 单选 / Send anyway、Multi Orders 回复。
> - 检查：tsc / eslint 通过；`man` **116 / 116**（模拟接口照后端比 preview_at；新增：默认勾法、单选 / Select all、第一步 Send anyway 送 send_anyway + 显示的发送时间、
>   别人刚发过 ⇒ 服务端跳过 ⇒ 跳过名单再勾）、`tsend` **43 / 43**、`tour` **54 / 54**、`tk` **75 / 75**（群发 Select all）、`tt` 70、`mt` 126。

> 🟡 **2026-10-12 公司：`task/send-format-unify`（从 `task/manifests-v2` 拉出 = main + 几条 PROGRESS）。✅ 2026-10-13 随上面一起合进 main 上线。**
> **新规矩（Annie 2026-10-12）：整个系统的发送页面格式必须统一——功能可以增减，格式要一样。** 以后做 / 改任何发送界面都用
> `components/tickets-send/legacy-ui`（照旧 `send_tour.html` 搬的表格、标签、黄框 / 红框、结果数字、进度条），不另写一套。
> - 起因：Manifests 的「Send tour confirmation」弹窗把已发过的单号和时间挤成一段逗号文字（Annie：「谁能分得清」）。
> - 改了 `components/manifests/send-dialogs.tsx`（团确认、门票提醒两个弹窗；自定义消息只换了框的样式）：
>   - 发之前：每节一张名单表（Order # / Guest / Pax / Pick-up time，门票是 Cfm # / Status），列宽固定、几节对齐；
>     已发过的整行淡黄 `#fff8e1`、橙色标签「Sent by 谁 on 时间」（同旧发送页的 sent_label，没记发送人写 staff）。
>     表下黄框一句「N guests already sent (highlighted) will be skipped …」。流程不变：重发仍在下一步勾 Send anyway。
>   - 发完：发送页的结果数字（Sent / Failed / Skipped / Not sent）+ 原来那句绿字小结 + 逐单结果表；跳过的单也是一张表（淡黄行、原因标签、
>     每行 Send anyway 勾选 + 表头 Send anyway (all)）；进度条、停下的红框都换成发送页的。
>   - 弹窗不再跟全深色主题变深（发送页的表格没有深色样式，保持白底，和发送页一致）。
>   - 名单表要的「谁发的 / 客人名 / 上车时间」列表不一定拉了（staff 自选列），弹窗打开时按当前胶囊补拉一次
>     （`fields=guest_name,pickup_time,sent_tour_by`；门票 `guest_name,sent_tickets_by`），拉不到标签只写「Sent on 时间」。列表请求本身没改。
> - 「已发送」的口径（Annie 问的，记一下）：后端 `send_guard.tour_sent_orders`——send_log 里同一团期、module 为 tour_confirmation 或 last_minute
>   的最近一次，哪个页面发的都算；就是让客人点 Reconfirm My Spot 的那封团确认。Tickets 标签看的是门票提醒。
> - 检查：tsc / eslint 通过；headless `man` **110 / 110**（模拟接口加了 `sent_tour_by` / `sent_tickets_by`，团确认弹窗那条检查改成验名单表、淡黄行、
>   「Sent by ZZ Test Staff on Oct 6, 2026, 4:12 PM」）。`checks/headless/shoot.js` 加了 `SHOOT_JS` 环境变量（截图前在页面里执行一段 JS，例如点开弹窗）。
> - **其余还没统一的发送界面**（等 Annie 定要不要也改成发送页这套）：Tracking 页的群发弹窗（`components/ui/broadcast-dialog.tsx`，
>   三个 Tracking 页共用）、Dispatch 的 Morning Relay 发送（`components/dispatch/relay-panel.tsx`）、dashboard Multi Orders 的 Reply。
>   这几个原来是照各自的旧模板搬的，旧后台里它们本来就和发送页不是一个样子。

> ✅ **2026-10-12 公司：`task/take-action-want`（从 `task/manifests-v2` 拉出，独立分支），跟后端 G47——Annie 2026-10-13 说合进 main，已上线。**
> 后端窗口转来：`PUT /api/bookings/{id}/take-action` 加可选 `want=on|off`（门票 `source=tickets` 也能用）。on = 记成处理（已记过的重新记谁、几点，
> 修「处理过又来新消息的单，点 Take action 反而被清掉」）；off = 撤销；不带 = 旧的开关；别的值 400。Annie 2026-10-12 确认：显示没处理 ⇒ 点一下记成处理；
> 显示已处理 ⇒ 点一下撤销。✅ 后端 G47 已上线（main `52cd213`，含 `88a29ca`，2026-10-12 核对过），本分支 Annie 验收后就能合。
> - ops 改法：按按钮当时显示的传——表格里 ⚠️ Take action ⇒ `want=on`、✓ 某人 (click to undo) ⇒ `want=off`（`components/ui/conversation-preview.tsx`，三个 Tracking 页共用）；
>   对话弹窗 ✓ Mark as actioned / 门票勾选框没勾 ⇒ on，✓ Actioned by / 勾着 ⇒ off（`conversation-modal.tsx`）。`toggleTakeAction` 的 want 必传。
> - 后端没合之前上线也没事：旧后端不认 want、照旧开关，和现在一样。dashboard Multi Orders 的 Take action 是另一个接口，不在这次范围。
> - ⚠️ 对话弹窗的「已处理」只看 action_taken_by，不看 notes_unhandled（表格看）：处理过又来新消息的单，表格显示 ⚠️ Take action，弹窗却显示 ✓ Actioned by，
>   在弹窗里点会是撤销。后端核对：旧网站一样（Tour / Morning 弹窗只看 action_taken_by、表格看 notes_unhandled；Tickets 两处都看 action_taken_by）。**后端说先别单独改**：已登记在后端待办 G47 下，先给 Annie 看预览，两边一起改。后端 G47 已在本地合进 main（`cce16d9`），推上去后会通知。
> - 检查：tsc / eslint / build 通过；三个模拟接口照 G47 改（on / off / 不带 / 400）；`tt` 70 / 70（加 G47：处理过又来新留言的单点 ⚠️ Take action 带 want=on、仍是 ✓ Annie）、
>   `mt` 126 / 126、`tk` 72 / 72（各自验 want=on / want=off）。

> 🟡 **2026-10-12 晚：`task/bus-manifest-map`（从 main `1519736` 拉出，之后合过 main 到 `99e1094`）：Bus Manifest setup 照后端 preview v4 改成「地图」排版**
> （Annie 看过 v4 后说「可以，做吧」——旧页面没有，属同意过的差异）。
> - 左边每项设置一个橙色编号 + 灰字说明（印在哪 / 用在哪）：1 Colour、2 Sections、3 Extras、4 Lunch sheet line、5 Guests per bus、6 Own block on the 7 Days Forecast。
> - 右边 `components/products/manifest-setup-map.tsx`：缩小的 Bus Manifest、午餐单（午餐行空 = 写明不印）、Dispatch、7 Days Forecast，同号标出位置；
>   指到 / Tab 到左边某项，右边那块描橙色虚线亮起来，指右边也会反过来亮左边。客人、订单号、数字是编的，颜色 / 节名 / Extra / 午餐行 / 每车人数 / Own block 跟着左边现在的值。
> - ✅ preview v4 的 3「Section order」（G50）已在 2026-10-13 插进来，见上面 `task/section-order`。
> - 宽屏左右两栏，窄于 lg 上下排。存取逻辑、aria-label 都没变。
> - 验证：tsc / eslint 过；products headless 84/84（新增 9 项地图检查：编号顺序、灰字、指到亮 / 移开灭、Tab 进来亮、反向亮、跟着现值）。
> - 合 main 前先问 Annie。

> ✅ **2026-10-12 深夜 `task/dispatch-pending`（从 main `68d3d98` 拉出，worktree `D:\npe-ops-frontend-d9`）：Dispatch「Completed 之后的变化」（后端 G56）——Annie 睡前说「做完自己提交，合并上线」，已合进 main。**
> - 依据：后端 -87 窗口发来的 G56 **草稿**接口（后端代码还在 `task/dispatch-pending` `dbabd9f`，表 v89 已在生产）：`GET /api/dispatch/pending?date=` → `{items:[{id, manifest_id, tour, order_number, kind added|removed|changed, detail, old_bus, relay, created_at}]}`（只给没处理的）；
>   `POST /api/dispatch/pending/handled` `{date, ids}` 或 `{date, all:true}` → `{handled}`。后端上 main 时会再发最终接口，**有变化要对一遍**。`relay` 后端 10-13 才填。
> - Annie 定的（⛔ 不再问）：逐单 Handled + 一键 All handled（后端记谁、几点）；只给 staff 看，不进司机 / 导游页；Morning Relay 算；Completed 之后后端不自动分车、不清 Completed，新单留在 Not on a bus 由 staff 选车，不预选不推荐。
> - ops 做了（`components/dispatch-manifest/pending-changes.tsx`、`manifests-panel.tsx`、`components/dispatch/seating.tsx`、`dispatch-view.tsx`、`lib/dispatch-manifest-api.ts`）：
>   - Step 1 顶上白卡片「N changes after Completed」：一单一行（团、New order / Changed / Cancelled、单号、改了什么、To do、几点）。To do 只按原来的车写
>     （新单「Not on a bus yet: pick a bus in Step 2」，其余「Was on Bus X: update the manifest, tell the driver」，有 relay 时加「Morning Relay: …」）；每行白键 Handled、右上蓝键 All handled；标不上写服务端原话。没有就不显示。
>   - 卡片团名下橙字「N change(s) after Completed」，这样的团排在最前（算「要处理」）。
>   - Step 2 车下面的名单（Completed 的日子）：下拉**没有 Auto**，没坐车的先显示「Choose a bus…」，每台车写「Bus A (已坐 / 座位)」，不预选；新单标「New after Completed」；
>     Not on a bus 那行右边写「Completed: pick a bus for each order」；不显示「Placed by staff — Auto hands it back」。
>   - ⚠️ **保护**：待处理接口读到过（不是 404）才算后端 G56 已上线；在那之前（现在线上就是这样）点过 Completed 也照旧给 Auto、不显示变化那一块——线上后端那天照旧自动分车。后端合进 main 后自动生效，ops 不用再改。
>   - How to use 分成「Before Completed / After Completed」两条。
> - 检查：tsc / eslint / build 通过；headless `mf` 44 → **55 / 55**（变化那一块每一列、白键 / 蓝键、卡片橙字和顺序、单条 Handled 送 ids、标不上写原话、All handled 送 all、接口 404 不显示不报错、How to use）、
>   `da` 122 → **129 / 129**（Completed 之后：变化那一块、卡片橙字、Not on a bus 文字和新单标、下拉没有 Auto / 写已坐座位 / 不预选、已坐好的单也没 Auto、给新单选车送 move；接口 404 时照旧给 Auto）。
>   顺带修了 `da` 第一条「打开时静默拉一次 Discord」的时间竞争（只等请求、没等画出来）。`da-mock` 加了 `MOCK_CTL` 环境变量（截图时预设）。
> - 截图（模拟数据，2026-10-09 点过 Completed）看过：样子和 Dispatch 原来一致。**没连真实后端测**（后端 G56 还没上 main）。
> - 等后端 G56 上 main：对一遍最终接口；`relay` 填了以后看 To do 那句；Annie 看线上效果。dashboard 的 Today's tasks 以后也可以列这些（没做）。

> ✅ **2026-10-12 晚 `task/forecast-colors`（从 main 拉出，worktree `D:\npe-ops-frontend-d9`）——Annie 说上线，已合进 main（`99e1094`）；后端那两条已发给 d8：**
> 1. Forecast 页改名 **7 Days Forecast**（Annie：**只改名字，表里还是 60 天**）：浏览器标题、页头、How to use、侧栏代码默认值、Products 的 Bus Manifest setup 里三处说法。
>    ⚠️ 侧栏上的名字来自 Settings → Navigation 的配置（G52）：配置没存过时后端返回种子（还是「60 Days Forecast」）⇒ **Annie 要在 Settings → Navigation 把它改成 7 Days Forecast 再保存**，
>    侧栏才变；后端种子也要跟着改（见「需要后端」）。1f 的 `task/bus-manifest-map` 也会改 products 那几处，合并以 7 Days 为准（已和 1f 说好）。
> 2. 车型颜色调柔和（Annie 看了预览 https://claude.ai/artifact/JjL7SLvFWpx3d711oYmaFB 选的第二版）：Temsa 绿 `#64877a`、Full Size Coach 白 `#e6ebf0`、加车红 `#9e6b6b`；
>    新增 **yellow**（Sprinter 用）`#cbbb84` 深色字。`components/forecast/config.ts` 的 `KNOWN_SWATCHES`。black 照旧。
>    **Sprinter 变黄要后端改设置**（Annie 选的做法，见「需要后端」），改之前 Sprinter 仍是原来的深蓝灰。
> - 检查：tsc / eslint / build 通过；headless `fc` 49 / 49（模拟数据 Sprinter 改 yellow，测黄底深字、绿色新色值、标题）、`nav` 25 / 25、`products` 75 / 75。

> ✅ **2026-10-12 晚 `task/dispatch-order`（从 main `247b184` 拉出，worktree `D:\npe-ops-frontend-d9`），Annie 看线上 `/dispatch` 后提的两条——Annie 说上线，已合进 main（`df5598c`）：**
> 1. Dispatch 每一步的说明（`components/dispatch/step-box.tsx`）去掉 `max-w-[90ch]`，占满整行，不在中间就折行（Assign / Send 各步一起）。
> 2. Step 1 卡片顺序（取代旧页面「没传的在前、传完的排最后」，名单改成同步以后那个顺序没意义了）：**有客人、团名下有橙字要处理的在前**（例如 Needs saving / 要多开车 / 有人没分到车），
>    有客人、没问题的其次，**没客人的（多半这天没单）最后**；同组里按排车页块的顺序。How to use 那条跟着改。
> - 检查：tsc / eslint / build 通过；headless `mf` **45 / 45**（卡片顺序两条改期望 + 说明不限宽一条）、`da` 122 / 122。

> ✅ **2026-10-12 `task/dispatch-sync`（从 `task/manifests-v2` 拉出，和 `task/send-format-unify` 是两条独立分支），跟后端 G35——Annie 2026-10-12 晚说合进 main，已上线。**
> 后端窗口转来（Annie 2026-10-12 已定）：后端 main `c719fd7` 上线 `POST /api/dispatch/manifests/sync`（form `date`，require_staff），
> Dispatch 的名单改从主 Manifest 同步（只 confirmed，按 Group 对 Dispatch 的块；没分组的产品不上 Dispatch；过去的日子不动 `synced:false`；
> 名单没变什么都不写、Completed 不清；新客人自动分车，staff 选的车和上车标记保留）。Annie 定的 ops 做法：
> 1. 打开排车页、换天：先同步，再读卡片和其余的（`components/dispatch/dispatch-view.tsx` 的 `load(date, { sync: true })`；保存 / 复制后的重读不同步）。
> 2. **拿掉 ops 的 Step 1 CSV 上传**（上传按钮、文件框、Added / Removed / Changed 弹窗、`previewManifestUpload` / `applyManifestUpload`、
>    `ManifestUploadPreview` 类型都删了）。旧网站的上传留作后备：同步坏了 staff 去旧网站手动传。卡片标签 No CSV yet / CSV loaded → No guests yet / Guests loaded；
>    Step 1 说明和 How to use 跟着改。
> 3. Dispatch 和 Manifests 一起切换（切换清单 `lib/page-switch.ts` 现在还是空的，到时一起加）。
> - 同步失败不挡排车：Step 1 红字「Could not update the guest lists … may be out of date … 去旧网站手动上传」。有 `skipped_orders`（人数读不出来没放进名单）时
>   Step 1 红字逐团写「团名: N orders could not be loaded (no guest count): CHD…」。
> - 检查：tsc / eslint / build 通过；headless `mf` **40 / 40**（上传那段换成同步：先 POST 同步再读卡片、换天同步新日期、skipped 列出、同步失败照常显示卡片 + 红字、
>   没有上传按钮和文件框、How to use 新文案），`da` 122 / `imp` 25 / `nav` 23 / `dr` 50 / `sheet` 24 / `sheetcmp` 4 全过（`da-mock` 加了同步接口）。
> - **2026-10-12 家里 dashboard 窗口（d9）在这条分支上补的**（d9 起初不知道公司已推这条分支，自己从 main 另做了一版 G35；发现后放弃自己那版，
>   改成在 `80a4cad` 上补。自己那版留在本地分支 `backup/dispatch-sync-d9`，没推，可删）：
>   1. **Completed 重新定义（Annie 2026-10-12 晚，取代 d9 先前「同步成功才算齐」那版）**：Completed = staff 标「这一天的 Dispatch 做完了」，
>      **跟名单齐不齐无关**，这一天有团就一直显示（同步失败 / 过去的日子也显示）。按钮改叫「Completed — this day’s dispatch is done」，点过显示
>      「Dispatch completed by 谁 · 几点」（普通文字，不再用浅蓝）；How to use 跟着改。
>      ⏳ Completed 之后名单再变的单要变成「待处理」、提醒更新已发出的东西——**要后端**，见「需要后端」第一条。在那之前后端照旧：名单一变就清掉 Completed。
>   2. 还在叫 staff「上传 CSV」的文字：`/dispatch/manifest` 页头（`· file x.csv` → `· x.csv`，同步来的显示 `Synced from main manifest`；没名单写 `no guests yet`）、
>      没名单的提示、How to use；Seat guests 没名单的提示；Morning Relay How to use 第一条。
>   3. **Bus Manifest 的 Extras**（后端 bus-manifest-extras `ad8b7ab`，migrate_v87 已在生产执行；1f 窗口做 Products 的 Bus Manifest setup，分支 `task/bus-manifest-extras`，
>      转给 d9 做 Dispatch 这边）：`/dispatch/manifest` 客人行 `extra` 有值时整行用 `extra_row_color`（`#f8cbad`）当底色，同旧 `tour_manifest.html` / 打印页
>      （票种标黄那格照旧盖在上面，同后端 Excel）；footer 本来就照接口列表画，新的「<Extra 名> SEATS LEFT」格和新顺序自动出现；How to use 那条改成 Bus Manifest setup / Extras。
>   - 检查：tsc / eslint / build 通过；`mf` 40 → **44 / 44**（Completed 有团就显示——还有团没名单 / 过去的日子 / 同步失败都显示、点过是普通文字、Extra 行底色、footer 顺序、manifest 页没有上传字样）、`da` **122 / 122**。
>   - 验收补一步：Products 给某个产品挂上 Extra（例 Heli）以后，那个团的 manifest 里这类客人整行橙色，车底下多一格「Heli SEATS LEFT」。

> ✅ **2026-10-12：`task/bus-manifest-extras`（从 `task/manifests-v2` / main `24eb5b4` 拉出）：Settings → Products 的 Manifest setup 跟后端 `ad8b7ab`（migrate_v87）**，
> 后端 -6a 窗口转 Annie 批过的 preview v4。
> - 面板改名 **Bus Manifest setup**；**Boxes 整块拿掉**（后端 `…/counters` 已删，⚠️ 线上 ops 现在点 Save boxes 会 404，等本分支上线）。
> - 新增 **Extras**（照旧 `_manifest_setup_panel.html`）：Name / Seats 表，最后一行空行（New extra）填完离开就存；只填一半提示
>   「Not saved yet - fill in both the name and the seats.」不发请求；清空一行 = 删掉，挂着它的产品变回 Tour。整组 `PUT …/groups/{id}/extras`，后端校验、原话显示。
> - 「Sections on the Bus Manifest」每个产品的 Type 下拉多出 `Extra: <名字>`，选了存 `{kind:"tour", extra_id}`，其余类型存 `extra_id: null`。How to use 照旧页加 Extras 一条。
> - preview v4 里的「地图式」排版（编号图钉、迷你印刷版 manifest）旧页没有，**没做**，等 Annie 定要不要。
> - 验证：tsc / eslint 过；products headless 测试改成 Extras，**75/75 全过**。
> - ✅ Annie 2026-10-12「合」：build 通过后快进合进 main（`1519736`）、推送上线。

> 🚀 **2026-10-12 凌晨：链尾 `task/manifests-v2`（含 dashboard 改版分支 `task/dashboard-redesign`，合并提交 `8959ae0`）已快进合进 main、推送上线**
> （Annie：「全部上线我一起验收吧，反正旧前端再跑业务，我本地验收好麻烦」）。上线前：tsc / eslint / build 通过，全量 headless 31 套全过（`teams` 偶发、重跑 54/54）。
> 分批切换清单 `SWITCHED` 仍为空：staff 照常用旧后台（confirm），ops 上首页 / 侧栏仍去旧页面，新页面直接输入网址打开；Annie 在线上 ops 集中验收。
> ⚠️ ops 连生产后端，线上 ops 的发送页、Manifests 发送、群发点了就真发。**以后新分支一律从 main 拉**；下面「分支链」的说明是历史记录。

> 不设验收上限（见 CLAUDE.md「待验收页面」）。分支链（后一个从前一个拉出）：
> `task/dashboard-links` → `task/morning-tracking-page` → `task/tickets-tracking-page` → `task/pickup-locations-page` → `task/products-page` → `task/broadcasting-log-page` → `task/bug-reports-page` → `task/ops-summary-page` → `task/order-log-page` → `task/sales-report-page` → `task/task-board-page` → `task/orders-page` → `task/content-studio-page` → `task/hr-page` → `task/vehicles-page` → `task/dispatch-sheets` → `task/ops-api-catchup` → `task/dispatch-manifest` → `task/dispatch-assignments` → `task/app-nav` → `task/ops-api-catchup-2` → `task/tour-send-page` → `task/tour-tracking-page` → `task/morning-relay` → `task/date-picker-click` → `task/log-search-compact` → `task/log-order-search` → `task/dispatch-steps` → `task/ops-api-catchup-3` → `task/morning-send-guard` → `task/ops-login-cancel` → `task/manifests-v2`（`task/forecast-30day-page` 旁支已在 2026-10-08 深夜合回，见下面 `fee938e` 那条，不再单独在链上）。
> **最新：`task/manifests-v2`**（2026-10-10 续），
> 验收在这个分支上看全部。⚠️ 推 main 会自动部署。
>
> 2026-10-08 深夜：`/forecast`（30 Days Forecast）旁支 `task/forecast-30day-page` 做完、合回链尾 `task/manifests-v2`（`fee938e`），
> **`task/manifests-v2` 重新变成唯一链尾**，旁支分支和公司那台的 forecast worktree 都不用再碰。
>
> 2026-10-07 晚：后端 Manifests 包上线了（main `3629925` / `6162287`，v76 已在生产执行），原来的旁支 `task/manifests-v2` 合进了链尾
> `task/ops-login-cancel`（含另一个窗口的 `81d5f1c`：检查脚本改用 `.next-checks`），**接成新的链尾**。
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

**下一步（2026-10-08 晚更新）**：

1. 开工先 `git fetch --prune`，切到链尾 `task/manifests-v2`。
2. ✅ **全站照旧版改样子已做完（2026-10-08 晚）**：外框 + 全部已迁页面，见「全站照旧版改样子」小节。
   **等 Annie 并排看**，那一节末尾列了 7 条仍和旧版不同的地方，其中第 3 条（Dispatch Step 1 卡片文字）要她定。
   下面是当时的原文：
   🔴 **新规矩（Annie 2026-10-07 晚，已写进 CLAUDE.md「已定的决策」）：页面对着旧版做到一模一样，不自己发挥。**
   之前做的页面都是浅色（`bg-stone-100`），旧后台全是深色（`base.html` 的 `--bg:#06101c`）⇒ **所有已迁页面要照旧模板改样子**
   （配色、版式、字体、文字）。dashboard 已改（见本节最后一小节，做法可照抄：IBM Plex Sans、半透明白卡片、彩色边框）；
   **其他页面一页都还没改**，下一步就做这个，逐页打开旧模板对照。共用组件（`components/ui/` 的 Panel、按钮、筛选条、弹窗、
   `step-box` 等）先改深色，能一次带动很多页；侧栏本来就是深色。旧页面没有的新功能（Dispatch Assign / Send）也用深色。
3. **功能上的不同，Annie 选了「逐页过一遍再定」**：清单在 [docs/旧页面差异清单.md](docs/旧页面差异清单.md)（131 条，从各页「与旧页面的差异」抽的），
   等 Annie 每条勾「保留 / 改回」。**勾回来之前不动功能**，只改样子；勾回来以后按她的选择改。
4. ✅ **dashboard 漏的 Multi Orders 窗口已补上（2026-10-10）**，见「dashboard Multi Orders 窗口」小节；等 Annie 验收。
5. 等 Annie 验收：全部页面都在等（样子改完后再看效果更好）。最新几项在本节最后几小节：10-05、10-06 的七项，10-07 的 **`/manifests` 新页 + Products 的 Tour type 列**，
   10-07 晚的「Dispatch 司机名后不挂语言」（后端 main 已核对到 `f3ae356`）、**Dispatch 拆 Assign / Send 两个标签**、**dashboard 深色 + Dispatch 说明放大**。
   ✅ **10-08：`/manifests` 已连真接口实际看过**（本地前端转发线上 confirm，Annie 账号登录），结果见本节最后一小节「`/manifests` 真接口核对」——
   两个标签、胶囊、字段弹窗六组、Legacy 行提示、Cfm # 输入框、CSV 导出、Products Tour type 列都正常，控制台无报错。
   Money 组 Annie 已改成所有 staff 都能看，等后端放开（见「需要后端」第一条，admin 账号现在仍能看到，符合当前后端行为）。
   ✅ **10-08：Manifests 加了 Cfm # 批量上传**（Max 要求，见「Manifests：Cfm # 批量上传」小节）——没有后端接口，
   匹配和写入全在前端做；headless `man` 套从 60 加到 68 项全过，真连了线上数据测过匹配逻辑（没有点 Insert 写真实订单）。
6. 验收通过的按分支链合进 main（只过了前面几页就合对应的分支）。
7. G29 第二批（Seat guests）合进 main 后照着跟（放进 Assign）；Messages 等 Annie；Morning Relay「复制 1st Round」等 Annie 细化（见「待做」第 3 条）。
8. ✅ 全量回归（2026-10-08 晚，改完样子以后在家里那台跑）：**29 / 29 套通过**。`bugs` 有一次偶发 2 项失败、重跑 40/40；
   `tsend` 上传步骤原来只等 300ms，页面重渲染时会找不到文件框，已加等待。
9. 截图小工具：`checks/headless/shoot.js`（起对应的模拟接口 + headless Chrome 整页截图，带排队锁），对照旧版时用。
   ⚠️ 跑之前 3198 上要有指向模拟接口的 `next dev`（`node run-all.js <任一套> --keep-dev` 留一个）。
11. ⏸️ **Bug Reports 页挂起**（Annie 2026-10-11）：主业务上线以后再做，见「`/bug-reports`」小节开头。
10. 🔵 **2026-10-10：只读查看了后端 main 自 de83c6a 起的新提交（约 45 个），整理出 ops 要跟的几块**
    （10-11 又看到 `3af7004` 为止，多出的 Step 5 勾选、CCL 原文标红也要跟）：
    - ✅ **G33 Dispatch Step 1「Completed」按钮**——10-11 已做，连同 Step 5「Check the list」、CCL 原文标红，见「后端 10-08 ~ 10-10 跟进：Dispatch」小节。
    - ✅ **Manifests 分节 + 群发 + 按名单发送**——10-11 已做，见「`/manifests`：分节 + 勾选 + 按名单发送」小节。
      ⚠️ 后端已知非阻塞问题，照接：E187（Send anyway 重发会清掉 MTLV 标记）、E186（群发邮件 HTML 未转义）。
    - 10-11 再看到的、**不用跟**：`fc3593c`（dashboard 改期卡显示改期内容，纯后端改 body）；rezdy-onhold-sync / rezdy-batch-a-backfill /
      ccl-private-bus-keyword（纯后端）；frontend-migration-plan-update（只改了后端的迁移规则文档）。
    - ✅ **Tour Tracking 群发「按接客点」**——10-11 已做，见「后端 10-09 跟进：Tour Tracking 群发「By pickup location」」小节。
    - **Dispatch「Check the bus」文案 / 交互重设计**（后端 dispatch-step1-cards `cb3887d`，纯前端模板改动，接口不变）：
      按钮名 Assign Bus → Check the bus，团名下橙字提示问题、按钮实心蓝只在能解决问题时出现，新增跳 Step 3 的 Seat guests 按钮
      （`buses_needed > 已存车数` 走 Check the bus，否则 `not_on_bus` 走 Seat guests）。用到的字段 ops 现有的
      `GET /api/dispatch/manifests` 卡片里都有，不用等接口——但这是「旧页面又改了一次设计」，按「页面对着旧版做到一模一样」
      的规矩，**开工前要先问 Annie**：要不要把这版文案 / 交互搬进 ops 独立实现的 `/dispatch` Step 1 卡片（ops 不是嵌旧模板，
      不会自动跟着变）；前几天 Annie 刚把 Step 1 卡片定成「不放午餐等详情」的简化写法（`06e636a`），这次要她确认两者怎么合。
    - **不用跟**：manifest-confirmed-only / forecast-confirmed-only（已知结论，ops 不改）；ccl-vehicle-detection-fix（纯后端解析 bug 修）；
      tix-az-note-editable / pickup-offset 系列（Content Studio 数据和服务端逻辑，不涉及已迁页面）；seat-guests-land（只改了旧 Jinja
      模板和内部函数，没有新 JSON 接口，ops 没有自己的 Seat guests 实现，暂不受影响）；G36 round-trip shuttle（Annie 的方案已定
      但后端代码还没写，等它上线、会带 `roundtrip` kind 到 `/manifests`、`/forecast`、Bus Manifest，到时再跟）；G38 Guide Manifest
      （还在提案阶段）。
    - 详见本次只读调查的 agent 报告（没有存文件，下次要看就重新查 `git -C <后端> log <上次检查点>..origin/main`）。

**2026-10-11 晚（家里）开工**：只读看了后端 main `3af7004..639dd24`（9 个提交）。要跟的只有 `7c03bd3`（Modified 状态 + Tracking「已处理」判据），
已做，见「后端 10-10 跟进：Modified 状态 + Tracking 页「已处理」按 notes_unhandled」小节；另外记了两条「需要后端」。
其余不用跟：G44 记录分批切换做法 B（ops 已做）和绝对地址扫描（`live_url`、Vehicles Open map、邀请链接 ops 都已改成同网址，见「分批切换」小节）、
G44 验收安排（Max 在 ops 上验三个发送页 + 各自 Tracking 页）、G45 登记、A9 收尾、交接记录。下次看后端从 `639dd24` 往后。

**收工（2026-10-11，家里 → 下次在公司电脑接着做）**：工作区干净、全部已推（`task/manifests-v2`，最新 `9fd01a5` 之后这条交接）；本地没有在跑的 dev / 模拟接口。
公司电脑开工：`C:Code
pe-ops-frontend` 里 `git fetch --prune`、`git switch task/manifests-v2`、`git pull --ff-only`、`npm install`（`lib/env.ts` 删了，别处没有新依赖）。
下一步：等 Max 测分批切换、等 Annie 验收今天这几项；Annie 还没回答 Broadcasting Log 里 `manifest` 分组显示成什么；照例先看后端 main 新提交（这次看到 `3af7004` 为止）。

**交接（2026-10-11，Annie 要重启电脑，家里）**：链尾 `task/manifests-v2`，已推远端（最新是这次交接的提交）。今天做了（各小节都在本节下面）：
dashboard Multi Orders 窗口（`f919716`）、Dispatch 跟后端 G33 Completed / Check the list / CCL 原文标红（`7b63aaa`）、Tour Tracking 群发 By pickup location（`a40f4ff`）、
Manifests 分节 + 勾选 + 发送（`409a28b`）、**分批切换：一个网址、一次登录**（`4059f4b`，交 Max 测，**没合 main**）；Bug Reports 页挂起。
- ✅ **全量回归 29 套全过**（2026-10-11 重启后，`4059f4b` 之后）：分批切换后清单为空，站内链接去同网址下的旧路径，所以改了这些套的**测试期望**（代码没改）：
  `imp`（侧栏 Dispatch Imports）、`mf`（卡片 Open manifest；「从排车页站内点进 manifest ⇒ ‹ Back 走后退」那条要等 Dispatch 和 manifest 都切换才会发生，先拿掉并写了注释）、
  `da`（离开提示那段改成直接打开排车页）、`tk` / `tour` / `tt`（View Tracking、侧栏 Tour Confirmation）；`tour` 的「✕ Cancel 回到表单」原来固定等 150ms 偶发失败，改成等表单出现。
  ⚠️ 以后切换某一页时，对应套里「（切换清单为空）」字样的检查要跟着改回新页面的路径。
- 另一个窗口（npe-ops-frontend-25）在 worktree `D:\npe-ops-frontend-dashboard`、分支 `task/dashboard-redesign` 做 dashboard 改版：
  **本窗口不改 `app/dashboard/**`、`components/dashboard/**`、`lib/dashboard*`**，要改先发消息给它。
  2026-10-11 晚它开始写代码，又加锁：`components/nav/**`、`lib/page-switch.ts`、`components/dispatch/`（它只加去 `/dispatch/imports` 的入口）、
  新页面 `app/forms`、`app/quotation`、`app/schedule`、`app/daily-report`。headless 用 3198 端口前双方互相先问。
  它合回链尾时要知道的（它 2026-10-11 晚告知，都只在它本地提交、没推）：已把 `origin/task/manifests-v2` 合进它的分支（`f4b2ccf`）；
  新侧栏默认收起，看侧栏条目的 headless 检查要先点 `button[aria-label="Open menu"]`（它已改 nav / imp / fc / da / tour 套，fc 的图表改找 `main svg`）；
  `lib/page-switch.ts` 加了 `opensInOps`，`components/ui/page-link.tsx` 改用它（现有调用行为不变）。合回以后本窗口新写的侧栏检查照这个做。已提醒它 dashboard 链接要继续走 `lib/page-switch.ts`。
- 等 Annie 回答：Broadcasting Log 里 Manifests 发的那类（group `manifest`）显示成 General（同旧版）还是别的。

**交接（2026-10-08 深夜收工，家里）**：链尾 `task/manifests-v2`，已推远端（最新 `4489ed2`，含另一个窗口 21:08 / 23:03 两条
「Manifests / Forecast 只算已确认的单，ops 不用改」的记录），工作区干净，本地的 dev server（3198）已关。今晚做了：
- 跟后端 10-08：Morning Tracking 的 Driver 链接 + Guest Viewed 列（`c63984e`）；HR G20 不用改。后端还没合进 main 的 G33、pickup-offset 等合了再跟。
- 全站照旧版改样子：外框（`8650599`）+ 全部页面（`b8179ce`）。tsc / eslint / build / 全量回归 29/29 都过。
- Annie 看过后定的两条（已做 / 已记）：深色底上的深色字改成浅色 ✅ 保留；Dispatch Step 1 卡片改回旧版写法、不放午餐等详情（`06e636a`）。
- 30 Days Forecast 旁支合进链尾（`fee938e`）并去掉和外框重复的底色（`06e636a`）；旁支和公司那台的 forecast worktree 以后不用了。
- 验收命令分家里 / 公司两条（`3c5cdeb`）。⚠️ Annie 在家里把整段终端输出粘回 PowerShell，其中 `npm audit fix --force`
  在 `C:\Users\annzh`（一个和 NPE 无关的旧练习项目，`package.json` 不在 git 里）改了 react-router / sequelize / nodemon 的大版本。
  已告诉 Annie，**没动**；她要用那个项目再说。以后提醒验收只给一行命令，并提醒「只复制命令那一行」。
- 下次开工：
  1. 等 Annie 并排看样子：「全站照旧版改样子」末尾还剩的几条（第 4 条旧版有、ops 没有的功能；第 5 条确认弹窗还是 ops 白底样式）。
  2. 差异清单（`docs/旧页面差异清单.md`）等 Annie 勾；注意这次改样子已经把其中一些「浅色页面」「紧凑筛选条」类的条目带回旧版了，她勾之前可以先对一下。
  3. dashboard Multi Orders 窗口（「待做」第 5 条），照旧 `dashboard.html` 搬。
  4. 照例先看后端 main 新提交（这次看到 `de83c6a` 为止），G33 / pickup-offset 合进 main 后跟。

**交接（2026-10-08 收工）**：链尾 `task/manifests-v2`，已推远端（`c8a3ade`），工作区干净，本地 `npm run dev`（3100）已关。
今天做了：
- 核对 `/manifests` 真接口（本地转发线上 confirm，Annie 账号登录）：标签 / 胶囊 / 字段弹窗 / Legacy 提示 / Cfm # 输入框 /
  CSV 导出 / Products Tour type 列都正常，见「`/manifests` 真接口核对」小节。
- 转发了后端 30 Days Forecast 接口确认（全员可见、排除已取消；2026-10-08 晚起 pending 也排除，见「待做」1b、明确不做的范围）给 `task/forecast-30day-page` 那个
  并行会话；它已经做完 `/forecast` 页并推了（`15f4bf2`），等它自己收工交接、或者下次开工去那个 worktree 接着看。
- **新加 Manifests 的 Cfm # 批量上传**（Max 要求，仿 HR 表格上传）：见「Manifests：Cfm # 批量上传」小节，细节、已知的
  ambiguous 分支没有专门 headless 用例、验收步骤都写在那一节里。
- ⚠️ 中途踩了一个坑：`npm run build`（生产构建）和本地 `npm run dev` 共用同一个 `.next` 目录，同时跑会把 dev 的
  `.next/static/development` 搞坏（`ENOENT _buildManifest.js.tmp.*`），页面变成 `Internal Server Error`。遇到就是
  删 `.next` 重启 `npm run dev`；以后要跑 `npm run build` 验证，先把本地 `npm run dev` 关掉，或者仿 `checks/headless` 的
  `.next-checks` 做法用别的目录。

下次开工：先看第 8 条的回归结果，然后回到「下一步」第 2 条——**全站深色化**还是最大的未动工项，一页都没改。

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

家里（AnniesPC，前端在 `D:\npe-ops-frontend`）：

```powershell
Set-Location D:\npe-ops-frontend -ErrorAction Stop; git fetch --prune; git switch task/manifests-v2; git pull --ff-only; npm install; $env:API_PROXY_TARGET='https://confirm.nationalparkexpress.com'; $env:NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL='https://confirm.nationalparkexpress.com'; npm run dev
```

公司（前端在 `C:\Code\npe-ops-frontend`）：

```powershell
Set-Location C:\Code\npe-ops-frontend -ErrorAction Stop; git fetch --prune; git switch task/manifests-v2; git pull --ff-only; npm install; $env:API_PROXY_TARGET='https://confirm.nationalparkexpress.com'; $env:NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL='https://confirm.nationalparkexpress.com'; npm run dev
```

然后浏览器打开 `http://localhost:3100/auth/login` 登录，登录后会进 `/dashboard`。链尾换了以后，把命令里的分支名一起换掉。
⚠️ 2026-10-08 晚 Annie 在家里粘了公司路径的那条：`cd` 失败后后面几条在 `C:\Users\annzh` 里接着跑了（没改到东西）。
所以开头改成 `Set-Location … -ErrorAction Stop`：路径不对就整行停下。**提醒验收时按当前是哪台电脑给对应的那条。**
从 `task/ops-login-cancel` 起，登录页走 ops 自己的转发，**不用再临时改 `next.config.ts`**。
2026-10-11 起（分批切换）ops 自己没有的路径全部转发：旧后台的页面、样式、`/admin/*`、`/tracking/*` 都在 localhost:3100 下打开，用同一个登录。命令里的 `NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL` 已经不用了，留着没影响。
如果命令报端口被占用，先关掉之前开的那个 `npm run dev` 窗口。

**本地验收环境的另两种搭法**（数据都是生产数据）：

- 本地后端 + 本地前端（README「本地登录」）：后端 `.env` 里**一定要设 `DISABLE_SCHEDULER=1`**（后端 2026-10-05 加的），
  不然本地后端会和线上一起跑邮件队列 / 23:59 日报，可能给客人重复发。
- 只开本地前端、转发到线上 confirm（公司那台没装后端依赖时用过）：`.env.local` 设
  `API_PROXY_TARGET=https://confirm.nationalparkexpress.com`、`NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL=http://localhost:3100`，
  并在 `next.config.ts` 的 rewrites 末尾**临时**加 `/auth/:path*`、`/admin/:path*`、`/static/:path*` 三条转发到同一目标（要试 Vehicles 的 Open map 再加 `/tracking/:path*`）
  （登录 cookie 才落在 localhost 上）。**这段不要提交**，用完撤掉。先打开 `http://localhost:3100/auth/login` 登录。

### dashboard 改版

- 分支：`task/dashboard-redesign`（从链尾 `task/manifests-v2` 的 `4059f4b` 拉出），单独的 worktree `D:\npe-ops-frontend-dashboard`，
  和主目录的 e6 窗口并行。约定：e6 不碰 `app/dashboard/**`、`components/dashboard/**`、`lib/dashboard*`；
  这边要改 `components/ui/page-link.tsx`、`broadcast-dialog.tsx`（以及整站共用的 `components/nav/**`）之前先 SendMessage 告诉 e6。
  本地 dev 用 3101 端口；headless 检查用 3198，跑之前先问 e6。
- **2026-10-14 Annie 给了最新 Work Checklist**（按时间排，岗位 Morning Assist / Pre Close / Closer / Dispatch），
  已录进任务包「初始任务清单 → 最新 Work Checklist」。Annie 同日定：**新表原样直接导入当种子数据，上线后由主管或 admin 在任务模板页面上改**；
  10-11 的旧清单不导入，仅供参考。
- 依据：Annie 2026-10-11 批准的任务包和可交互预览，放在 `docs/previews/dashboard-2026-10/`（预览代码是原型，不照搬）。
  任务包四个阶段：① Dashboard 外壳 ② 在线排班 ③ 任务框 ④ Daily Operation Report；每阶段**先交设计给 Annie 审，再写代码**，
  commit 后停下等 Annie 说 push。这次改版是 Annie 批准的、和旧版不同的地方，不受「和旧版一模一样」那条约束。
- 状态（2026-10-11 晚）：**阶段一设计 Annie 已审**（§4 四件事、§4b 预览后的改动、Quotation 都定了，见设计文件），
  **阶段一代码已写完、本地已 commit，没推**（任务包：commit 后停下等 Annie 说 push）。等 Annie 验收。
- 阶段一做了什么（前端；后端接口没好，先接模拟接口、读不到时回落内置默认值）：
  - 侧栏（整站，`components/nav/`）：宽屏默认收起成 56px 窄条，☰ 展开 260px 推开内容；分组不折叠、条目平铺；每个条目可拖到
    My shortcuts、右边钉子钉住 / 取消（任何页面都能钉）。条目：去掉 Dispatch Imports / Work Sheet / Guide Sheet，加 Quotation（Orders 后）、
    Forms、Staff Schedule、Daily Operation Report；后三个 + Quotation 中的没页面的标 SOON，能点能拖能钉，点了进占位页。
    名字 / 分组 / 顺序 / 显不显示 / 默认快捷方式来自 `GET /api/nav-config`（`lib/nav-config-api.ts`），代码里只固定 id ↔ 路径（`nav-config.ts`）。
  - Dashboard：发送卡片缩小一档；问候说明不限宽；新 My shortcuts（拖入 / 排序 / × / Reset to default，每次改动存 `user_prefs.dashboard_shortcuts`，
    存不上退回并写原因、可 Try again）；Today's tasks、Daily Operation Report 占位框；Messages 每窗只露前两张卡片的实际高度。
  - 新页面：`/forms`（Work Sheet / Guide Sheet 入口）、`/quotation`、`/schedule`、`/daily-report`（占位）、`/settings/navigation`（superadmin 改侧栏配置，存了立即生效）。
  - Dispatch Step 2：Pull from Discord 旁边加「Import history →」去 `/dispatch/imports`（Annie：入口放在方便的地方）。
  - `lib/page-switch.ts` 加 `opensInOps`：旧后台没有的页面（上面这些新页面）不管切换清单都在 ops 里打开。
- 检查（2026-10-11 晚，已把链尾 `task/manifests-v2` 合进本分支后跑）：tsc / eslint / `npm run build` 通过；`node checks/page-switch-check.mjs` 17/17；
  headless 新增 `dr` 套 **50 / 50**；全量回归 31 套都过（`bugs` 一次偶发 1 项、重跑 40/40；`tour` 原来有一次 Cancel 偶发，
  侧栏检查改成看完就收起后连跑两次 52/52；`users` 要先在 `checks/headless` 里 `npm install`）。
  `nav` / `imp` / `fc` / `da` / `tour` 套跟着新侧栏改（侧栏默认收起要先点 ☰；Work Sheet 算在 Forms 下；导入页算在 Dispatch 下；
  fc 的图表改成找 `main svg`，侧栏多了一个 ☰ 图标）。**没有连真实后端测**（后端 A / B 还没做）。
- ⚠️ 不算阶段一完成的部分（设计 §2.4）：要等后端 A（nav-config 读 / 存 + 种子）、B（`dashboard_shortcuts` 进白名单）上线、
  配置页能改且改完立即生效才算；C（说明文字可在 Content Studio 改）还没做，现在说明文字写在代码里。
  **连真实后端时现在钉 / 拖快捷方式会存不上（后端白名单没这个键），框里会写原因并退回——这是预期的过渡态。**
- 需要后端（设计 §3，写在这里而不是「需要后端」一节，避免和主目录的窗口改同一处；种子数据要加上 Quotation，条目 id 见设计 §3）：A 侧栏配置 + 默认快捷方式的读 / 存接口和种子数据；
  B `user_prefs` 加键 `dashboard_shortcuts`；C 说明文字按 Content Studio 做法可改。
- 提前报告的 Stop Conditions（影响阶段二～四）：后端**没有「主管」角色**（只有 superadmin / admin / staff）；权限按角色判断，**没有「权限项」机制**。
- 下一步：Annie 验收阶段一（下面「验收步骤」）、说 push；Annie 把设计 §3 的 A / B / C 转给后端窗口；后端好了以后连真接口再测一次。
  阶段二（在线排班）动手前先交设计，并先解决 §5 的 Stop Conditions（没有主管角色、没有权限项）。
- 合回链尾 `task/manifests-v2` 时：f8 窗口说链尾 4059f4b 之后有 9fd01a5、b969355、5e3ed83（conversation-preview / tracking / promotion-stats）、
  CLAUDE.md 蓝色按钮规则、man 套分批检查，留意 CLAUDE.md、PROGRESS.md 冲突。

**阶段一验收步骤**（只读，除了钉快捷方式；连真实后端时快捷方式存不上是预期的，见上）：

1. 打开 `/dashboard`：左边是窄条（☰ + NPE）；点 ☰ 展开，分组平铺不折叠，Operations 依次是 Dashboard、30 Days Forecast、Manifests、Orders、
   Quotation（SOON）、Dispatch、Forms、Staff Schedule（SOON）、Daily Operation Report（SOON）；没有 Dispatch Imports / Work Sheet / Guide Sheet。
2. 点 Forms：侧栏保持展开，Forms 页有 Work Sheet / Guide Sheet 两个入口；点 Quotation：Coming soon 占位页。刷新页面：侧栏又收起。
3. Dashboard：发送卡片比原来矮；My shortcuts 标题旁一行用法说明；Today's tasks、Daily Operation Report 是占位框；Messages 每个窗口只露两张，窗内滚动。
4. 从侧栏拖一个条目到 My shortcuts / 点钉子（连真实后端现在会提示存不上并退回——后端加了白名单键以后再试一次能存住，换台电脑登录也一样）。
5. Dispatch → Assign → Step 2：Pull from Discord 旁边有 Import history →。
6. superadmin 打开 Settings → Navigation：写明还在用内置默认值（后端接口没好，保存会失败）。
- 交接（2026-10-11，家里收工，转公司电脑）：分支已推到远端。公司那台先 `git fetch`、切到 `task/dashboard-redesign` 接着做
  （公司那台没有这个 worktree，直接在仓库里切分支即可；后端仓库在 `C:\Code\npe-confirmation-service`）。
  上面 3101 / 3198 端口、和 e6 的约定是家里两个窗口并行时定的，公司那台如果只开一个窗口就不用管。
- **交接（2026-10-11 晚收工，家里）**：`task/dashboard-redesign` 已推（`0b9a9be` 之后这条交接），工作区干净，本窗口没有在跑的 dev / 模拟接口（3198 / 8799 已还给 f8）。
  今晚做了：
  - 把链尾 `origin/task/manifests-v2`（到 `b101040`）合进本分支（`26b403e`）：`/forecast` 是 60 天页了。tsc / eslint / build、`fc` 49 / `nav` 23 / `dr` 50 全过。
  - Annie 定了几条，都写进了「需要后端」开头（**Annie 要自己转给后端窗口**，后端不看本仓库 PROGRESS；转的那段话在对话里给过她）：
    ① Forecast 的 Sunset 是独立一条线（关团、CCL 的车分块）；② Products 加组管理（新建 / 改名 / 停用 / 排序）；
    ③ 组排序全站一个，先用 SQL 改成 CCL 样表顺序；④ 块里小行顺序要能设。
  - Annie 10-09 真机验收的两条（线路顺序、Antelope 不拆行）查清不是前端代码问题，见本节上面「60 Days Forecast」那段。
  - 新记的原则（也存进了 memory）：**前端靠配置显示的，管理界面必须能设，并告诉 Annie 在哪设**。
  - 和链尾窗口 f8 撞过一次 3198：**用 headless 前先发消息问、等到回复再开始**。f8 提醒：链尾新加了全深色主题底子（`app/layout.tsx` 等），下次合链尾时留意 `app/layout.tsx`。
  - ⚠️ 本分支 PROGRESS 改了链尾那段「60 天 Forecast 搬进链尾」里的一句（西峡 / Sunset 已定），并在「需要后端」开头加了 4 条——合回链尾时 PROGRESS 可能冲突，已告诉 f8。

  **下次开工**：
  1. 等 Annie 验收：dashboard 阶段一（上面「阶段一验收步骤」）+ 本分支的 Dispatch（Seat guests、步骤条、Check the bus、按人数开车窗）。
  2. 等 Annie 在 Products → Manifest setup 给 Antelope 30 个产品填 Section（UPPER / LOWER / X），然后在 Forecast 上看是否拆成三行。
  3. 后端做了「需要后端」那 4 条以后：Sunset 连真接口看一次；组管理、节顺序照旧页面跟到 ops 的 Products（`components/products/`）。
  4. 照例先看后端 main 新提交（这次看到 `639dd24` 为止）。阶段二（在线排班）动手前先交设计，并先解决 §5 的 Stop Conditions。

### Dispatch：Seat guests 放到每台车下面（Annie 2026-10-11 定；ops 已做，旧页面要后端）

- **ops 已做**（2026-10-11 晚，`task/dashboard-redesign`）：`components/dispatch/seating.tsx`，接 `GET /api/dispatch/seating`、
  `POST /api/dispatch/seating/move`（后端 main 已有）。Step 2 每台**已保存**的巴士团车下面一行「N orders · N guests · 坐了几 / 几座」（超座位红字），
  默认收起，点开列订单（名字、单号、几位、接客时间地点、换车下拉 Bus A… / Auto，staff 挪过的写明）；订单可拖到同一团另一台车；
  一台车的团写「all N guests ride this bus」；没坐上车的在这个团最后，橙色「Not on a bus」；名单没传 / 字母没填好 / 有没存的改动时写一句说明；
  挪车出错写在这个团下面。换天、保存、Copy、Step 1 Apply、挪车以后重读。How to use 加了三条。没有单独的 Step 3。
  检查：tsc / eslint 通过；headless `da` 套 99 → **112 / 112**（13 项 Seat guests），`mf` 41/41。**没有连真实后端测过。**
- ⚠️ **自动从 Rezdy / main manifest 进 Dispatch 还没有**（2026-10-11 查后端 main）：Seat guests 的客人只来自 Step 1 上传的 CSV；
  「每天订单自动进 Dispatch、不再上传 CSV」是后端待办 **G35**，10-09 先放下、没写代码（Annie 定过：全自动、旧页面手动上传留作后备；
  还没答：名单多新——打开 Dispatch 时刷新还是实时推送）。G35 做了以后再列哪些旧功能（Step 1 上传等）可以拿掉，先给 Annie 看。
- **Assign / Send 改成步骤条**（Annie 2026-10-11 看过三种方案后选 B：原来的小标签找不到；步骤条一看就是功能、跟下面的巴士分开）：
  「FIRST Assign › THEN Send」两大块占满整行，每块一行小字说里面有什么，当前那块琥珀色框 + 底线，有没存的改动时 Assign 上挂「N unsaved」。不用蓝色。
- **Step 1 卡片 Check the bus**（跟后端 `cb3887d`，链尾窗口转给本窗口做）：Assign Bus 改名 Check the bus；团名下橙字写问题
  （Needs saving / Buses need letters / N guests need an extra bus（`buses_needed` > 已存车数）/ N guests awaiting seat assignment），
  有问题时不再挂右上角标签；能解决问题的按钮才实心（深蓝 `TM_BTN_BLUE`，同 ops 原来的样子）；没传名单时 Upload 实心；
  「awaiting seat assignment」时多一个 Seat guests 键——**跳到 Step 2 这个团的车、展开车下面的名单**（ops 没有单独的 Step 3，和旧页面不同，已按 Annie 的新版面）。
  How to use 那一条跟着改。Discord 拉取时间挪到按钮旁：ops 本来就在旁边。
- **按人数自动开车窗（G29 第 3 条，Annie 2026-10-11 说要做，照旧页面 `openWindows()` / `notNeededRows()` 搬）**：
  `components/dispatch/bus-windows.ts`。⚠️ **和旧页面不同（Annie 2026-10-11 纠正）：名单一到就补开，不等 CCL**——CCL 的排车只是确认：
  它来了以后把司机、车填进前几台（只有补开的空车时照样预填，空车不算动过手）；CCL 只给一台而人数要两台时，多出来的空着，staff 去安排 farm out。
  Discard 以后按人数该有的空车照样补回来。Step 1 的卡片（`buses_needed`、`bus_pax`）一到，巴士团的车不够就补开
  （要两台以上时每台编字母 A、B…，没字母的旧车也编上；CCL 关了的团不补；最多 A–E），**不保存**，staff 照常 Save schedule。
  名单变少时多出来的车整块标黄「Not needed for N guests」+ Remove，**不自动删**（没人坐的先标，坐了人的留着）。How to use 加两条。
- 右下角 ↑ ↓ 浮动键改成蓝色粗箭头（Annie 2026-10-11：「反正也是功能键」，照旧页面 cb3887d；链尾窗口在 CLAUDE.md 蓝色规则里补一句）。
- 检查：tsc / eslint 通过；headless `da` **122 / 122**（加了按人数补开、CCL 只给一台时 B 留空、名单变少标黄 + Remove、Discard 后补回）、`mf` 41/41、`nav` 23/23、`dr` 50/50。
- 侧栏「30 Days Forecast」改名「60 Days Forecast」（链尾窗口把 60 天 Forecast 搬进了链尾，路径还是 `/forecast`）。
  **2026-10-11 晚已把链尾 `origin/task/manifests-v2`（到 `b101040`）合进本分支**，`/forecast` 现在是 60 天页（浏览器标题也改成 60 Days Forecast）。
  冲突只有 `fc-test.js` 里旧的 30 天图表检查（页面已经没有图表，用了链尾的版本）。Sunset 按 Annie 的新决定改了 `fc` 的模拟数据和预期（见「需要后端」第一条）。
  tsc / eslint / build 通过；headless `fc` 49/49、`nav` 23/23、`dr` 50/50。
  - Annie 10-09 真机验收的两条（`f0cf779`，之前一直没复查）2026-10-11 查清，**都不是前端代码问题，没改代码**：
    ① 线路顺序 = 后端按组 `sort_order`，没有界面能改 → 「需要后端」组管理那条（含先用 SQL 改成 CCL 顺序）。
    ② Antelope 不拆三行 = 细行来自 Manifest setup 的 Section，v83 删掉了 v79 预填的 Upper / Lower / Canyon X，30 个 Antelope 产品的 Section 没填 →
    只有一行、和 Total 一样被收起。**Annie 在 Products → Manifest setup 选 Antelope 给每个产品填 UPPER / LOWER / X**（shuttle 选 Shuttle outbound / inbound）就会拆开，Manifests 也跟着按节分。
- 🔴 **数据流水线**（Annie 2026-10-11）：**Rezdy → Order List → Main Manifest → Dispatch → 再分流到各种表格**（Bus Manifest、Work / Guide Sheet、司机手机页、发送等），每站只读上一站、不跳站。
- 🔴 **Dispatch 的订单来源**：新前端**不上传 CSV**，订单从 main manifest **按 Group 拉到各团的巴士**
  （main manifest 行的 Group = `manifests.id` = Dispatch 巴士团块的 `manifest_id`）。main manifest 靠 Rezdy webhook 几秒内更新（每晚 3 点对账兜底），
  所以 G35：每次打开 / 刷新 Dispatch 时从同一份数据（`rezdy_lane`，只算 confirmed）同步。**不可以跳过 main manifest 直接去 Rezdy 拉**（Annie 明确说）。已写成一段话请 Annie 转后端。
  G35 上线前 ops 的 Step 1 上传留作后备。
- Annie 2026-10-11：**Dispatch 要跟 Manifests 一起切换**（另一个窗口已记进链尾 PROGRESS「切换」）。

- 背景：旧后台排车页 G29 第二批加了单独的 Step 3「Seat guests」（后端 `c5b8633`，`_seat_guests_panel.html`，接口 `/api/dispatch/seating`）。
  ops 的 `/dispatch` 还没有这一步。
- **Annie 定**（和旧版不同，已同意）：
  - 不再单设 Step 3，每台车装了哪些订单、几位，**放在 Step 2 那台车的下面**。
  - **两边都改**：ops 补 Seat guests 时照这样做；旧后台排车页也要改——**要后端**，请 Annie 转给后端窗口。
  - 车下面的名单**默认收起**，只显示一行「N orders · N guests ▸」，点开看名单，名单里仍可拖动 / 下拉换车（同旧版 Step 3）。
  - **装不下的订单 = farm out**（转包给合作公司）。方案已定稿：[docs/farm-out/任务包_farm-out.md](docs/farm-out/任务包_farm-out.md)
    （Annie 2026-10-10 定稿、10-11 给到本仓库；Annie 说「动手」后生效）。要点：第二台车带 Farm out 键，设成 Farm out 后不要司机 / 车号；
    客人用 Seat guests 整单分到 Farm out 车（系统不判断、不自动转，装不下的单子照旧标出来，由 staff 自己挪）；每单选酒店，时间按时刻表自动算、可逐单改；
    发转单通知（短信 + 邮件，模板在 Content Studio）；relay 司机页多一栏；财务报表。
  - farm out 分三阶段：① 后端 ② 旧 Dispatch 页 ③ **ops 新前端**——ops 要等前两阶段做完、接口就绪再做，到时先读任务包「上游依赖」对应的现有代码，
    先交设计再写代码。和「Seat guests 放到每台车下面」一起做：Farm out 车也是 Step 2 里的一台车，它的客人名单同样放在车下面、默认收起。
    ⚠️ 后端做阶段 ② 时也要知道 Seat guests 挪到每台车下面这条（Annie 转后端时两件一起说）。
  - 2026-10-15 Annie 说「来做 farm out」：查后端第①阶段还没开始。Annie 选「先出 ops 预览 + 后端需求」：
    预览 https://claude.ai/artifact/Esk6ppEZUgyewaz1gzpR4F （Dispatch Farm out 车 + 车下名单、发通知弹窗、合作公司、时刻表、报表，附 4 个要 Annie 定的问题），
    接口清单写进「需要后端」。**下一步**：等 Annie 回预览和 4 个问题 → 发后端 → 接口就绪后从 main 拉 `task/farm-out` 写代码。
  - ✅ **原预览的 4 个问题 Annie 10-15 晚回「照建议」，只改第 2 条颜色**（⛔ 不再问）：① 在 Farm out 车上选一次合作公司，这台车的单都算这家；只有第二台车有 Farm out 键（同团同天只转一家）；
    ② Farm out 车用**灰蓝色**（约 `#475569`；淡紫跟 Antelope 团色撞，Annie 选灰蓝不选虚线框）；③ 侧栏 Operations 加「Farm out Report」，合作公司和时刻表放 Settings；④ 结算价 / 时刻表只有 admin 能改，staff 只在 Dispatch 逐单改时间和应付。
  - **2026-10-15 晚 Annie 又定 3 条**（家里窗口问的，⛔ 不再问；补充预览 https://claude.ai/artifact/YGcjPah4msGYZ4Uf2ufxkL ，附 3 个小问题等 Annie 回）：
    ① **Content Studio 加 Farm out Notice 模块，每家合作公司一份**（照门票按供应商分）：Default + 每家公司；新公司自动从 Default 复制；发通知用这单转给的那家的版本；通知里照旧不写公司名。改了任务包第 12 条（原来只有一份）。
    ② **短信和邮件分开**：Email 标签（标题 + 正文，正文 = 任务包原文）、SMS 标签（短文字），每个标签都按公司分。
       ✅ Annie 确认：邮件标题默认「Your {tour_name} pick-up on {tour_date}」；短信以「Dear {first_name},」开头（模板多一个 `{first_name}` 占位）。Email 正文仍是原文、没加称呼。
    ④ **合作公司的上车点 / 时间单独一套**（Annie 10-15 晚，⛔ 不再问）：上传文件里的酒店不跟我们的 Pickup Locations 对应，每个都建成这家公司自己的上车点（名称、位置、地址 / 地图链接）+ 时间。
       转单订单两套都留：我们的（Rezdy / Main Manifest 原样）+ 合作公司的（Dispatch 里从那家公司的上车点选、按它的时刻表算、可逐单改）。
    ⑤ **查单时先给哪套**（Annie 10-15 晚）：从**发出 Farm out 通知**起到**合作公司发车时间后 1 小时** ⇒ 合作公司那套放最上面、黄色「Answer with this」；其余时候（没发通知 / 已过）⇒ 我们的在上面，合作公司的写「Use on tour day」。
       每处都写「Do not tell the guest the partner's name」。出现在：顶栏订单搜索浮窗、订单详情、Tour Tracking 展开、Dispatch 车下名单（staff 还会在哪查，Annie 没补充）。**电话 AI（`voice_lookup.py`）也要按同一规则——后端做。**
       预览第 5 版 ④ 一块：https://claude.ai/artifact/YGcjPah4msGYZ4Uf2ufxkL 。
    ③ **发车时刻表每家公司各一张，可上传 CSV / xlsx**：先选公司；文件表头 `Hotel, Spot, 团名…`、格子是发车时间；上传后先列出变化（改了的格子、新酒店、对不上的团），Apply 才替换这家的整张表；可下载现在的表当模板。
       Dispatch 按这单转给的公司的表算时间（集合 = 发车 − 10 分钟）。预计返回时间、PLEASE NOTE 仍按团一份、各公司共用。改了任务包「转单发车时刻表」（原来一张）。
- 做的时候一起定：Step 1 卡片「Check the bus / Seat guests」新文案要不要搬进 ops（见「进行中」第 10 条，还等 Annie）。

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

### dashboard Multi Orders 窗口

- 分支：`task/manifests-v2`（链尾，直接在上面做，没有另开分支——这是补已上线 dashboard 的一块缺口，不是新页面）。
- 状态：代码已完成，tsc / eslint 通过；headless `mt` 套 **124 / 124 通过**（2026-10-10 重跑）；**没有连真实后端发过消息**；等 Annie 验收。
- 背景：旧 `dashboard.html` 2026-10-01 加的第四个窗口（见 PROGRESS 历史「待做」第 5 条）：号码 / 邮箱名下有 ≥2 张没出发的单时，
  来信不挂单、进这里；还有「一单多团期」的卡（一张单有 ≥2 个没出发的团期，本来要进 Tour 窗口，只出一张卡）。
  ops 的 Messages 区 09-30 做的时候只做了前三个窗口，这个一直漏着，员工全部切换前必须补（已写进「切换前检查清单」的前提）。
- 接口：都走已有的 `GET /api/notifications/unhandled`（`lanes.multi` 这次补上，形状和后端现有实现一致，没有改后端）；
  三个动作 `POST /booking-notes/multi/reply`（真实发送）/ `/multi/assign` / `/multi/take-action`（不在 `/api` 下，
  `next.config.ts` 新加一条转发 `/booking-notes/multi/:action`）。
- 与旧页面一致：窗口只在有卡片时出现（平时还是三个窗口）、粉色车道、「N orders」徽章、WhatsApp 窗口倒计时、
  已回过在等客人的卡显示「Replied · waiting for guest」且不计入红胶囊、thread 多于一条时显示整段对话（否则只显示最后一句，
  3 行截断）、Reply / Assign to order / Take action 三个按钮、Assign 和 Take action 共用选单（Take action 名下没有没出发的单时
  不经选单直接关）、「一单多团期」卡的 `1 order · N dates` 徽章和逐行团期、404（地址对不上库里的对话 / 已经被处理掉）时把后端
  `detail` 原样显示在卡片里、发送失败时卡片和文字都留着可以重试。
- 实现上和旧版不同但效果一致的地方（不算「功能差异」，不用等 Annie 勾）：展开的面板、草稿、选中的单这些状态放组件自己身上
  （React 按 `address` 复用组件实例），不用像旧版手工在整块 innerHTML 重画前后搬运 DOM 状态；按钮禁用只锁当前这张卡，
  不像旧版锁全部卡片（旧版那样做是因为它重画整块 DOM，这里每张卡是独立组件，互不影响，效果一样）。
- 与旧页面的差异：无（这块是直接补缺口，不是新设计，照旧版行为做）。

**headless 检查**（模拟接口，`mt` 套新增，2026-10-10）：覆盖窗口只在有卡片时出现、不挂单卡的姓名 / 徽章 / 两张单号产品名 /
今天的单显示 Today、一单多团期卡的徽章和逐行团期、等客人的卡不显示等待时长、红胶囊不算等客人的卡、Reply（空着报错 / 发送成功
面板收起并立即重拉 / 发送失败文字留着）、Assign（不选单报错 / 选单后 Move 的请求体）、Take action（有单先选单、没有单直接关）、
后端 404 时把 detail 显示在卡片里。`node run-all.js mt` 跑通过，结果写进 `checks/headless/logs/mt.log`。

**验收步骤**（⚠️ Send → 会真实发短信 / 邮件给客人；本地连真实后端时只用 Annie 自己名下、号码 / 邮箱下真的有 ≥2 张没出发单的对话测，
或者等后端真的出现这类客人来信再看）：

1. 切到 `task/manifests-v2`，同 CLAUDE.md 的本地登录方式启动前后端，打开 `http://localhost:3100/dashboard`。
2. 平时（没有不挂单的对话、没有一单多团期）只看到三个窗口，Multi Orders 不出现。
3. 找到这类客人来信时：第四个窗口出现，粉色；卡片上姓名 / 地址 / 徽章 / 名下没出发的单列表和旧后台 `/admin/dashboard` 并排看一致。
4. 点 Reply：和旧页面一样弹文本框，写一句话、Send → 对方收到；再点 Assign to order：选一张单、Move → 这条对话挂到那张单上，
   从 Multi Orders 消失，去对应的 tracking 页能看到这条消息。
5. 一单多团期的卡：点进去是对应 tracking 页，和旧页面一致。
6. Take action：名下还有单的先选一张单再关；已经没有单的直接点一下就关，不弹选单。

### 后端 10-08 ~ 10-10 跟进：Dispatch（2026-10-11）

- 分支：`task/manifests-v2`（链尾）。都是旧排车页已上线的改动，照搬到 ops 的 `/dispatch`，接口都已在后端 main。
- **Step 1 Guest lists — G33 Completed**（后端 `2800b7c` + `dedcd97`，`migrate_v78` 已在生产执行）：
  所有团都传完 CSV 后，卡片下面出现 **Completed — all tours loaded**；点了 `POST /api/dispatch/manifests/complete`（表单 `date`），
  重拉后显示「Guest lists completed by 谁 · 洛杉矶时间」，并滚到 Step 2 开头。共享、持久化，没有取消键；任何一团重传后端自动清掉，
  前端只读 `GET /api/dispatch/manifests` 顶层的 `guest_lists_done`。
  - 同一个包里旧页面还改了两处，一并照搬：**差异表改成居中弹窗**（用共用的 `components/ui/modal.tsx`，Esc / 点背景 = Cancel，Apply 中不关）；
    **传完的团排到最后**（已传的按传完先后，没传的保持原顺序）。How to use 补了对应三条。
  - ⚠️ 没搬：旧页面 How to use 里「Check the bus / Seat guests」「Apply 后 Step 2 自动开够车」那几条——前者等 Annie 定（见「下一步」第 10 条），
    后者 ops 没有 Seat guests。
- **Send 标签 Step 1 Send to drivers**（后端 `8cdacda`，Annie 跟后端看过两轮样稿定的）：按钮 **Send to driver → Check the list**；
  按钮下面一行提示，打开这一天就自动拉（不用点）：有发不了的司机时橙字「N drivers can’t be texted — …」，否则「Last sent …」/「Not sent yet」；
  名单每人一个勾选框 + 表头全选，默认全勾，发不了的灰掉不勾；`POST /api/dispatch/driver-notice/send` 每次都带 `recipients`（勾选的 key，
  `hr:<id>` / `typed:<名字>`，按 key 认人不按下标）；确认框只列勾选的人，取消勾了的写「N selected driver(s) will NOT receive this message.」（照旧页面原话）。
  - ops 原有的「Send texts now 前先重读名单」保留：重读时保留这次的取消勾选，新出现的能发的人默认勾上；
    点 Check the list、发完重拉都从全勾开始（同旧页面每次 renderDrivers 都全勾）。
- **Step 2 CCL 原文**（后端 `66bce1e`）：CCL 有读不懂的行时原文**默认展开**、那几行标红（Discord 的 `*_~\`` 首尾符号剥掉再比，原文一字不改），
  蓝条 / 琥珀条的提示改成「… could not be read - see below.」；都读懂了照旧收起。换了一份 CCL（预填 / 改版）按新那份重新定开不开。
- 不用跟：`fc3593c`（dashboard 改期卡显示改期内容，纯后端改 `body`，ops 原样显示）。
- 检查：tsc / eslint 通过；headless `da` 套 **98 / 98**（新增 CCL 默认展开 / 标红 / Hide-View、改版默认收起、提示行两种、Check the list、
  勾选 / 全选 / 取消、请求只带勾选的 key、确认框写不会收到几位、重读保留取消勾选、发完从全勾开始）；`mf` 套 **42 / 42**
  （新增弹窗、Esc / 点背景不 Apply、卡片顺序、Completed 出现条件 / 请求 / 显示 / 滚到 Step 2 / 重新打开还在、How to use）。

**验收步骤**（⚠️ 第 4 步会真实给司机发短信；只在 Annie 同意的那天、只勾 Annie 自己时点 Send texts now）：

1. 打开 `/dispatch`，和旧后台 `/admin/dispatch` 并排看同一天。
2. Assign → Step 1：传完 CSV 的团排在后面；Re-upload 一个团的 CSV，差异表是居中弹窗，按 Esc 关掉不改数据。
   全部团都传完时出现 Completed — all tours loaded；点了页面滚到 Step 2，按钮变成「Guest lists completed by …」，旧页面刷新也显示已完成。
3. Step 2：CCL 有读不懂的行的那天，原文默认展开、那行红字，和旧页面一致；都读懂的那天默认收起。
4. Send → Step 1：没点之前按钮下面就有一行提示（和旧页面同一句）；点 Check the list，名单每人一个勾选框，取消勾选后
   Send texts now 的确认框只列勾着的人。

### 分批切换：一个网址、一次登录（2026-10-11，交给 Max 测）

- Annie 2026-10-10 定（取代 10-03 的一次性切换）：现在能正常工作的页面就准备替换，但**不接受 staff 登录两个网站**。
  不改登录 cookie 的域、不改后端。分支：`task/manifests-v2`（链尾）。**没有合 main**——Annie 2026-10-11：东西先做好，交给 Max 测，他知道怎么测。
- **转发**：`next.config.ts` 的 rewrites 加 `fallback: /:path* → API_PROXY_TARGET`。ops 自己的页面和原有的点名转发先匹配，
  剩下的（旧后台页面 `/admin/*`、样式 `/static/*`、旧页面调的 `/send/*` `/booking-notes/*` `/tracking/*` 等、注册页 `/register/*`）都原样转给后端，
  网址仍是 ops 的。登录本来就走 ops 的转发（后端 Set-Cookie 不带 domain ⇒ cookie 只属于 ops），所以旧页面带的就是这个 cookie，不用再登录。
  原来验收环境里要临时加的 `/auth`、`/admin`、`/static`、`/tracking` 转发都不用再加了。
- **一处配置** `lib/page-switch.ts`：`MIGRATED_PAGES`（ops 路径 ↔ 旧路径，照旧后台侧栏）+ `SWITCHED`（已切换的 ops 路径，**一开始是空的**）。
  - 清单里的页面：旧路径 307 跳 ops 新页面（`next.config.ts` 的 redirects 由它生成；带查询串的 coming-soon 只在 module 对上时跳）；
  - 首页 `/`：Dashboard 切换了进 `/dashboard`，否则进旧后台 `/admin/dashboard`（原来写死 `/` 和 `/admin/dashboard` 都跳 `/dashboard`，已改）；
  - 侧栏、dashboard 快捷卡 / 消息卡片、页面里互相链的 11 处（新组件 `components/ui/page-link.tsx`）：已切换 ⇒ 新页面，没切换 ⇒ 同网址下的旧路径。
    侧栏去掉了「old ↗」标记；在没切换的新页面上（验收时）当前项照旧高亮。
  - 切一页：把 ops 路径加进 `SWITCHED`，推 main 重新部署。
- 顺带改成同网址：Users 的邀请链接（`<ops>/register/<token>`，新员工注册完就在 ops 登录）、Vehicles 的 Open map、
  Morning Tracking 的司机链接和 Bus # 的 live_url（后端拼的是 confirm 地址，前端换成同网址下的 `/tracking/vehicle-live`）。
  `NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL` 不再用（删了 `lib/env.ts`），Railway 上这个变量留着也没影响。
- 检查：tsc / eslint 通过；`node checks/page-switch-check.mjs` **15 / 15**（清单为空、切了几页两种情况的跳转 / 链接 / 对照表）；
  headless `nav` 套加了转发检查（旧页面经 ops 打开、cookie 原样带给后端、`/static` 样式、表单 POST 和后端的 303 跳回站内、Set-Cookie 落在 ops、
  首页跳旧 dashboard、清单为空时旧 dashboard 不跳），`nav` / `mt` / `users` / `veh` 期望改成清单为空时的链接，全部通过。
- ⚠️ 已知、要后端才能改的（不影响「只登录一次」，staff 不太会碰到）：
  - 旧版 Users 页（还没切换时）的邀请链接是后端按请求地址拼的，经转发是 confirm 的地址——新员工会在 confirm 注册、登录。
    ops 的 Users 页没有这个问题；切换 Users 页后自然消失。
  - 旧版 Morning Tracking 页 Bus # 的实时位置链接是后端拼的 confirm 地址（`TRACKING_BASE_URL`，客人短信也用它，不能改）。
    点开会要求在 confirm 登录；ops 的 Morning Tracking 页已换成同网址。
  - 后端如果对某个地址做「补斜杠」之类的自动跳转，会跳成 confirm 的完整地址；目前没找到这样的旧页面，Max 测时留意地址栏有没有变成 confirm。

- 样式核对（同一份需求里的「样式另记」，2026-10-11 对着后端 main 的模板逐页看）：Tour tracking 旧版浅沙色（`--sand`）、
  Tickets tracking 浅色 `#f0f4f8`、Morning tracking 深色 `#0d1b2e`；三个发送页和 Send Log 套 `base.html` 深色外壳、里面白卡片。
  ops 这几页现在**已经是这样**（Tour `#f4f0e6`、Tickets `#f0f4f8`、Morning `#0d1b2e`；发送页 / Send Log 深色外壳 `#06101c` + 白卡片），**没改**。
  现在旧页面和新页面在同一个网址下，Annie / Max 可以直接并排看，有不一样的再记下来。

**给 Max 的测试步骤**（本地前端转发线上 confirm，或线上 ops 的预览部署；都连生产数据，**不要点发送**）：

1. 打开 ops 的 `/auth/login`，登录一次。之后全程不应再出现第二次登录。
2. 打开 `/`：跳到 `/admin/dashboard`，看到的是旧后台的 dashboard，样式正常，地址栏仍是 ops。
3. 点旧后台侧栏里的几页（Products、Pickup Locations、Order Log、Send Log 等）：都是旧页面、样式正常、地址栏一直是 ops。
4. 在一个旧页面上改一处再改回来（例如 Products 里一个 `ZZ Test` 产品的字段，或 Pickup Locations 里 `ZZ Test` 开头的记录），保存成功、刷新后还在。
5. 切换：在 `lib/page-switch.ts` 的 `SWITCHED` 里加一个，例如 `"/send-log"`，重启前端（线上要重新部署）。
   打开旧路径 `/admin/notifications/send-log` ⇒ 自动跳到 `/send-log` 新页面，不要求登录；从旧后台侧栏点 Send Log 也一样。测完把清单改回空。
6. 客人页面（确认页、短链）还是 confirm 的地址，打开正常；直接打开 confirm 的后台照旧能用（那边要另外登录，这是预期）。

### `/manifests`：分节 + 勾选 + 按名单发送（2026-10-11）

- 分支：`task/manifests-v2`（链尾）。后端 main-manifest-sections 三步都已上线（`b84cf37` 分节 / `1880fc1` 自定义消息 / `1a559df` 发确认和提醒），
  Annie 2026-10-09 定的 10 条决定 + 下午改的「巴士 tour type 不预选」照做；样子照她看过的样稿第 3 版（`claude.ai/artifact/BMgxaqnb5m77dsz13Egkub`），
  套进这页现有的深色外框 + 白色表格。
- **分节**：`GET /api/manifests` 的 `sections` 非空时（只有 Bus、设了 Manifest setup section 的组），每节前插一行节标题（节名 + 几单 · 几人，
  团按先后轮流紫 / 绿 / 粉 / 蓝底，shuttle 橙底），节标题的框 = 全选这一节。Export CSV 分节时第一列加 Section。
  ⚠️ Antelope 那 30 个产品的 section 还要 Annie 在 Settings → Products → Manifest setup 填一次（UPPER / LOWER / X，shuttle 设 outbound），不填就照旧一张表。
- **勾选**：第一列勾选框，表头左上角带文字的 **Select all**（只勾能勾的）；表格上方一条操作条「N selected · P pax」+
  Send tour confirmation（Bus）/ Send reminder（Tickets）+ Send message + Clear。换日期 / 标签 / 胶囊、发完都清空。
  门票没填 Cfm # 的行勾不上（框是灰的，悬停写「Add the Cfm # to send a reminder」）；发过提醒的行变灰（后端已排到最后）。
- **辅助列**：勾选 / 发送要用 Pax、Cfm #、Tour confirmation sent / Ticket reminder sent，staff 自己的列选择里没有的也会**在请求里补上**，
  但表格和导出只显示 staff 选的列，「存着但用不了」的提示也只算 staff 自己存的列。没存过列的用后端默认列（默认列本来就含这几项，已核对后端）。
- **Send message**（`POST /api/manifests/broadcast`）：写几位（按不同订单号数，一单一条）→ 消息（默认一句开头，可改）+ SMS / Email → Review → Yes, send now；
  只传 row_key，联系方式后端自己取；空消息 / 都没勾 / 超 2000 字 / 勾了 SMS 超 1600 字在前端拦。结果写每条线（Bus / Tickets）SMS / Email 成败数。
  400 = 整批没发，写原因；断线 / 5xx = 叫 staff 别再发、先看 Broadcasting Log。一次请求（一次发送记一条 Broadcasting Log，同 Tracking 页群发）。
- **Send tour confirmation**（`POST /api/manifests/send-tour`）：每节一个 tour type 下拉（发送页那 9 个团型，`/api/notifications/tour-confirmation/tour-types`），
  **不预选**，留在 Don't send 的节不发；写这一节已发过几位、哪几单几点发过；不带 MTLV（弹窗写明）。
- **Send reminder**（`POST /api/manifests/send-tickets`）：几位、tour type = 胶囊名、用页面上的 Cfm #；已发过的写出来。
- 两个发送都**按每批 10 位依次发**（同发送页，防 Cloudflare 约 100 秒超时后重复发），某一批出错就停：400 写原因、那一批确定没发；
  断线 / 5xx 写「Stop. Do not send again」+ 哪几单可能已发、哪几单没发。服务端跳过的「已发过」列在结果里，勾上点 **Send anyway**
  再发（带 `send_anyway` 订单号 + 第一批的 `checked_at` 当 `preview_at`，所以不会把这次刚发的再发一遍）。发送中关页面先问。
- How to use 加了勾选、团确认、门票、自定义消息、出错怎么办五条。
- 与 Annie 定的不同：无。⚠️ 待 Annie 看一眼：Broadcasting Log 里这类发送的 Group 是 `manifest`，旧页面显示成 General，ops 现在原样显示 `manifest`（灰标签），要不要改成 General 或一个新标签。
- 检查：tsc / eslint / build 通过；headless `man` 套从 68 项加到 **96 / 96**（分节标题 / 底色、Select all / 节全选 / Clear、团确认不预选 /
  已发过提示 / 没选 tour type 拦截 / 只发选了的节 / 结果 / 发完重拉清勾选、Send anyway 带 send_anyway + preview_at、400 / 502 的停止提示、
  自定义消息的渠道拦截 / Review / 请求体只有 row_key / 结果、门票没 Cfm # 勾不上 / 发提醒 / 发过变灰、How to use、
  辅助列补进请求但不显示）。2026-10-11 晚补：超过 10 位的分批（13 位 = 10 + 3 依次发；第二批 502 时停下、第一批照算已发、
  第二批的单列为可能已发、叫 staff 别再发），`man` 套 **99 / 99**。**没有连真实后端发过**。

**验收步骤**（⚠️ 发送都是真发；只勾 Annie 自己的单，或 `CHDTESTORDER` 测试单——后端说它只发 azhou@）：

1. 打开 `/manifests`，Bus Tour 选 Antelope：Products 里填过 section 的话按节显示，节标题的框能全选一节，左上角 Select all 全选。
2. 只勾自己那单 → Send tour confirmation → 给那一节选 tour type（其他节留 Don't send）→ Send → 收到确认；Tour Confirmation 发送页那边也显示已发。
3. 再勾同一单发一次：结果里列为已发过，勾上 Send anyway 再发一次才会再收到。
4. Tickets 标签：没填 Cfm # 的勾不上；填了的勾上 Send reminder → 收到提醒，这一行变灰、排到最后。
5. 勾自己那单 → Send message → 写一句、只勾 SMS → Review → Yes, send now → 收到；Broadcasting Log 里多一条。

### Settings → Products：Groups 管理（后端 2026-10-11 深夜 `85a5d95`，跟后端 d8 窗口的通知）

- Annie 转给后端的 4 件 Forecast / Products 事之一。后端已上线：`POST /api/settings/products/groups {name, display_name, booking_type, sort_order?, is_active}`、
  `PATCH …/groups/{id} {display_name? | sort_order? | is_active?}`（admin）；Short name 和 Category 建了不能改；显示名不分大小写不能重复；没有删除；
  停用只让它不出现在「给产品选组」的下拉里，组里的产品和客人照常显示。
- ops 照旧 `settings_products.html` 的 `#groups-card` 做（`components/products/groups-card.tsx`）：在 Manifest setup 上面、默认收起；
  每组一行 Order / Short name / Display name / Category / Products（数产品）/ Status；Order、Display name 离开框就存，失败写服务端原话并改回；
  Deactivate 先确认（旧页面用 confirm()，ops 用共用确认框，文字同旧页面），Reactivate 直接存；最后一行新建，成功提示照旧页面原话
  「Added "…". Reload the page to see it in Manifest setup.」。每次改成功重拉组、产品、「Not in this list yet」。How to use 加了旧页面那条。
- 所有 Group 下拉同旧页面 `groupOptions` 的新规则（`selectableGroups`）：停用的组不列，**产品当前所在的组照常列出（标 inactive）**；批量条、「Not in this list yet」只列启用的组。
- 检查：tsc / eslint 通过；headless `products` 套 57 → **70 / 70**（新增：默认收起且在 Manifest setup 上面、每组一行、下拉不列停用的组、改名撞名写原话并改回、
  改名 PATCH 只带 display_name 且下拉跟着变、改顺序 PATCH 数字且重排、停用先确认、停用后组里的产品仍列出（inactive）、Reactivate、新建不合规矩写原话、新建 POST 字段、How to use）。
  **没有连真实后端试过**（会真的建组；要试用 `ZZ Test` 开头的名字）。
- 后端同一晚的其他几件（d8 通知）：`33da023` Forecast 的 CCL 车 / 关团按 CCL 分节名进 Sunset 块（接口不变，ops 不用改）；Sunset 单独成块的数据 SQL 等 Annie（G48）；
  **⏳ 每组的节顺序**（分支 `task/section-order`，等 Annie 明天执行 `migrate_v85`）：Manifest setup 的 `groups[]` 加 `section_order`、`PUT …/groups/{id}/section-order {sections}`，
  ops 只需在 Manifest setup 加这一项（Forecast / Manifests 接口自己会排好），后端上 main 后会通知；Dispatch 里 Sunset 单独成块还没做（G48）。

### 全深色主题（单独做，先藏着；Annie 2026-10-11 晚）

- 决定（已写进 CLAUDE.md「已定的决策」）：主样子保持「深色外框 + 白卡片」；全深色单独做、能做多少做多少，以后一批开放，默认仍是现在的样子。
  公司旁支那 6 页的深色改版不合进来（对比页 `claude.ai/artifact/BXEXaWV4fvRw8bsvGnnXAD`），旁支的 Manifests 当配色参考。
- 写法：`lib/theme.ts` + `app/globals.css` 的 `@custom-variant night`（`<html data-theme="night">` 时生效）+ `app/layout.tsx` 在 `<head>` 里先设好 data-theme（不闪白）。
  不用 `dark:`（error / not-found 页用它跟系统深色模式走）。**还没给 staff 开关**：网址加 `?theme=night` 打开、`?theme=day` 关掉，记在这个浏览器。
  以后开放时：用户菜单加开关（在 dashboard 窗口锁的 `components/nav/**`）、改成跟账号走（user-prefs）。
- 已做：共用的 `HowToUse`（浅色那种）、`Panel` / `ErrorBanner`（不带 dark 的）、`PRIMARY_` / `SECONDARY_BUTTON_CLASS`；`/manifests` 整页
  （日期框、胶囊——选中用白框不用蓝底、提示条、表格卡片、表头、行、Cfm # 输入框、Legacy 标、搜索结果本来就是深色）。
- 弹窗：`components/ui/modal.tsx` 加了 `night` 开关——**里面的字和输入框都配好 night: 样式的弹窗才传**（不然深底深字）。
  Manifests 的选列、三个发送弹窗、上传 Cfm # 已配好并打开；共用筛选条（`components/ui/filter-bar.tsx`：筛选框、输入框、下拉、搜索、分段按钮、计数）也加了 night:。
  截图核对过选列和发送弹窗（模拟数据）；`man` 套 110 / 110（正常样子不受影响）。
- ✅ 2026-10-11 深夜：**Teams、Users、Vehicles、Pickup Locations** 四页 + 它们的弹窗 + 共用 `ConfirmDialog` 做完全深色。
  做法：scratchpad 里的转换脚本（没进仓库）按「浅色类 → 对应 night: 类」只加不删（白底 → 半透明、深灰字 → 浅字、提示色浅底 → 半透明底），
  再手调 Users 的角色颜色。截图逐页看过（模拟数据），都清楚可读；**没调**：Pickup Locations / Vehicles 的近黑色「Add」按钮在全深色下对比偏低。
  检查：tsc / eslint 通过；`users` 34/34、`veh` 33/33、`pl` 41/41（正常样子不受影响）。`teams` 套这台机器上不稳定：三次分别挂在 auth / promo / edit / down，
  **改动前的代码同样挂 auth**（`git stash` 后跑过），是环境 / 超时问题，不是这次改动。
- ✅ 同一晚接着做了 **Products**（含 Manifest setup、缺失产品卡、产品日志）和 **HR**（含人员弹窗、导入面板）：同一个转换脚本（又补了一批颜色），
  截图看过；`products` 57/57、`hr` 44/44。
- ✅ 接着做了 **Content Studio、Orders（列表 + 详情）、Order Log、Send Log（含 Send batches）、Broadcasting Log、Ops Summary、Sales Report、
  Task Board、Bug Reports、Promotion Stats**，并把转换脚本补全的颜色回补到前面已做的页面。手调过的：Content Studio 右边预览栏、Broadcasting Log 的模块标签、
  Promotion Stats 紫色 Modified 标、Manifests 分节标题行（彩色底上保留深字，不转浅字）、Task Board / Bug Reports 的新建弹窗开 night。
  ⚠️ 中途踩坑：prettier 换行后再跑转换脚本会对同一个类重复加不同的 night 值（盖掉手调的）——已改成「同一个 class 字符串里有同类 night: 就不加」，
  并回退重做；`components/ui/filter-bar.tsx` 是手调的，**不要再对它跑转换脚本**。
  截图看过 Orders / Content Studio / Broadcasting Log / Manifests / Ops Summary / Task Board。检查：tsc / eslint 通过；cs 32、orders 23、olog 19、blog 24、ops 12、
  sales 13、tb 28、bugs 40（已知偶发，重跑过）、catchup 27、man 110、products 57、hr 44、users 34、veh 33、pl 41 全过。
- 没做：三个发送页、三个 Tracking（各有自己的浅色 / 深色版式，要单独看）、Forecast、Dashboard（dashboard 窗口在改）、Dispatch 一组（dashboard 窗口手上）。
- 截图小工具（全深色要点开弹窗看时用）：本次是 scratchpad 里临时写的，没进仓库；`checks/headless/shoot.js` 网址加 `?theme=night` 就能截整页。

### 后端 10/08 起没跟的几项，按 Annie 2026-10-11 晚「从第一个 ❌ 按顺序做」

核对表（后端 main `3af7004` 之前全部提交逐条对过）的 ❌ 项和进度：
1. Dispatch Seat guests（`c5b8633`）——dashboard 改版窗口在 `task/dashboard-redesign` 上做（放 Step 2 每台车下面、默认收起）。
2. ✅ Products → Manifest setup「Guests per bus」（`c5b8633`，v81）——见下。
3. Dispatch Step 1「Check the bus」（`cb3887d`）——**由 dashboard 改版窗口做**（和 Seat guests 一起；Seat guests 按钮跳 Step 2 那个团的车，不是旧页面的 Step 3）。
4. 右下角 ↑↓ 改蓝色粗箭头（`cb3887d` 的 base.html）——Annie 2026-10-11 定照旧版改蓝（「反正也是功能键」，CLAUDE.md 蓝色规则加了这个例外）；
   文件在 dashboard 窗口锁的 `components/nav/**`，**已转给它在 `task/dashboard-redesign` 上改**，合回链尾时带过来。
5. ✅ 60 天 Forecast（`209056f` `ae4ac42` `a48311e` `294e070`）——从公司那台旁支搬进链尾，见下。
6. ✅ Manifest setup「Own block on the 60 Days Forecast」（`a48311e`，v82）——和第 2 条同一个面板一起做了。
7. ✅ Content Studio 门票 Arizona 时区说明可编辑（`e584ceb`）：Tickets 的 Global 字段里、Warning box 后面加两个字段
   `tmpl__global__tix_az_note`、`tmpl__global__tix_az_clock_label`（标签照旧页面）。ops 的预览本来就是按字段显示，不用另改；
   旧页面的邮件 / 客人页整版预览 ops 一直没有，这次也没加。
8. ✅ 早班 / Tour 发送页 How to use（`f83d270` `95e5606`）：两页都加「Pickup Time: CSV 自动减 15 分钟、.xlsx 照原样」；
   早班页「同一单两行」改成「内容相同只发第一行」，并加「内容不同两行都不发、Reservations 会收到邮件、去 Rezdy 手动发」一条（旧页面原话）。
   早班结果表本来就显示服务端的跳过原因（`message`），这种跳过会写「Listed twice in this file with different details — not sent …」，不用改。

**Manifest setup 两个新框**（`components/products/manifest-setup-panel.tsx`，照旧 `_manifest_setup_panel.html`）：
- Guests per bus：第一排午餐行后面，数字框，离开框保存；和颜色 / 午餐行同一个 PUT（排队发），只在这个框离开时才带 `guests_per_bus`（原文，后端校验 1–99）；
  不合规矩写后端原因、框里的值不动（同旧页面）。
- Own block on the 60 Days Forecast：计数框和 Sections 之间，逗号分开，离开框整组 `PUT …/groups/{id}/forecast-split-sections`；内容没变（只差空格）不发；失败写原因。
- How to use 加了两条（旧页面原话）。headless `products` 套 **57 / 57**（新增 9 项）。

**60 天 Forecast 搬进链尾**：公司那台旁支（`task/pickup-locations-dark`，含 `task/forecast-60day-page` 的修复）的 `components/forecast/**`、`lib/forecast-api.ts`、`types/forecast.ts`、
`components/ui/dark-page.tsx`、`checks/headless/fc-*` 原样搬来；`components/ui/buttons.ts`（加两个深色按钮常量）、`components/ui/panel.tsx`（Panel / ErrorBanner 加可选 `dark`）也用旁支的版本（都是新增，现有调用不变）。
页面外层去掉旁支自带的深色底和四周留白（整站外框已有，同链尾 `06e636a` 对 30 天页的做法）。侧栏名字「30 → 60 Days Forecast」请 dashboard 改版窗口在新侧栏里改（它锁着 `components/nav/**`）。
旁支那两处「西峡 / Sunset 后端口径」**Annie 2026-10-11 已定：两块独立**（关团、CCL 的车都要分开），已写进「需要后端」第一条。headless `fc` 套 **49 / 49**；tsc / eslint / build 通过。
- ⚠️ **旁支其余的提交没搬**：它把 Manifests / Teams / Vehicles / Dispatch / Users / Pickup Locations 各自又改了一遍深色，和链尾 10/08 晚的全站深色化重复，模拟合并 26 个文件冲突。
  等 Annie 定每页用哪一版（或交给本窗口按「哪版更像旧页面」挑）。`task/pickup-locations-dark`、`task/forecast-60day-page`、`task/vehicles-dark`、`task/forecast-30day-page` 以后都不再往上提交，**链尾只有 `task/manifests-v2`**。

### `/manifests`：搜索（2026-10-11 晚，Annie：「页面没有搜索，我怎么找」）

- 分支：`task/manifests-v2`（链尾）。旧页面没有，ops 新加，深色风格、不用蓝色（蓝色只给提交键）。
- 日期那一排加搜索框：按**单号、客人名、电话（只比数字，3 位以上）、邮箱**搜**这一天两个标签、全部胶囊**（不只当前这一屏）；
  少于 2 个字不搜；最多列 20 条，单号开头对上的排前面。每条写「单号 · 姓名 · 几 pax」和「标签 › 胶囊」。
  点一条（或 ↑↓ + 回车）跳到那一单所在的标签 / 胶囊，那一行标黄并滚到屏幕中间；手动换日期 / 标签 / 胶囊就不再标黄。
- 接口不变：第一次打字时才按胶囊逐个拉（`fields=guest_name,phone,email,pax`，同 Cfm # 上传的拉法，共用 `fetchAllPagesForDate`），
  这一天之内再搜不重拉；换日期 / 页面重拉（发送、上传 Cfm # 之后）下次打字再拉。只搜当天，搜不到写「No order on this day matches. Check the date.」。
- How to use 加了一条。
- 检查：tsc / eslint / build 通过；headless `man` 套 **110 / 110**（新增：只在打字时拉索引、每颗胶囊一次只要四列、按单号跨标签找到并跳转标黄、
  按姓名跨胶囊、按电话只比数字、回车选第一条、搜不到、少于 2 字不出结果、手动换标签取消标黄、How to use）。**没有连真实后端看过**。

**验收步骤**（只读）：打开 `/manifests`，在搜索框打一个今天的单号（或客人名、电话）→ 下面列出结果，写在哪个标签 › 胶囊 → 点它，跳过去、那一行黄色。

### 后端 10-10 跟进：Modified 状态 + Tracking 页「已处理」按 notes_unhandled（2026-10-11 晚）

- 分支：`task/manifests-v2`（链尾）。后端 `7c03bd3` dashboard-modify-tracking-consistency（已在 main），旧 Tour / Morning tracking 页同一个提交改的，照搬。
- **Take action 判据**：两个 tracking 接口每行多了 `notes_unhandled`（判据同 dashboard 未处理窗口：最新一条客人留言 / 改期请求在最后一次 Take action 之后）。
  Notes / WhatsApp 栏的按钮改成 `action_taken_by && !unhandled` 才显示「✓ 谁」，否则 ⚠️ Take action；Notes 表头红数字改成
  `notes_unhandled || wa_unhandled` 的单数（原来是没有 `action_taken_by` 的单数）。共用组件 `components/ui/conversation-preview.tsx`，
  **门票页不变**（后端还没给 `notes_unhandled`，后端待办 G45；没有这个字段时照旧只看 `action_taken_by`）。
  旧页面点完按钮本地先翻转；ops 原来就是点完立即重拉，不另做。
- **Tour 页 Modified 状态**（staff 已和客人敲定改期的终态，不改人数 / 午餐数，那些只看 Rezdy）：状态下拉、筛选下拉、统计卡（Modify 和 Pending 之间，紫字 `#4c3da8`）、
  How to use 两条都照旧页面原话加上（Cancel 清午餐 / MTLV 那半句是 ops 原有的，保留）。Morning How to use 同步那一句。
- **Tour 页 Notes 预览**：状态是 Modify / Modified 时，改期请求原文（`notes`）排在最前面，和最新一条不同时写成「改期内容 — 最新一条」（同旧页面 `notesBody`）。
  ⚠️ 旧页面这次的写法在**非改期状态、又没有消息**时不再显示确认页留言（它取的 `r.guest_notes` 在 tour 接口里没有），预览变空白——
  看起来是旧页面的疏漏；ops 照原来的做法继续显示留言（待 Annie 确认，见「需要后端」）。
- **Promotion Stats**：确认状态 `modified` 显示紫色 Modified 徽章（同旧页面 `badge-modified`），不再落进 Pending。Ops Summary 后端已把 modified 并进 Modify，前端不用改。
- 检查：tsc / build 通过；headless `tt` **69 / 69**（新增 Modified 卡 / 下拉、点过又来留言回到 Take action 且表头算进去、预览先写改期内容、
  改成 Modified 的请求和统计、按 Modified 筛选）、`mt` **125 / 125**（新增点过又来留言回到 Take action、表头 4）、共用组件的 `tk` **72 / 72**。
  Promotion Stats 没有 headless 套，只过了类型检查。**没有连真实后端看过**。

**验收步骤**（只读；第 3 步改状态只改 `ZZ Test` 单）：

1. `/tour-confirmation/tracking` 和旧后台同一天并排看：统计卡多了 Modified，状态下拉 / 筛选下拉都有 Modified。
2. 找一单「点过 Take action、之后客人又发了消息」的：两边都显示 ⚠️ Take action，Notes 表头红数字一致。Morning tracking 同样看一遍。
3. 把一张 `ZZ Test` 单改成 Modified：Modify 数减 1、Modified 加 1；dashboard 上它的 Date change 标记消失。
4. `/promotion-stats` 明细里状态是 modified 的显示紫色 Modified。

### 后端 10-09 跟进：Tour Tracking 群发「By pickup location」（2026-10-11）

- 分支：`task/manifests-v2`（链尾）。后端 `a5b3bfd`（Annie 提的需求，已上线）。
- 接口：`GET /api/notifications/tour-confirmation/tracking` 每行多了 `pickup_location_id`、`pickup_hotel_name`（后端用
  `pickup_lookup.match_with_reason()` 算好，前端不另写匹配）；发送还是 `POST /booking-notes/broadcast/send`，只是 `group_filter='pickup'`。
- 做法：共用群发弹窗 `components/ui/broadcast-dialog.tsx` 加 `byPickup`（只有 Tour 页开；门票页不变）。Step 1 改名 Select recipients，
  多 By tour / By pickup location 两个单选，每次打开回到 By tour。By pickup location：对上 Settings 的按站点名分组（排序，写人数 · 哪几个团，
  同一家的其他写法写「Also written as」）；对不上的按原始文本分组列在「Not found in Settings → Pickup Locations」下，没填的归
  「(no pickup location on file)」；收件人名单每人多写「团 · 接客时刻」；存进群发记录的产品名是勾选的站点名；General / MTLV 照旧生效（同旧页面）。
  How to use 换成旧页面那一条（原来 ops 自己写的「📣 Broadcast sends … Untick anyone」那句去掉，旧页面没有）。
- Broadcasting Log：`group_filter='pickup'` 显示绿色 Pickup 标签（旧 `.tag-pickup`）；Group 筛选下拉旧页面没加，ops 也不加。
- 检查：tsc / eslint 通过；headless `tt` 套 **63 / 63**（新增 By tour 默认、分组 / 排序 / 合并写法、Not found 区、没选站点拦截、
  名单写团和时刻、请求 group_filter / 产品名 / 收件人、再打开回到 By tour）、`blog` 套 **24 / 24**（新增 Pickup 标签）、
  共用弹窗的门票页 `tk` 套 **72 / 72** 回归通过。

**验收步骤**（⚠️ 第 3 步会真实群发；只勾 Annie 自己）：

1. 打开 `/tour-confirmation/tracking`，选一个有团的日子，点 📣 Broadcast，和旧后台同一天的弹窗并排看。
2. 切 By pickup location：站点分组、人数、Also written as、Not found 区和旧页面一致。
3. 只勾 Annie 自己所在的站点、名单里取消勾选其他人，发出去；Broadcasting Log 里这一条显示绿色 Pickup。

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

- 2026-10-12（Annie：勾了表格下面的产品看不到批量工具条，「不方便」）：All Products 和「还没加进列表」两张卡片的批量工具条改成
  **跟着页面滚动、停在顶栏下面**（`sticky top-16`；卡片 `overflow-hidden` 换成 `overflow-clip`，否则 sticky 被困在卡片里）。旧页面工具条不跟着滚，这是 Annie 要的不同。
  分支 `task/products-bulk-sticky`（从 main 拉出）；headless `products` 76/76（新增「窗口调矮、滚到底，工具条还在顶栏下面」）。
- 分支：`task/products-page`（从 `task/pickup-locations-page` 拉出）。
- 状态：代码已完成，lint / typecheck / build 通过；模拟接口 + headless Chrome 检查 **40 / 40 通过**；**没有连真实后端改过数据**；等 Annie 验收。
- 只有 admin 能用。页面是两块：商品表（含「还没加进列表」的卡片和 Action Log），以及 **Manifest setup** 面板
  （2026-10-03 后端新加的，迁移文档里没写，接口 `/api/settings/manifest-setup*`）。
- 接口：`GET /api/settings/products`、`/groups`（分类清单由后端下发，前端不写死）、`/missing`、`/log`；
  新增 `POST`；单个改 `PUT /{id}`（**整体覆盖**，内部名 / 组 / 分类三项每次都传）；批量 `PATCH /bulk`（只带要改的键）；
  停用 `PATCH /{id}/active`；Manifest setup：`GET`、`PUT /groups/{id}`（颜色 + 午餐行）、`PUT /groups/{id}/extras`（整组替换；原 `…/counters` 已被后端 `ad8b7ab` 拿掉）、
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

> ⏸️ **挂起（Annie 2026-10-11）**：主业务上线以后再做。在那之前不修、不验收这一页；headless `bugs` 套偶发的 2 项失败
>（「展开才拉评论和任务详情」「描述、最新一条、历史」）也先不管，全量回归时不算阻塞。

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
  所以**不用改代码**，现在写「saved to your account.」。旧后台 HR 页接这个键的改动（待办 G20）后端 2026-10-08 已合进 main
  （`bf6c553`），旧页面现在也是这个默认顺序、读写同一个偏好，ops 不用改。
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
- ⚠️ **2026-10-08 起被「照旧版一模一样」取代**：Send Log、Order Log 的日期改回旧版的「📅 Today ▾」下拉，各页筛选条照各自旧模板的尺寸
  （见「全站照旧版改样子」小节）。下面这段是当时的记录。
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

### Manifests：Cfm # 批量上传（2026-10-08，Max 定的做法）

- Max 2026-10-08 要求：Cfm # 做成表格上传，像 HR 的 Import from Excel 那样——先核对能不能匹配上，符合的才写，
  不符合的标红，缺失的标 `-`。**没有后端接口**，匹配和写入全在前端做，复用已有的单条 `PUT /api/manifests/cfm`
  （逐条调用，不是批量接口）；核对细节是跟 Max 确认过的：
  1. 匹配键是订单号（文件里的 `CHD #` 这一列），只要在**当天**系统里找得到就算匹配上。
  2. 顺带核对人数（`No. of Pax` 列）：匹配到了但人数和系统不一致 → 标红，不自动写，防文件用错了日期 / 行错位。
  3. 同一订单号在系统当天的 Manifest 里不止一行（例如一单两个产品归进同一个 tour type）→ 标红，人工处理，
     不猜该写哪一行。文件里同一订单号出现不止一次也是同一处理（`duplicate_in_file`）。
  4. 面板放在 `/manifests` 页 ☰ Columns 按钮旁边（**⬆ Upload confirmation #s**），匹配范围是当前选中的日期，
     不限定正在看的标签 / 胶囊——一张供应商的确认单可能横跨好几个胶囊，甚至跨 Bus / Tickets 两个标签。
- 实现：
  - `lib/spreadsheet.ts`：浏览器端读 `.csv` / `.xlsx` 的小工具，用 `xlsx`（SheetJS）。
    ⚠️ **`xlsx` 在 npm 上发布的版本停在有已知高危漏洞（原型污染、ReDoS）的老版本不再更新**——SheetJS 把修复后的版本
    改成只从自己的 CDN 发（`package.json` 里的安装地址是 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`，
    不是 `npm install xlsx`），升级这个包时去 https://cdn.sheetjs.com/ 找最新的 tarball 地址，别手滑改回 npm 源。
    它体积不小，`readSpreadsheet()` 内部动态 `import("xlsx")`，不点上传按钮的人打开 Manifests 页不用多下这一块
    （测过：`/manifests` 首屏 JS 没因为这个变大，xlsx 单独一个 chunk）。
  - `lib/manifests-cfm-import.ts`：表头按别名找列（不认位置，`CHD #` / `Order #` / `Confirmation#` / `No. of Pax` 等
    几种写法都认），解析成行、按订单号在系统索引里查、决定状态（`match` / `pax_mismatch` / `ambiguous` /
    `duplicate_in_file` / `missing` / 行里订单号或确认号本身是空的两种）、逐条调用 `saveManifestCfm` 写入
    （只写 `match` 的；出错继续下一条，不是「出错就停」——这些订单互相独立；401 整批停，跳登录页）。
  - `lib/manifests-api.ts` 新增 `fetchAllManifestRowsForDate`：这一天两个标签、全部胶囊各拉一次（`fields: ["pax"]`
    保持请求小，全部并发），给匹配用。接口一次只回一个胶囊，所以这里比页面平时的用法多打不少请求（一天通常十来个
    胶囊），但都是只要 `pax` 的小请求。
  - `components/manifests/cfm-upload-panel.tsx`：预览表（状态 / Service Date / Order # / Pax（不符时带系统人数）/
    Lead Name / Confirmation # / Note），顶部统计几条会写、几条问题、几条没找到；Insert 按钮只统计会写的那几条；
    写完的结果（成功数、失败的订单号和原因）。写成功至少一条就让父页面重拉当前这屏（新存的 Cfm # 如果正好在看的
    胶囊里会立刻显示）。
- **没做**：ambiguous（同一订单号系统里不止一行）这条分支逻辑简单（`candidates.length > 1`），review 过代码确认对，
  但没有专门的 headless 用例——现有 mock 数据改一行会牵连很多既有断言，风险比收益大，没有强行凑一条进去；
  真机测试（2026-10-08，见下面「`/manifests` 真接口核对」那次）也没有刚好撞上这种单子。Annie 验收时如果找到一单
  两个产品都在同一胶囊的情况，可以留意一下这条分支的实际表现。
- 状态：lint / typecheck / build 通过；headless `man` 套在原来 60 项基础上加了 8 项（上传面板标题、解析统计、
  预览表状态、按钮文案、写入请求体、父页重拉、缺列报错），**68/68 通过**；真连了线上 confirm 用浏览器实测过一遍
  （见上面「`/manifests` 真接口核对」小节更新，用了一份真实的 Ken's Tours 确认单截图当参照设计列名匹配规则，
  Pax 不符、找不到、文件内重复都在真实数据上触发对了；**没有点 Insert 写真实订单**，找不到安全的 `ZZ Test` 单）。

**验收步骤**（⚠️ 点 Insert 会写真订单的 Cfm #；建议先用 Annie 自己知道可以改的单试，或者用 `ZZ Test` 单）：

1. 打开 `/manifests`，点 **⬆ Upload confirmation #s**：弹窗标题带当前选中的日期。
2. 准备一份表格：至少两列，一列是订单号（列名例如 `CHD #` / `Order #`），一列是确认号（例如 `Confirmation#`）；
   想测人数核对就再加一列 `No. of Pax`。挑几单故意试：订单号打错 / 不存在的单、人数故意写错、同一单写两行。
3. 上传后看预览表：真实存在且人数对的单是绿色「will insert」；人数不对的是红色，并写着文件 / 系统两边的人数；
   打错的订单号是灰色 `—`；同一单两行都是红色「duplicate in file」。顶部统计数字和这些一致。
4. 点 **Insert N confirmation numbers**（N 只数会写的那几条）：等写完，看结果摘要（成功几条、失败的订单号和原因）。
5. 关掉弹窗：如果写成功的那一单正好在当前这屏，Cfm # 列应该已经显示新存的号（不用手动刷新）。换到别的胶囊 /
   标签确认写对了产品那一行（不是随便挑了同订单号的另一行）。
6. 上传一份表头缺订单号或确认号列的文件：弹窗报错说明缺什么，不出预览表、不能误点 Insert。

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

### 全站照旧版改样子（2026-10-08 晚，Annie 2026-10-07「和旧版一模一样」）

- 分支：`task/manifests-v2`（链尾）。**全部已迁页面**都改了，只改样子、版式、静态文字，**没改功能 / 接口 / 发送逻辑**。
- ⚠️ 先前的判断「旧后台全是深色」不准：旧后台大部分页面是**深色底 + 白卡片（卡片里深色字）**；整页深色的只有 dashboard、
  Dispatch、Morning Tracking、Tour manifest 页头；Tickets Tracking 是星空页头 + 浅灰底，Tour Tracking 是绿色页头 + 沙色底。都照各自旧模板做。
- **外框**（`components/nav/app-frame.tsx`，照 `base.html`）：244px 深色侧栏（NPE / Operations Center、分组图标和收起、当前页蓝色渐变、
  Notifications 三个彩色圆点、底部用户卡 + Sign out）；64px 顶栏写页面名（照各模板 `page_title`，`components/nav/page-titles.ts`），
  右边是旧版那个**不能输入的搜索框样子**（旧版就是摆设，照搬）和用户名，三个发送页同旧版不显示搜索框；内容区四周 28px；右下角 ↑ ↓。
  三个 tracking 页旧模板不继承 `base.html` ⇒ **ops 也不套外框（没有侧栏和顶栏）**，用页头的 ← Back 回 dashboard。
  窄屏（< 1024px）仍是 ☰ 打开侧栏（旧版是只剩图标的窄栏）。
- **各页**：去掉浅灰底和页内大标题（页面名在顶栏，同旧版）；旧模板内容区自己有标题的（Teams、Users、HR、Products、Pickup Locations、
  Vehicles、Dispatch Imports、Bug Reports、Task Board、发送页、tracking 页）照旧版做；卡片、表格、按钮、徽章、弹窗、How to use 照各模板的 CSS 数值。
  How to use 共用组件改成旧版尺寸（12px、行高 1.9、最宽 760px），Morning Tracking 用深色版。
- 只有 ops 有的按钮 / 提示（订单搜索、☰ Columns、Cfm # 上传、分批进度、确认框、Assign / Send 标签等）都保留，按旧版的样式放。
- 文字跟着旧版改回来的（同一个元素两边都有时）：例如 Send Log 的模块名带 emoji（🟢 Tour Conf）、表头「📧 Email / 📱 SMS」；
  Users 的按钮「✏️ Name」「📋 Copy Link」「🗑」；Tickets 发送页 Qty / Quantities 分两列；三个发送页的按钮和标题文字；Manifests 的 Cfm # 占位「Add #」。
- Send Log、Order Log 的日期从一排按钮改回旧版的「📅 Today ▾」下拉（Custom 的两个日期框和 Apply 在下拉里）。
- 状态：tsc / eslint 通过；各套检查改成新的写法（检查内容不变）；全量回归结果见下面「下一步」第 8 条。

**和旧版仍然不同的地方（需要 Annie 看一眼，大多是旧版颜色在深色底上看不见）**：

1. ✅ **Annie 2026-10-08 晚确认这样改是对的**。旧版直接写在深色底上的深色字（#1a1a1a / #555 / #666），看不见 ⇒ 改成浅色：Teams、Users、HR 的大标题，Manifests / Sales Report 选中的标签，
   订单详情的订单号，Promotion Stats 的 From / To，Dispatch Imports 的 Last pull 等。
2. 旧版自己就看不见的：Orders 空结果的「Search all dates」按钮（白卡片上的白字）、Send Log 批次明细的数字、Bug Reports 的 Workstream 徽章 ⇒ 改成能看见。
3. ✅ **已改回旧版（Annie 2026-10-08 晚：「不需要放餐之类的详情」）**：卡片只写「N buses assigned · N guests loaded」，
   右上角标签 No CSV yet / Buses need letters / N not on a bus / CSV loaded，午餐、订单数、上传人都去掉。原来的记录：
   **Dispatch Step 1 卡片文字**：旧版写「N buses assigned · N guests loaded」+「Buses need letters / N not on a bus / CSV loaded」，
   旧模板注释说 Annie 要求卡片上**不放**午餐数、订单数、上传人；ops 现在还显示「N buses · N orders, N pax」、午餐数、「Uploaded … by …」。
   **要不要改成旧版的写法？**（没改，等 Annie 定）
4. 旧版有、ops 没有的（要加功能，没做）：Manifests 的 ↻ Refresh 按钮；Dispatch 的「Add private note」链接（ops 一直显示备注框）；
   旧版列宽可以拖（三个 tracking 页）。
5. 确认弹窗（共用 `ConfirmDialog`，Users 的删除 / 改角色等）还是 ops 原来的白底样式，没照各页旧弹窗改。
6. 旧版有、ops 照着补上的：Teams、Users 页顶部的蓝色 How to use（ops 原来没有），Users 弹窗右上角的 ✕。
7. 筛选条：10-05「全站紧凑筛选条」（26px）被这次取代，各页回到旧模板的尺寸；Annie 如果还觉得按钮大，再说。

**验收步骤**（只读）：

1. 链尾分支本地开起来（「验收环境：一条命令」），左边侧栏、顶栏和旧后台并排看：一样。
2. 逐页和旧后台同一页并排看：底色、卡片、表格、按钮、字的大小和颜色一样；不一样的应该只在上面列的几条里。
3. 三个 tracking 页：没有侧栏，页头和旧版一样，← Back 回 dashboard。

### 30 Days Forecast 合进链尾（2026-10-08 晚）

- Annie 定：新功能在 ops 做完，不往后放（后端窗口转达）。另一个窗口在旁支 `task/forecast-30day-page`（worktree `C:\Code\npe-ops-frontend-forecast`）
  做好的 `/forecast` 已合进链尾 `task/manifests-v2`（`fee938e`）。**旁支和那个 worktree 以后不用了**，验收看链尾。
- 页面本来就是 dashboard 那种深色；合进来后去掉它自带的底色和四周留白（新外框已经给了），页内标题保留、顶栏不重复写页面名（同 dashboard）。
- 侧栏 30 Days Forecast 不再是 Coming soon，点进 `/forecast`。接口和业务口径见「待做」第 1b 条。
- 状态：tsc / eslint 通过；headless `fc` 16/16、`nav` 18/18；模拟接口截图看过。

**验收步骤**（只读）：

1. 侧栏 Operations → 30 Days Forecast：打开 `/forecast`。
2. 三张统计卡（Total pax / Daily average / Busiest day）数字合理；图表悬停能看到每天的人数，今天那根是亮蓝。
3. 下面表格第一行是今天（带 Today）；⬇ Export 下载 CSV，内容和表格一致；↻ Refresh 重新拉数字。

### 后端 10-08 跟进：Morning Tracking 的 Driver 链接 + Guest Viewed 列

- 分支：`task/manifests-v2`（链尾）。后端 main `1e133ca` + `4778879`（morning-driver-track-viewed）。
- 接口新字段：`driver_live_van`（司机**现在**实际开的车号，Samsara；对不上时 ""）、`guest_viewed_at`（客人打开当前这台车追踪链接的时间，
  没开 Samsara 时恒为 null）、`guest_link_stale`（客人看的是旧车的链接）。
- 照旧页面：**Driver** 名有 `driver_live_van` 时做成新标签页链接，打开旧后台 `/tracking/vehicle-live?van=<车号>`
  （后端不给绝对地址，前端用 `NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL` 拼，同 Vehicles 的 Open map）；Driver 后面新加 **Guest Viewed** 列
  （洛杉矶时间「10/8, 7:42 AM」，没点过写 —；`guest_link_stale` 时下面红字「Wrong bus — resend link」，只是提示，不能点）；
  How to use 加了两条说明和一条 ⚠️（和旧页面原文一样）。拖过列的人，存档里没有这一列，会出现在最右边（同旧页面）。
- HR 列表 G20 后端也合进了 main：ops 本来就是新的默认顺序、同一个偏好键，**不用改**。
- 后端还没合进 main、ops 以后要跟的：G33（Dispatch Step 1 的「Completed」按钮 + `POST /api/dispatch/manifests/complete`，等 Annie 同意 v78）、
  pickup-offset（早班预览的「Listed twice」标记还在等 Annie）。合进 main 后再跟。
- 状态：lint / typecheck 通过；headless `mt` **103 / 103**（新增 5 项：Driver 链接和车号编码、没车号是文字、Guest Viewed 时间和红字、没点过写 —、How to use）。

**验收步骤**（只读）：

1. 打开 `/morning-pickup/tracking`，和旧后台 `/admin/notifications/morning-pickup/tracking` 并排看今天：Driver 后面有 Guest Viewed 列，
   内容一致；能点的司机名两边一样。
2. 点一个能点的司机名：新标签页打开那位司机现在开的车的地图（要登录旧后台）。

## 待做（按顺序）

- 🔜 **全深色（night 主题）继续做**（Annie 2026-10-15 晚：「登记待办，明天再做」）。规矩见 CLAUDE.md「主样子是深色外框 + 白卡片，全深色另做」：
  写法在 `lib/theme.ts`（`<html data-theme="night">` 时的 `night:` 变体，没开时页面不变；预览 `?theme=night`），做好的先藏着、默认仍是现在的样子；公司旁支 `task/pickup-locations-dark` 只当配色参考。
  ⚠️ **更正（2026-10-16，85 核对代码后发现这条「到 10-15 为止一页都没做」是错的，写的时候没核过代码）**：main 上其实已有 5 波实现
  （`b129cbf` → `07cde90` → `d1bd1bb` → `e7d7f44` → `1d07582`）：共用件（Panel / ErrorBanner / HowToUse / buttons / Modal 的 night 开关 / filter-bar / ConfirmDialog）；
  `/manifests` 整页 + 3 个发送弹窗 + 选列 + Cfm 上传弹窗；Teams / Users / Vehicles / Pickup Locations（+ 各自弹窗）；
  Products（含 Manifest setup / groups-card / missing-card / product-log）+ HR（含人员弹窗 / 导入面板 / hr-log）；
  Content Studio、Orders（列表 + 详情）、Order Log、Send Log（+ send-batches）、Broadcasting Log、Ops Summary、Sales Report、Task Board、Bug Reports、Promotion Stats。
  **真正还没做**：三个 Tracking 页（Morning / Tickets / Tour Tracking）+ 共用 `tracking-ui`；Forecast 页本身（`styles.ts` 只有一句注释提到颜色，没有实现）；
  Dispatch 一组；Dashboard；三个发送页（Tickets send 的 `legacy-ui.tsx` 在分支 `task/night-theme-send-pages` 做了、还没合 main；morning-send 在做；tour-send 还没碰）。
  做法不变：先挑一页出预览给 Annie（改样子要先预览），她同意了再写代码，之后逐页做。开工前看有没有别的窗口在做。

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
1b. ✅ **30 Days Forecast**：`/forecast`。旁支 `task/forecast-30day-page`（另一个窗口做的）**2026-10-08 晚已合进链尾 `task/manifests-v2`**，
   并照全站的旧版样式改过（见「进行中」的「30 Days Forecast 合进链尾」小节）。以后只看链尾。
   （下面是当时的接口备忘，已照做；业务口径见下一段）接口 `GET /api/forecast/30-day`，`require_staff`（所有 staff，不是 admin-only）。
   返回固定 30 条、从洛杉矶今天起每天一条 `{date, pax}`（今天永远是第 0 条；`date` 为 `YYYY-MM-DD`，没有订单的日期 `pax: 0`，不是不返回，
   可以直接按下标取）；`pax` 是当天全部 Rezdy 团的人头汇总，**这一版没有按产品/团型拆**。
   - 2026-10-08 Max 跟后端确认的业务口径（另一个窗口转达）：① 每天一个总数，不拆产品/团型——这版不做，别自己加；
     ② 所有 staff 能看，跟 dashboard 一样，不是 admin-only；③ 口径：~~排除已取消的，pending 也算在内~~ → **2026-10-08 晚 Annie 改成只算已确认的单**（pending 也排除，后端 `eb1c51f`，和 Manifests 一样；服务端过滤，ops 不用改代码）。原来是
     后端拆车道那次定的口径（`app/services/forecast.py` 的 `is_live` 只排除 cancelled/deleted）。Order List、Sales Report 不受影响，仍含 pending；
     ④ 已知缺口：约 1,534 笔还没从 Rezdy 补回来的老单（等 API key 配到 Railway），这些订单对应的天数字会偏低，
     和 Sales Report 现在的缺口同一个原因，**UI 上不用特别处理**（Annie 原话），页面没有另外提示。
   - 旧后台没有这一页（侧栏一直是 `soon: true` 占位，侧栏入口显示 Coming soon），不是迁移、是全新页面：按 CLAUDE.md 的决定
     （旧页面没有对应实现时用 dashboard 已经定下的深色风格），不用再等 Annie 确认配色。
   - 页面内容：三张统计卡（Total pax / Daily average / Busiest day）、30 根柱子的图表（今天高亮、峰值直接标数字、
     悬停 / 键盘聚焦显示每天的提示框）、下面的逐日表格（今天标 Today）、⬇ Export 导出 CSV、↻ Refresh 手动刷新。
   - headless 检查（模拟接口，`node run-all.js fc`）：**16 / 16 通过**。覆盖：标题、统计卡数字、30 行表格、
     今天标记只在第 0 行、0 人的天照实显示、峰值行和图表直接标注、图表 30 根柱子都能悬停/聚焦、Refresh 重新请求、
     Export 点击不报错、非 staff 显示 Staff access required（不跳转）、接口 500 时的错误提示和 Retry、
     401 跳旧后台登录页带 next、403 Password change required 跳改密码页。
   - 侧栏导航 `components/nav/nav-config.ts` 的「30 Days Forecast」从占位改成站内链接；`nav` 套的对应检查已跟着改
     （原来断言「占位、不可点」，现在断言「已是真链接」，另加一条断言 General 仍是占位）。
   - 验收步骤（只读）：切到 `task/forecast-30day-page`，打开 `/forecast`：三张统计卡数字合理；图表悬停能看到每天的人数；
     下面表格第一行是今天（带 Today 标）；点 ⬇ Export 下载 CSV，列和表格一致；点 ↻ Refresh 数字能刷新。
     侧栏「30 Days Forecast」不再是 Coming soon，点得进来。
   - 待后端 1,534 笔缺口补完后，数字会整体上移——不用为此再改前端。
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
   - ✅ **dashboard 的 Multi Orders 窗口已补上（2026-10-10）**，细节见「`/dashboard` Multi Orders 窗口」小节。
6. ⏳ **Manifests（`/admin/manifests` → ops）**：Annie 2026-10-05 定要迁，**等后端**（接口需求见「需要后端」）。
   - 旧页面不能照搬：读老 `bookings` 表（8/16 以后的 Rezdy 订单看不到），还有五处半成品（后端待办 A1 第 9 条：换日期不生效、
     发送按钮没接、导出 404、三个标签不筛选、Cfm # 存完没提示），没有 JSON 接口。
   - Annie 2026-10-05 定：
     - **数据走 Rezdy webhook**（`rezdy_bookings`，**只收已确认的单**：已取消和 pending 都排除——pending 是 Annie 2026-10-08 定、后端 `9d947c8` 起；Rezdy 后来取消的单下次打开页面自动消失，接口是实时查的，前端不用判断状态。Order List、Sales Report 不受影响，仍含 pending），不用手工上传。**只这一页**；发送页、排车的 Tour manifest、补录照旧上传，以后另立项。
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

## 切换（分批，Annie 2026-10-10 定）

> 取代 10-03 的「全部页面做完才一次性切换」。staff 只用 ops 一个网址、只登录一次；做法见「分批切换：一个网址、一次登录」小节。

- [ ] Max 测通「分批切换」小节的测试步骤（Annie 2026-10-11：交给 Max 测）。
- Annie 2026-10-11 晚定：**Dispatch 和 Manifests 一起切换**（同一批加进 `SWITCHED`）。Dispatch 的 Seat guests（G29 第二批，放在 Step 2 每台车下面、默认收起）
  由 dashboard 改版窗口在 `task/dashboard-redesign` 上做，它锁了 `components/dispatch/**`、`lib/dispatch-api.ts`、dispatch 的 types、`checks/headless/da-*`。
- [ ] 测通后经 Annie 同意，整条分支链合进 main（清单为空，上线后 staff 看到的仍全是旧页面）。
- [ ] 通知员工从此只用 `ops.nationalparkexpress.com`、只在 ops 登录（confirm 上的旧后台照旧能用，但那边要另外登录）。
- [ ] 之后每验收通过一页，就把它加进 `lib/page-switch.ts` 的 `SWITCHED`、推 main。
- ✅ **2026-10-12 Annie 定全部切换**（「目前 ops 就只有我一个人知道和登录，基本上没有什么风险」；staff 还在用 confirm，不受影响）：
  分支 `task/switch-all`（从 main 拉出）。`SWITCHED` = 对照表里**除 Bug Reports 外全部**（Bug Reports 挂起，没切，还去旧页面）。
  登录后进首页 = ops 新 dashboard，侧栏 / 链接都去新页面，旧路径（`/admin/...`）在 ops 网址下 307 跳新页面。
  - ⚠️ 切换后 ops 网址下打不开旧排车页了：G35 同步失败时「手动上传 Rezdy CSV」的后备只能去 **confirm.nationalparkexpress.com** 做。
    Dispatch Step 1 的红字和 How to use 已写明这个网址（`components/dispatch-manifest/manifests-panel.tsx`）。（dashboard-12 窗口提醒）
  - 检查期望跟着改：`page-switch-check`（加现在清单的 4 项）、`nav`（旧页面经 ops 打开改用没切的 Bug Reports 测；HR 旧路径 307 跳新页面）、
    `dr` / `mt` / `tour` / `tk` / `tt` / `da` / `mf` 里「清单为空」的链接期望改成 ops 路径。
  - 以后 Bug Reports 验收通过，把 `lib/page-switch.ts` 里那个 filter 去掉即可；`mf` 套里「从排车页站内点进 manifest ⇒ ‹ Back 走后退」那条现在可以补回来（没补）。
- [ ] （以后，后端的事）confirm 上的后台要不要自动带到 ops：由 Annie 定，后端窗口做。

## 不迁移

- 3 个 Utilities 页
- coming-soon
- Test Orders（等 E1）

## 需要后端

由 Annie 转给后端窗口。（2026-10-14 起 Annie 让 ops 直接发后端窗口。）

- 🟠 **G71 自动保存不放锁**（2026-10-15 深夜，Annie 定「自动保存停手 3 秒存 + 请后端改成自动保存不放锁」；ops 自动保存已上线）：现在 `POST /api/dispatch/day` 存好就放开编辑锁，自动保存每 3 秒一存，存完别人就能占这一天。
  要：save 带 `keep_lock: true`（或别的写法）时存完照旧占着、续时，回原 token 或新 token；ops 15 分钟没动手自己调 release。另外 10 分钟提醒已撤，`edit_timing.remind_after_s / auto_save_after_s` ops 不再用（只用 `heartbeat_every_s`）。✅ 2026-10-16 凌晨已发 `npe-confirmation-service-ec`（连同下面挪座位那句），等回字段名再接。
  顺带：挪座位出错的原话「…Save schedule in Step 2, then try again.」页面已没有 Save schedule 键，请改成「…once Step 2 is saved」之类（已核对：`app/services/tour_manifest.py:1152`）。

- 🔴 **Farm out（G40，任务包 [docs/farm-out/任务包_farm-out.md](docs/farm-out/任务包_farm-out.md)）——ops 要的接口**（2026-10-15 查：后端第①阶段还没开始。✅ **10-15 晚 Annie 回完两份预览的问题，全文已发 `npe-confirmation-service-4f`**；Annie 确认后端 Farm out 由 **4f** 做：今晚先出接口形状 + 设计 / SQL 草稿给 Annie，SQL 批了才写代码。ops 等形状到了从 main 拉 `task/farm-out`）：
  ops 建议跳过任务包第②阶段（旧 Jinja2 Dispatch 页）——Dispatch 已切到 ops，旧页面不加新功能。ops 需要（形状后端定）：
  ① Dispatch 存车（`/api/dispatch` 那套）认一台车 `farm_out: true` + `partner_id`，这台车豁免「没司机不让保存」；Seat guests（`/api/dispatch/seating`）能把整单挪到 Farm out 车，只挪部分人时拒绝并给原因；没有时刻表的团返回原因；
  ② seating 的订单补字段：OTA 确认号（没有时回落订单号）、成人 / 儿童 / 婴儿数、客人实付；Farm out 订单再带：酒店、集合 / 发车时间（自动值 + 改过的值）、应付对方（自动值 + 改过的值、改的人和时间）、通知已发（谁、何时）；
  ③ 存每单酒店 / 时间 / 应付金额的接口；④ 转单通知发送：预览（逐单原文、缺什么）+ 发送（短信 + 邮件、per-person 渠道结果、Send Log、查重和 send_anyway，同其他发送接口）；撤销时返回「已收到通知」的单子；
  ⑤ Settings：合作公司 + 按团成人 / 儿童价 CRUD；转单时刻表（酒店 × 团的发车时间）+ 每团预计返回时间、PLEASE NOTE CRUD；Content Studio 模板；
     **（Annie 2026-10-15 晚改）时刻表按合作公司各一张**：读 / 存某家公司的整张表 + **上传 CSV / xlsx 的解析接口**（返回解析结果和跟现在的差异，不存；staff 点 Apply 再存）+ 下载 CSV；
     **Content Studio 模板按合作公司各一份、短信和邮件分开**（键如 `tmpl__farmout__<partner>__email_subject / email_body / sms_body`，加 Default；新公司从 Default 复制），发通知按这单的公司取；
     **合作公司自己的上车点**（不配我们的 Pickup Locations）：每家公司一张上车点表（名称、位置、地址、地图链接），时刻表 = 它的上车点 × 团；
     **查单接口**（订单查询 / 订单详情 / Tracking / seating 里的转单）带两套资料 + 通知发出时间 + 合作公司发车时间，前端按「通知发出 → 发车后 1 小时」切换；电话 AI 同一规则；
  ⑥ 报表：按日期范围、合作公司筛的列表 + CSV；⑦ 早班接客短信名单排除 Farm out 客人（Send 页要知道排除了几位）。relay 司机页 Farm out 栏是后端页面，后端自己做。

- 🔴 **Dispatch Send 页也给导游发短信，链到 Guide view**（Annie 2026-10-15：「Bus Manifest 上有一个 Guide View，那个就应该是 tour guide 该看到的东西」；✅ 已直接发 `npe-confirmation-service-b7`，e2 已关；后端登记为 **G75**（`8c9f3d8`），谁做 Annie 定，短信措辞是 ops 的建议、还没批）：
  ① `/guide` 支持 `?date=`（同 `/driver`，头一天晚上发、点开看明天）；② 照 `driver_notice` 做导游通知（名单 = 当天 bus tour 车上的导游、HR 电话、没电话 / 没登录列原因；原文建议「NPE: Your guide manifest for … is ready. Log in to see your bus and guests: …/guide?date=…」，措辞和 Annie 确认；只发今天 / 明天、锁、action_log）；
  ③ 导游账号（现在 0 个）在 HR 开。接口形状后端定。ops 收到后：Send 页「Text to guides」显示原文、名单加导游、发送键一起发。
  - ➕ **补充（`task/dispatch-collapse-completed` 2026-10-15 追加，还没并进 G75 的范围，请做的人一起看）**：Annie 同一天还说「我们网站的所有发送都是可以选 sms/email 和 both」——现在 `driver_notice.py` 发司机也只有短信，没有 Email / Both 选项。
    G75 做的时候请把**司机和导游**的发送都改成能选 `channel`: `sms` | `email` | `both`（邮件取 HR 邮箱，模板文字另给 Annie 定），`driver-notice` 接口和返回的 per-person 结果都带上这个维度。ops 收到后在 Send 页加选择（先给 Annie 看预览）。Dispatch Completed 后那句已经写了 tour guides。

- 🔴 **Tour Confirmation / Tickets 定时自动发送（Annie 2026-10-14 定；新功能，整块是后端的活，ops 只做 Products 页一个字段）**
  ✅ 2026-10-15 Annie 让发 ⇒ 已全文发后端 `npe-confirmation-service-75`（ops 3c 窗口发），请它登记、不归它就转；接口好了回给 ops，Products 页字段先给 Annie 看预览：
  - **背景**：现在都是人工在 Manifests 页点「Send tour confirmation」/「Send tour reminder」。Annie 要改成每天定时自动发，不用人工点。
  - **时间**：每天 **PST（Los Angeles）7:00 AM 和 6:00 PM 各发一批**，Tour Confirmation 和 Tickets 两种都在这两个时间点跑。复用 `main.py` 现有的 `AsyncIOScheduler`（`CronTrigger`，已有 23:59 日报、3:00 AM Rezdy 对账两个先例）。
  - **发送范围**：和现在人工发的窗口一致（未来 3 天内、当天 confirmed 的团）；每次运行只发「这次该发、还没发过」的，复用发送页本来就有的查重（不用 `send_anyway`，自动任务不重发）。具体是否要一个可调的「未来 N 天」配置项，由后端定（不用写死代码里，参照本仓库「除格式外都不能写死」的原则，这条也请后端照办：时间、窗口天数都要能在后台改，不是改代码）。
  - **巴士团模板（tour type）怎么定（Annie 2026-10-14 确认：每个巴士团产品本来就固定对应一个 tour type，只是以前人工选，不是每次临时变）**：
    - 照 Tickets 已有的 `ticket_tour_type`（`manifest_products.ticket_tour_type`，`settings_products.py`）加一个**巴士团同款的默认字段**（比如 `tour_type`，建议和 `ticket_tour_type` 用一样的校验方式——必须是 `tour_config.TOUR_TYPES` 的 key 或 null）。
    - Products 页（ops）加这个字段的设置项，和 Ticket tour type 并排放。
    - **这个字段也要能喂给人工发送弹窗做预填**：`GET /api/manifests` 的字段清单（`manifest_fields.py`）比照 `ticket_tour_type` 的做法（`Field("ticket_tour_type", ...)`，`:268`）给巴士团也加一行，这样 ops 的发送弹窗能读到默认值、自动预填下拉框（人工还能改，不是拿掉这一步，只是不用再从空白选）。
    - 没配置默认值的产品：自动任务跳过（不乱发），人工发送弹窗下拉框照旧空着。
  - **部分订单有问题时（Annie 2026-10-14 定：跳过，不整批卡住）**：
    - 现在 `manifest_send.py` 的 `send_tour()` / `send_tickets()` 是「整批一个订单有问题就全部不发」（接客时间读不出、门票没 Cfm #、Tour type 没配、选两次冲突……都是直接 `raise SendError`，整批拒发）。这是人工发送特意要的「别让系统帮你瞎发」设计，**自动任务不能沿用**：要改成**逐单判断，有问题的那一单跳过、正常的照发**。
    - 跳过的单要通知人去处理：参照 `pickup_time_alert.py` / `unclassified_alert.py` 的做法（APScheduler 定时扫、每单只报一次、记一张表防止重复报警），邮件 reservations@ / azhou@（和 G68 一样的收件人），写清楚哪些订单、哪个原因跳过的。
  - **需要的开关 / 可见性（防线上出问题没人发现）**：
    - 后台要有**开 / 关**这整个自动发送的开关（不是改代码部署，是能随时在后台点掉，出问题能立刻停，参照 `DISABLE_SCHEDULER` 的精神但做成运行时可切的，不是环境变量）。
    - 自动发的记录要能和人工发的区分开（Send Log 现在按 `sent_by` 记是谁发的；自动发送建议写一个固定值如 `"scheduler"`，ops 这边以后要不要在 Send Log 页面上标出来再定）。
  - **不在这次范围**：微信 / WhatsApp 发送通道（Annie 问起过司机收 manifest 截图的事，提到这两个现在系统完全没接，是另一件事，这次先不管）。


- 🟡 **团的颜色以 Products → Manifest setup 的团颜色为准，接口带出来**（Annie 2026-10-14 选的做法；还没发后端）：
  现在 Bus manifest 的大标题带用 `tour_manifest.py` 的 `style["color"]`（Products 里每个团设的颜色），但 Manifests 的组按钮（`/api/manifests` 的 `pills`）和 Dispatch 的团卡片 / 车卡片（`/api/dispatch/manifests` 的 cards、排车页的 sections）都拿不到这个颜色，
  ops 只好先按团名在代码里配（`lib/tour-colors.ts`）。要后端：`pills` 每项、Dispatch cards / sections 每项加 `color`（同 Bus manifest 的 band_color，没设为 ""）。给了以后 ops 改成读它，`lib/tour-colors.ts` 只留兜底。

- 🔴 **Main Manifest → Dispatch → 发送 审计出的后端卡点（Annie 2026-10-14 晚让发 `-37`，但 `-37` 已下线 ⇒ ⏳ 还没发，等 Annie 说发给谁）**。对着后端 `71663a4` 只读核过，按优先级：

- 🔴 **Main Manifest → Dispatch → 发送 审计出的后端卡点（✅ Annie 2026-10-14 晚已自己发后端，排进后端 10-15 待办；后端做完回来 ops 跟：尤其 3 的 relay-send 返回形状、5 的 409）**。对着后端 `71663a4` 只读核过，按优先级：
  1. **Dispatch 名单会悄悄过时**：`dispatch_sync.sync_day` 只有 `POST /api/dispatch/manifests/sync` 调（`tour_manifest.py:270`），ops 只在打开 Dispatch / 换天时调。
     `POST /api/dispatch/relay-send`（`relay_pull.py:96`）发之前不同步，用 `tour_manifest_guest` 里的旧名单 ⇒ 晚上之后取消 / 改时间、没人再开 Dispatch，第二天早班短信按旧名单、旧时间发。
     建议 relay-send 和 relay-send/preview 算名单前先 `sync_day`（driver-notice/send、seating 后端判断）。
  2. **G65 只增不删没做**：Completed 之前同步直接删掉取消的客人行（`tour_manifest.py:1169-1171`），上车标记、relay_status 一起丢、不留记录。
  3. **G61**：relay-send 不收 `order_numbers`、没有 `send_anyway` / `preview_at`、只回 `already_sent` 个数不给单号；relay-pull 不带 sent_at / sent_by ⇒ 发过之后改了时间的客人没法重发新时间。
  4. **G62**：群发（`/api/manifests/broadcast`、`/booking-notes/broadcast/send`）不查重、没有 send_anyway；`/api/dispatch/driver-notice/send` 也不查重。
  5. `POST /api/dispatch/day` 整天删了重写（`services/dispatch.py:946`），没有版本检查 ⇒ 两人同时改，后存的覆盖先存的、没提示。建议加 updated_at 校验、过时回 409。
  6. Dispatch 每团上传 .xlsx：表里已手动减过 15 的会再减一次（−30；`tour_manifest.py:249`）。CSV 没这个问题。
  - 顺带：G68 待办「等 Annie 执行 v92」没改（ACTIVE.md 记已执行）、DG-6 没关；Railway `PICKUP_TIME_ALERT_SMS_TO` 设没设看不出；前端迁移规则文档第五节（`:147`）还写「不迁 Manifests」，dispatch / relay / pending / sync 接口都没登记。
  - 不在范围（新功能，等 Annie 定）：Guest Bus Letter（发车号给客人）、Driver manifest screenshots——系统里都没有。

- 🟡 **门票 Tracking 每行加 `checkin_location`**（Annie 2026-10-14：订单查询的门票块要显示 Check-in 地点；✅ **Annie 10-14 晚已自己发后端，写进后端 10-15 优先待办**；后端做完回字段名 / commit 号后核对一次，字段名不同改 `types/tickets-tracking.ts`）：
  `GET /api/notifications/tickets-reminder/tracking` 每行加一个字符串 `checkin_location`，口径同门票短信 / 邮件里的地点
  （`tickets_reminder.py` 的 `pt("checkin_location") or cfg.get("checkin_location", "")`，即 Content Studio `tmpl__tix__<产品>__checkin_location`，空着用代码默认）；没有为 `""`。
  现在 staff 拿不到：Content Studio 接口是 require_admin，而且模板空着时的默认地址只在后端代码里。ops 已按这个字段名做好（`types/tickets-tracking.ts`），后端给了就显示，不用再改前端。

- ✅ **新增 `supervisor` 角色——后端已上 main `ee101a8`（82 10-14 晚通知；`/api/me` 字段 `is_supervisor`、角色值 `supervisor`，和 ops 一致，ops Users 页自动出现；旧页面徽章靛蓝，ops 已照抄）**（10-14 已发 `npe-confirmation-service-7c`，7c 已收：排在「减 15」后面，动手前先和 Annie 确认范围、过安全审查，做完回 commit 号和 `/api/me` 字段名。Annie 2026-10-14 定；dashboard 任务包「主管」= supervisor，解掉任务包 Stop Condition「没有主管角色」）：
  - 档位：superadmin > admin > **supervisor** > staff；driver / guide 照旧不进后台。
  - supervisor 在**现有功能上和 staff 完全一样**：`ADMIN_ROLES` 不加 supervisor，所有 `require_admin` 的地方（全部 Settings 页、Users、HR、Teams、Promotion 上传、Manifest Money 组等）仍挡住它；
    `require_superadmin` 的（改角色、停用 / 删用户、侧栏配置等）照旧。Annie 选的是「Settings 都不给，以后要放再放」。
  - 要后端：① `ALL_ROLES` 加 `supervisor`（能登录后台、过 `require_staff`）；② 新加一档检查「supervisor 及以上」（supervisor / admin / superadmin），给 dashboard 阶段二～四用；
    ③ 改角色接口（superadmin 才能改）接受 `supervisor`；④ `/api/me` 返回里加 `is_supervisor`（supervisor 及以上为 true），ops 按它显示 / 隐藏，不自己比角色字符串；
    ⑤ 旧后台 Users 页的角色下拉 / 颜色要不要加，后端定（旧页只修 bug 不加功能，但角色不认识会显示错）。
  - supervisor 新能做的（都是 dashboard 改版后面阶段的新接口，到时按 ② 挡）：改每日任务模板、改截止时间、把任务指定给某人、看全部人的任务；
    Staff Schedule 排班并发布；收任务交接 / 超时 / Daily Operation Report 事故通知；改日报记录的状态和跟进人。
  - 任务包要求的「可配置权限项」（`schedule.edit` 这类）**这次不做**，先按角色档位挡；以后 Team 模块做授权时再换。
  - ops 这边 ✅ 已先做（`task/supervisor-role`，见「进行中」顶上）：后端 `/api/me` 带 `is_supervisor` 就自动出现，**字段名若不同要改 `supportsSupervisor`**。

- ✅ **（后端 `9102912` 已上线、v90 已跑，ops 已跟）Main Manifest 加「接客时间 = Rezdy 时间减 15」，所有发给客人的地方都用它**（Annie 2026-10-14 定；✅ 10-14 晚 Annie 让发空闲的后端窗口 ⇒ 已发 `npe-confirmation-service-37`，之后 Annie 定改由 **`npe-confirmation-service-7c`** 做、全文已重发 7c。
  37 只读核过：两个漏洞线上都还没让客人收到错的时间（Manifests 发送 10/05 起没用过；最近 7 天早班短信都从上传页发、已减 15），但 Dispatch 发送上线前必须修）：
  - 起因：减 15 现在只在上传 CSV 时做（`excel_parser.py:591-642`，10-08 定）；**从 Manifests 页发 Tour Confirmation 没减**（`manifest_send.py:71` 直接用 Rezdy 原时间），
    电话 AI 读 Main manifest 也是原时间（`voice_lookup.py:227, :383`）⇒ 同一张单从上传页发和从 Manifests 发，客人收到的时间差 15 分钟。没登记过。
  - 要后端：① 字段清单（`manifest_fields.py`）原来的 `pickup_time` 表头改叫 **Departure time**（内容不变，仍是 Rezdy 原时间）；
    ② 新加一个**算出来的**字段，表头叫 **Pickup time**（Annie：不加 Guest，太占地方）= Departure time 减 15，不存、不能改，规矩只写在后端一处；默认 bus 列换成显示它；
    ③ Manifest 发送（`manifest_send.py`，含往返回程）、客人确认页、电话 AI 都改用这个减过的时间。
  - **Annie 2026-10-14 已定**：Rezdy 的 pickup time 就是 tour **真正的发车时间**；**所有 bus tour 固定减 15**（不按产品设）；
    **往返 shuttle 一样减 15**（含回程——回程时间来自产品设置的 `return_pickup_time`，也减）；**早班 reminder 从 Dispatch 发**（不从 Manifests 发，照旧）。
  - ⚠️ **第二个漏洞（ops 2026-10-14 只读查到）**：Dispatch 的早班发送（Morning Relay，`relay_pull.py:171` 的 `send_row`）用 `tour_manifest_guest.pickup_time`，
    这是 Dispatch → Imports 导进来的，导入模块是 `tour_manifest`（`excel_parser.py:49`），**不在** `_PICKUP_OFFSET_MODULES`（`:597`）里 ⇒ **Dispatch 发的早班 reminder 也是 Rezdy 原时间，没减 15**。
  - **规则（Annie 2026-10-14：「改一下规则就可以了」）**：Main Manifest 的 Pickup time（减过 15）是**唯一的接客时间**，下游一律拿它，不各自再减：
    Dispatch（导入 / Morning Relay 早班发送 / 司机手机版 manifest / Work sheet）、Manifest 发送、客人确认页、电话 AI。Departure time 只给人看。
    ⇒ ④ 上面第二个漏洞随规则一起好。后端改时注意：Relay 分轮窗口（`round_for`）原来是按 Rezdy 原时间设的，换成 Pickup time 后要确认分轮不错位；
    「发过之后又改了」（`changed_since_sent`）和发出去的同一口径。
  - **不变的（Annie 2026-10-14）**：Rezdy 数据源本身不改（`rezdy_bookings.pickup_time` 照存原时间），改的只是系统的算法；
    上传页（Tour Confirmation / Morning Pickup 发送页）保留，staff 上传的是从 Rezdy 直接下载的 CSV ⇒ CSV 上传时减 15 照旧（`excel_parser.py:591-642` 不动）。
  - **Relay 分轮窗口只是提示，不是限制**（Annie 2026-10-14）：现在 `round_for` 把两段（4:30–5:15 / 5:40–6:30，`relay_pull.py:34-54`）当硬限制，
    两段以外的客人进 Need a look（`REASON_NO_ROUND`，`:27`、`:84`）⇒ 改了 Pickup time 以后靠边的客人会被挡掉。
    ⑤ 要后端（Annie 2026-10-14 细定）：分轮看客人的 **Pickup time**；**第 2 轮由 staff 自己选**——第 2 轮的时间不另设，客人的 Pickup time 本来就在数据里（不再靠写死的 5:40–6:30 判断）；
    第 2 轮可以**一键复制第 1 轮的全部**（车、司机、停哪几家酒店），再手动改；两段时间（`dispatch.py:124-125`）只当提示，不再把客人挡进 Need a look（`REASON_NO_ROUND`）。
    具体怎么选（按客人 / 按时间点 / 按酒店勾进第 2 轮）请后端给接口形状时和 Annie 定。ops 这边：`components/dispatch/relay-panel.tsx` 加「Copy 1st Round」和选第 2 轮的操作。
  - ops 这边：接口来了，发送弹窗名单（`components/manifests/config.ts` 的 `SEND_TABLE_FIELDS.bus`）改显示新的 Pickup time，staff 发之前看到的就是客人收到的时间。
  - ✅ **10-14 晚 7c 已发接口形状**（代码在审、等 Annie 跑 migrate_v90 再推）；Annie 改定 Relay **按团分轮**（不是 staff 选人）。ops 已按形状做好兼容版，见「进行中」`task/pickup-minus15-ops`；上 main 后对一遍。

- 🔴 **7 Days Forecast 照 CCL 表补数据**（Annie 2026-10-14 定，✅ 已直接发 `npe-confirmation-service-e2`，后端登记为 **G63**（`8de88d2`）；同时登记 Category = **G64**、G35 只增不删 = **G65**，Morning Relay / 群发 Send anyway 早已是 G61 / G62。都只是登记，还没人做，接手的会先给 ops 接口形状）。
  📨 **2026-10-15 晚 Annie 让催**：G63 后端仍只有登记（`8de88d2`），已发 `npe-confirmation-service-4f` 催（不归它就转），请回谁做、何时给形状；第 5 条几项数据来源请后端开工前直接跟 Annie 定；G48 的 West-Sunset SQL 一并提醒。
  ✅ 4f 回：**Annie 要今晚做，G63 归后端 `npe-confirmation-service-4f`**（4f 先说给 a1、随即更正为 4f 自己），它今晚先把 1–3 的接口形状发 ops 再做、第 5 条数据来源直接问 Annie。以后 G63 的消息发 4f。ops 收到形状后先给 Annie 看预览再接 `cclExtraRows`。
  📐 **4f 形状（10-15 晚）**：`/api/forecast/60-day` 每块加 `running[60]`、`closed_reason[60]`、`allotments[{label,time,max,sold[60],inventory[60]}]`、`crew_notes[60]`，CCL 行加 `no_gps`；
  `PUT /api/forecast/crew-notes {date, manifest_id, block, note}`（staff，空 = 删，过去日子 400）；Settings（admin）`GET /api/settings/forecast` + `PUT …/run-days`、`POST/DELETE …/closed-dates`、`PUT/DELETE …/allotments`；每个节 / 行一档上限。
  ops 已回 4f 四点：字段名用 `section`（同 guide-plan）不用 `block`；allotments 设置也带 `section`；crew notes 最好带谁 / 何时改；确认 run_days 按洛杉矶日期、单独成块的 note 分开存。
  ✅ **4f 回（定稿形状）**：① 全用 `section`（"" = 主块）；② allotments 按 (manifest_id, row_label) 认，GET 设置带推出来的 `section` 供显示，PUT / DELETE 不带；③④ 是。
  **范围加了**（Annie 10-15：「除非我已经做了拉取或同步，其他的都可以手写，一直到我做好所有的同步」）：crew-notes 接口作废，换通用手写格子——
  每块 `cells: {crew_notes, pax_tours, driver_vehicle}[60]` + `cells_meta`（{updated_by, updated_at} | null）；整页 `page_cells: {major_events}[60]` + `page_cells_meta`、`live_link`、`updated_by: {name, at} | null`；
  写 `PUT /api/forecast/cells {row_key, date?, manifest_id?, section, value}`（staff，≤500，空 = 删，过去日子 400）。
  自动不存：每块 `depart_times[60]`（当天已确认单的 Rezdy 出发时间，Sunset 那行用）；Private 块（manifest 7）`orders[60][{order_number, pax, product, pickup_location, pickup_time}]`（接客时间同别处 −15）。
  ops 回 4f：照这个做，不再改。等 Annie 跑 migrate_v96 + 4f 推 commit。预览已更新第 2 版（加 ①b 页头 Live Link / Updated by、Sunset、Private）。
  ➕ **Annie 10-15 晚：「Max allotments 这里也给它加个跟上面一样的日期设定吧」** ⇒ 每行照旧有平常上限，另可按日期段设不同上限 / 时间（同停开日期的写法，重叠不让加）。
  已发 4f（影响 migrate_v96，请在 Annie 执行前并进去），ops 建议的形状：设置 allotments 加 `id`、`date_from` / `date_to`（null = 平常上限），`POST / DELETE /api/settings/forecast/allotments/dates`；60-day 每档 `time` / `max` 改成按天数组（`max` 为 null 那天无上限、inventory 也 null）。等 4f 回形状。预览第 3 版已加。
  ✅ 4f：日期段已并进 migrate_v96（还没执行），形状照 ops 提的（60-day 每档 `time` / `max` / `sold` / `inventory` 按天，`max` / `inventory` 可 null）。
  ➕ 4f 新加：GET 设置带 `order_detail_blocks: [{manifest_id, section}]`，`PUT /api/settings/forecast/order-detail {blocks}` 整组替换；只有勾了的块 60-day 才带 `orders`（不写死 Private 组 id）。
  ⇒ ops 在 Bus Manifest setup 加第 10 项「List each order on the 7 Days Forecast」勾选框；**上线后 Annie / admin 要在 Private 组勾一次**，否则 Private tours 那行是空的。预览第 4 版已加。
  ➕ **Annie 10-15 晚：「三个羚羊谷都用他们的第一个字母大写吧」** ⇒ 库存行和 Max allotments 行里写 U / L / X（例「U 18 · L 21 · X 30」「L 35 · 1p」），分项行照旧全名。
  写法：取行名（Products 的节名，Antelope 是 UPPER / LOWER / X）的第一个字母大写，不写死团名；同一块里两行首字母撞了就那两行写全名。预览第 5 版已改。
  ➕ **Annie 10-15 晚：「然后左边对齐」** ⇒ 库存、Max allotments、Sunset depart times 这几行文字格靠左（同 Crew notes 等手写格），人数格照旧居中。预览第 6 版已改。
  ➕ **Annie 10-15 晚**：「那把这行的数字跟 allotment 放在一起把 18/30」「18 用浅蓝色，就是我之前用在 main manifest 里的」⇒
  **去掉「Lower or Upper inventory (ref only)」行**（`cclExtraRows` 里删掉），剩几位并进 Max allotments 行：每档一行「U 18/30 · 12:40p」（剩几位 / 上限 · 时间，用 60-day 的 `inventory` / `max` / `time`），
  左边名字下面小字「seats left / max」；剩几位用浅蓝 `#7dd3fc`（= Main Manifest 胶囊人数在深色底的 `night:text-sky-300`），卖超负数红字；某天 `max` 为 null 的档那天不写。预览第 7、8 版已改。
  ➕ **Annie：「把数字缩小一点尽量保持 3 行」** ⇒ Max allotments 格 9.5px、每档一行不折（`whitespace-nowrap`），写成「U 18/30 12:40p」（去掉时间前的 ·）；
  有 Max allotments 的日子列宽至少 88（原来没司机安排的日子 74 放不下；有司机安排的 150 不变）。预览第 9 版已改。
  ✅ **Annie 回 3 个问题（10-15 晚，⛔ 不再问）**：① Max allotments 的上限**只在最左边写一次**；② 手写格子所有 staff 都能写、过去的日子只读；③ 第 8 Running days / 9 Max allotments / 10 List each order 放 Products → Bus Manifest setup。
  ⇒ 左边名字下面列每档平常上限「U 30 · 12:40p」（60-day 每档新加的 `normal_time` / `normal_max`，4f 已加）、小字「cells: seats left」；格子只写剩几位（浅蓝，负数红）；
  某天 `max` / `time` 和平常不同（日期段）⇒ 那档后面补黄字「/20 11a」（title「Different cap on these dates」）。预览第 10 版。**预览 Annie 已定稿**。
  4f 另说：`live_link` 只收 http:// / https:// 开头（否则 400「Paste the whole link, starting with https://」），渲染时 `rel="noopener noreferrer"`、新窗口打开。
  **下一步**：等 Annie 跑 migrate_v96、4f 推 commit ⇒ 从 main 拉 `task/forecast-g63`：Forecast（`types/forecast.ts`、`config.ts` 删 inventory 占位行、grid 接 running / allotments / cells / depart_times / orders / no_gps、手写格编辑弹窗、页头 Live Link + Updated by）+ Products 第 8–10 项 + `fc` / `products` 套加检查。
  🖼️ 预览给 Annie：https://claude.ai/artifact/PC9PryVB1PxzWW7TkBAQ3V （Forecast 新行 + Products Bus Manifest setup 第 8 Running days / 第 9 Max allotments，附 3 个问题）。Annie 同意 + 后端推了再从 main 拉 `task/forecast-g63` 写代码。：
  ① 不开团日在 Products 设（每周开哪几天 + 停开日期），forecast 每块每天给「不开团」标记（ops 显示 -）；② Max allotment 在 Products 设（可几档：数量 + 时间），forecast 给 Max allotments 行和 Inventory = 上限 − 已卖；
  ③ Crew notes（每天每块一段文字）和没 GPS 的车号由 staff 在 ops 填 ⇒ 存储 + 读写接口；④ Notes 行（导游 confirmed）Annie 自己设计，先不做；
  ⑤ Sunset depart times、Private 块明细、CCL major events、Day Tour Live Link、Updated by：Annie 要，来源 ops 给了建议，请后端和 Annie 定。接口来了 ops 从 main 开分支填 `cclExtraRows` 那些占位行。

- **West Sunset 改用独立组，CCL 对照跟着改**（Annie 2026-10-13 晚定，⛔ 不再问）：West Rim 拆出来的 SUNSET 块（G48）不要了，改用 staff 另建的独立组 West Sunset（改名 West-Sunset、排在 West Rim 后面）。
  要后端：① SQL 把 `dispatch_ccl_section` 的 `WEST RIM SUNSET` / `GC WEST SUNSET` / `SUNSET` 三行 `manifest_id` 改成这个组的 id（先给 Annie 看再执行）；
  ② 只读查一下 `forecast_guide_plan` 里 West Rim + `section='SUNSET'` 有没有排班，有就一起搬到新组（section 空）；③ G48 的「Dispatch 上 Sunset 单独成块」不用做了（独立组本来就单独一块）。
  Annie 在 Settings → Products 自己做：Sunset 产品放进新组、West Rim 的 Own block 去掉 SUNSET、组改名和 Order。ops 不用改代码。

- 🔴 **Settings → Products：添加 Category**（Annie 2026-10-13：「在 products 里我需要添加 Category 的功能」「让后端改这个功能」）。**Annie 定选 ②：「做成我可以定义添加，而不是每次有个新 category 就要去动代码」。** 等 Annie 转后端、后端定接口形状。
  - 现状（ops 只读查过后端 main）：Category 就是产品的 `booking_type`，取值只有 `webhook.py:311` 写死的 `_KNOWN_BOOKING_TYPES = {bus_tour, ticket, shuttle, unmapped}`，
    经 `GET /api/settings/products` 的 `booking_types` 下发（`settings_products.py:390`，注释写明前端不许自己写一份）；PUT 不在集合里的值会 400（`:228`），Rezdy 来的值不在集合里会发告警邮件。
    Category 决定订单算进哪些报表，所以加分类不只是多一个选项。
  - 原来列了两种做法：① 后端代码里加固定的新分类；② 页面上管理分类。**Annie 选 ②**，以后加分类不动代码。
  - 要后端：分类存进表（代替写死的 `_KNOWN_BOOKING_TYPES`）+ 列表 / 新增 / 改显示名 / 停用的接口；`booking_types` 照旧从接口下发（最好带显示名）；
    产品 PUT、Rezdy 来单的校验和告警改成按表里的分类；停用的分类不能删、已用它的产品照常显示（同 Groups 的 inactive）。
  - ⚠️ 要 Annie 和后端定：**新分类怎么进报表**（Sales Report、Ops Summary、7 Days Forecast、发送页等现在都按那 4 个值写的）。
    ops 的建议：每个分类带几个开关，报表 / 排车按开关走，这样加分类也不用改代码：进不进 Manifest / Dispatch / 7 Days Forecast（排车）、进不进发送页 / Tracking、Sales Report 里怎么显示。
  - **Annie 举的例子（2026-10-13）**：CHD 这个组的产品其实是费用——改期费（reschedule）、其他手续费等，通常跟在一个订单里，归作 Process fee / Processing fee。
    只是财务统计数：**不排进任何 Manifest（包括 Main manifest）**，**只反映在 Sales Report 的明细分项里**。也就是要能建一个「Processing fee」这样的分类：不排车、不发送，Sales Report 里单独一项。
    - ops 只读查后端 main：Manifest / Dispatch / 7 Days Forecast 本来只认 `booking_type = 'bus_tour'` 的组（`dispatch.py:552`、`forecast.py:202`、`manifest_setup.py:85`），别的分类本来就不排车；
      **Sales Report 现在只分 bus_tour / ticket 两类**（`sales_report.py:42`），费用类没有地方显示，要后端加。
    - ✅ Annie 2026-10-13 定：**费用算进 Sales Report 的总额**（明细里单列一项，总数里也加上）。
    - 还要后端查：Main manifest 的上传 / 比对现在会不会把这类产品混进去（应跳过）。
  - ops 这边：等后端接口形状，在 Products 页加分类管理（照 Groups 卡片的样子：列表、新增、改名、停用），下拉改用接口给的显示名，
    `components/products/config.ts` 的 `TYPE_LABELS` 写死的叫法去掉。

- 🔴 **发送表格的全选 / 单选 / Send anyway：两处要后端**（Annie 2026-10-13 定「都要有」；ops 已查后端 main 代码，只读）。✅ **10-13 已直接发后端 `npe-confirmation-service-d3`**（Annie 同意直接发；原来的 cb 窗口已关），请它登记、不归它就转。
  1. **Morning Relay**（`POST /api/dispatch/relay-send`，`app/routers/relay_pull.py:96`）：后端自己重算名单、**不收前端选的人**，发过的（send_log `morning_pickup` 同团期有成功记录）自动跳过、没法照发，
     返回只有 `already_sent` 个数。要：可选 `order_numbers`（只发这些，照 `driver-notice/send` 的 `recipients`）+ `send_anyway` / `preview_at`（同其他发送页），返回 `already_sent` 单号；
     最好 relay-pull 的客人带 `sent_at` / `sent_by`。不带参数 = 现在的行为。ops 收到接口后在 Relay 面板加三样。
  2. **群发 Send anyway**（Tracking `/booking-notes/broadcast/send`、Manifests `/api/manifests/broadcast`）：现在人人照发。**Annie 定口径：同一个团期、一模一样的消息发过这单才算「群发过」，换了内容照常发。**
     要：发之前能标出哪些人群发过（预览接口或行上的标记）、默认跳过、`send_anyway` + `preview_at` 照发、返回跳过名单。形状后端定。全选 / 单选 ops 已上线。
  - **Multi Orders 回复不改**（Annie 2026-10-13：一次回一个地址，没有名单，全选 / 单选 / Send anyway 不适用）。

- 🔴 **G35 改成「只增不删」**（Annie 2026-10-13 批，取代 10-12 的方案 B「手动上传的名单不被同步冲掉」——那条作废：现在手动上传被同步盖掉没关系）。8e 窗口和 Annie 定的，Annie 在转后端，**接口形状没定，等后端 `/sync` 返回形状再做 ops**：
  - 规则：同步可以**加**单、**更新**单（人数、接送等跟主 Manifest 走），但**不删**已经在某团名单上的单。上次名单上有、主 Manifest 里没有的单：
    - Rezdy 里取消了 ⇒ 显示 0 pax，原因「Cancelled in Rezdy (时间)」；
    - 改到别的日期 / 团 ⇒ 0 pax，原因「Moved to 10/15 South Rim」；在新的那天照常出现；
    - 找不到取消 / 改期记录（多半是 Rezdy 数据没到）⇒ **人数不动**，橙字「Not in main manifest — check Rezdy」；这单回到主 Manifest 后这句自动消失。
  - 给后端的建议（形状未定）：① `tour_manifest_guest` 有 pax 1..9999 的检查，建议另加状态列（cancelled / moved），保留原人数、不算座位，带原因；
    ② 取消 / 改期原因从 Order List 查，客人资料本身仍只来自主 Manifest；③ 下游：取消 / 改走的行在司机页、Bus Manifest 上划线或变灰，发送和提醒跳过，座位数不算。
  - ops 这边（到时在新分支上做，从 main 拉）：Step 1 / Bus Manifest / 车下面名单显示 0 pax + 原因、橙字提示；座位数不算；发送页跳过。

- **Forecast：Sprinter 改黄色 + 页名改 7 Days Forecast**（Annie 2026-10-12 晚）：
  ① 设置 `forecast_vehicle_tiers` 里 Sprinter（≤20）那档的 `color` 从 `black` 改成 `yellow`（一条 SQL，`_COLOR_RE` 允许）；ops 已经把 yellow 画成柔和的黄（`task/forecast-colors`）。
  ② nav-config 种子（`app/services/nav_config.py` 的 `SEED`）里 `forecast` 的 label 改成「7 Days Forecast」，跟 ops 的 `DEFAULT_NAV_CONFIG` 保持一样（已存过配置的以配置为准，Annie 在 Settings → Navigation 改）。
  ③（以后）车型档位和颜色现在只能改设置那一行，最好在设置页里能改（同「显示要有管理设置」的原则）。
  - ✅ 已发 d8（2026-10-12 晚），后端登记 **G57**（①，SQL 先给 Annie，10-13 做；③ 是 G57 的后续项）、**G58**（②，10-13 做，顺带改旧 Manifest setup 面板的说法）。

- **Dispatch：Completed 之后变了的单 → 待处理**（Annie 2026-10-12 晚定方向；ops 已先把 Completed 改成「这一天做完了」、一直显示，`task/dispatch-sync`）：
  - Completed = staff 标这一天的 Dispatch 做完了。**之后**同步（G35）再变的单不清 Completed，而是逐单记成「待处理」：新增、取消、改了（人数 / 接送时间 / 地点 / 产品…，写改了什么），
    带团、原来在哪台车，提醒 staff 去更新已经发出去的东西（Bus Manifest、司机 / 导游）。Completed 之前的变化不记（staff 还在排）。
  - 后端要：① 同步时名单变了**不再清** `guest_lists_done`；② Completed 之后的每个变化存一条（这一天、团、订单号、类型、改了什么、原来的车、什么时候）；
    ③ 读接口（这一天的待处理，ops 放在 Dispatch Step 1 / 对应的车下面，以后也进 dashboard 的 Today's tasks）；④ staff 处理完点掉（记谁、几点）。
  - ✅ 后端已登记 **G56**（d8 2026-10-12 晚回）。**Annie 2026-10-12 20:5x 已定**（⛔ 不再问）：逐单点「已处理」**和**一键全部处理都要，都记谁、几点；
    取消的单**不**推到司机 / 导游页，只提醒 staff；**Morning Relay 算进去**，待处理写明是哪一轮 / 哪台 relay 车；旧网站手动上传 CSV 和同步一样处理。
  - 后端另一个窗口在分支 `task/dispatch-pending`（`ee7ffbd`）做，要 Annie 执行 `migrate_v89.sql`；接口写在那个分支的 `tasks/ACTIVE.md`，**上 main 后后端会发最终接口过来**。
    ✅ ops 已照草稿接口做完上线（`3f8529e`，见「进行中」开头 `task/dispatch-pending`）；后端 -87 确认：服务端行为和 `/api/dispatch/pending` 同一次合进 main（之前一直 404，ops 的保护成立）。
    **与后端 -87 约好的 `relay` 写法（它 10-13 照这条核对）**：可直接读的短句，形如「1st Round · Relay car 2」，**不带「Morning Relay:」前缀**——ops 显示时自己加成「Morning Relay: 1st Round · Relay car 2」，接在 To do 后面。

- **2026-10-11 深夜后端（npe-confirmation-service-d8）回复了 4 件**：
  1. Antelope 分节 → 后端待办 **G46**，SQL 已备好（23 个产品：UPPER 7 / LOWER 9 / X 7；LV↔Page shuttle 本来就设好了 outbound / inbound，没动）。
     **两个产品等 Annie 定**：`PCDTN4`（VIP Small Group … Lower Antelope）、`P1S62V`（Secret Antelope … Private Horseshoe Bend）。**等 Annie 点头再执行。**
  2. ✅ Money 组对所有 staff 开放：后端 main `639b41b`。ops 的 `man` 模拟接口跟着改成 staff 也有 Money 组（`moneyAdminOnly` 开关保留旧行为，测「存着但没权限」的提示），110 / 110。
  3. Take action 开关 → 后端待办 **G47**，还没改；以后加 on/off 参数时不传 = 旧开关，ops 不受影响，到时再接。
  4. ✅ 旧 Tour tracking 预览空白：确认是 `7c03bd3` 的回归，后端 `639b41b` 已修。
  - 后端随后又说（G46 Annie 已批）：分节是 UPPER / LOWER / X + 「VIP LOWER」（PCDTN4）+「SECRET ANTELOPE」（P1S62V），另有 3 个门票产品补 ticket_tour_type；SQL 在 Annie 手上，ops 不改代码。
  - ✅ **门票新增 3 个 tour type 已跟**（后端 `a0d1413`，v84 已在生产执行）：门票发送页下拉 Other 组最后、Tickets Tracking 产品按钮 DC / SD / WP、
    Content Studio 门票的 tour 列表（名字照旧页面）；tk 72/72、cs 32/32、mt 125/125。下面是当时的记录：
  - **门票新增 3 个 tour type**（等 Annie 执行 `migrate_v84.sql`、后端推 commit 并告诉 ops）：`deer_canyon`「Deer Canyon Tour」DC、`sand_dune_canyon`「Sand Dune Canyon Tour」SD、
    `wind_pebble_canyon`「Wind Pebble Canyon Full Tour」WP，排在每个清单最后（`secret_antelope_combo_hbt` 后面），每个类型和现有的一样有 15 个 Content Studio 键。
    ops 要改三处写死的清单：`components/content-studio/fields.ts` 的 `TIX_TOURS`、`components/tickets-send/config.ts` 的 `TOUR_TYPE_GROUPS`、`components/tickets-tracking/config.ts` 的 `PRODUCTS`。
    **照后端那次 commit 里旧页面（send_tickets.html / tracking_tickets.html / settings_templates.html）的分组和文案抄**，已请后端推完把 commit 号发来。

- **Antelope 产品分节（UPPER / LOWER / X + shuttle 的 outbound / inbound）**（Annie 2026-10-11 晚：「Antelope 的 bus 要拆成 3 块」，选「交给后端窗口用 SQL」，
  已把要转的那段话给了 Annie）：后端按产品名填 `manifest_products.manifest_section` / `manifest_section_kind`，清单和 SQL 先给 Annie 看再执行。
  ops 的 `/manifests` 分节显示早已做好（`409a28b`），**数据填了就生效，不用改代码**；Bus Manifest 用同一栏。往返 shuttle（G36）先不动。

- （下面两条是 dashboard 改版窗口记的，2026-10-11 深夜后端已处理：组管理 `85a5d95` 已上线、ops 已跟（`abf0ae8`）；Sunset 的 CCL 车 / 关团 `33da023` 已上线，Sunset 单独成块的数据 SQL 等 Annie（G48），节的顺序在后端分支 `task/section-order` 等 `migrate_v85`。）
- **60 Days Forecast：西峡 Sunset 是独立的一条线**（⛔ Annie 2026-10-11 定：「Sunset 单独算一条线，车和导游都单独排，就放在 West Rim section 里，
  上面是正常的团，下面是 Sunset 团，两块独立」）。人数、车型颜色、staff 排导游已经是分块的（forecast-sections），块的顺序也已经是主块在上、
  Sunset 紧跟在下。`app/services/forecast.py` `get_60_day_forecast()` 还有两处把两趟当一趟，要后端改：
  1. **CCL 关团按块记**：`dispatch_import_closures` 只有 `manifest_id`，西峡关团时 Sunset 同一天也显示 Closed。要能分别关主块和 Sunset。
  2. **CCL 的车分到 Sunset 块**：现在 CCL 名单的车全挂主块，Sunset 块固定 `lines: []`、`in_main_block: true`（页面写「See Grand Canyon West」）。
     要把 CCL 里属于 Sunset 的那几行分给 Sunset 块（建议按行里出现单独成块的节名认，例如 SUNSET，不另加设置；CCL 实际怎么写由后端看 Discord 原文定）。
  - 接口字段不用变：后端改完后 Sunset 块给自己的 `lines` / `closed`、`in_main_block: false`，ops 不用改代码；`fc` 套的模拟数据已经按「两块独立」改了预期。
  - 配套：Dispatch 上 Sunset 的车是不是也要成单独一块（同样「车单独排」），请后端一起看。
- **Products 加「组」的管理：新建 / 改名 / 停用 / 排序**（Annie 2026-10-11：「前端需要什么展示，管理界面就要有对应的设置」；起因是 Boulder City 的
  shuttle 在 Group 下拉里没有合适的组可选——下拉列的是 `manifests` 全部的行，但**没有任何界面能新建组**，只能写 SQL）。
  Annie 定：只加这个功能，Boulder City shuttle 归哪一组她自己在页面上选。要：后端接口（新建要名字、显示名、分类 `booking_type`、排序、是否启用；
  先确认新建一个 `bus_tour` 组以后 Manifests / Dispatch / Forecast / Manifest setup 都能自动带出来，不用另配）+ 旧后台 Products 页的界面；
  接口好了以后 ops 的 Products 页照旧页面跟（`components/products/`、`lib/products-api.ts`）。删除组不在这次范围（下面挂着产品和历史订单）。
  - **排序：全站只有一个组顺序**（⛔ Annie 2026-10-11 定）：组管理里改顺序，Forecast、Manifests 胶囊、Dispatch、Products 全跟着变，不给 Forecast 另设顺序。
    **组管理做好之前，请后端先用一次 SQL（给 Annie 看）把 `manifests.sort_order` 改成 CCL「Forecast 2026」样表的顺序**（Annie 2026-10-11 发了样表截图，以此为准）：
    Antelope（Page）→ Bryce & Zion → Grand Canyon West → （GC West Sunset 块，跟在 West 下面，forecast-sections 已经是这样）→ GC South → Hoover Dam →
    VOF Half-Day → VOF and Hoover Dam Full-Day → Private → Multi-day；门票等其他组排在这些后面、相对顺序不变。
    ⚠️ 样表里 VOF Half-Day 和 Full-Day 是两块；现在只有一个 VoF 组（`PCDSPB` 半天被归进全天组，G37 第 5 条交给了 staff）——要两块就得有两个组，
    组管理做好后 Annie / staff 自己新建 VOF Half-Day 组再归产品；SQL 先排好现有的 VoF。
  - **块里小行的顺序也要能设**（同一个原则：显示要有对应的设置）。样表：Antelope = Upper → Lower → Canyon X → Secret → Outbound → Inbound shuttle；
    Hoover = Bus Tour → HD Raft → Boulder City；其余块 = 团 → Outbound → Inbound。后端 `build_blocks()` 现在是「默认节在前、其余按节名字母序」
    （Antelope 会排成 Canyon X → Lower → Secret → Upper，Hoover 会排成 Bus Tour → Boulder City → HD Raft），shuttle 两行固定在最后（这点和样表一致）。
    建议：Manifest setup 给每组加「节的顺序」（例如列出这一组用到的节名、可上下挪），Forecast 和 Manifests 的分节都按它排；没设的节排在设了的后面、按字母。
    做好以后 ops 的 Manifest setup 照旧页面跟。
    起因：Annie 10-09 真机验收说 Forecast 线路顺序和 CCL 表对不上——后端按 `sort_order` 排（初始 GC South 1、GC West 2、Page 3…），前端照接口顺序显示。

- **Take action 是开关，「点过又来新留言」时第一下会撤销**（2026-10-11 晚跟 `7c03bd3` 时发现，旧页面一样）：
  `PUT /api/bookings/{id}/take-action` 看 `action_taken_by` 有没有值来决定开 / 关。新判据下一单可以「`action_taken_by` 有值、
  但显示 ⚠️ Take action」，staff 点一下其实是**清掉**标记（还是 ⚠️），要再点一下才记成处理过。建议后端：没处理时点 = 重新记一次（更新时间和人），
  或者接口加一个明确的 on / off 参数。前端不自己点两下。
- **旧 Tour tracking 页 Notes 预览的小疏漏**（`7c03bd3` 的 `notesBody`）：非改期状态、只有确认页留言（`notes`）没有消息的单，预览变成空白
  （取的 `r.guest_notes` tour 接口没有，原来兜底的 `r.notes` 被去掉了）。ops 继续显示留言；要不要改旧页面由 Annie 定。

- **Manifests 的 Money 组放开给所有 staff**（⛔ 已定，Annie 2026-10-11 再次说明「以后不要再问我了」；2026-10-11 晚查后端 main 仍挡着；Annie 2026-10-07 晚 纠正：manifest 上的价格本来就是订单信息，大家都能看，无需保密；
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
  4. ✅ **已上线（2026-10-10 核实，main-manifest-sections，`1a559df`）**：`POST /api/manifests/send-tour`、`/send-tickets`，
     按 `row_keys` 发确认 / 提醒（巴士团型弹窗手选、不预选，门票只发有 Cfm # 的，回 `checked_at` 给 Send anyway 二次确认用）。
     ops 10-11 已接上，见「`/manifests`：分节 + 勾选 + 按名单发送」小节。
  5. ✅ **已上线（2026-10-10 核实，`1880fc1`）**：`POST /api/manifests/broadcast {date, row_keys, message, send_sms, send_email}`，
     按名单发自定义消息，记进 Broadcasting Log。ops 10-11 已接上，同上。
  6. 导出：前端用列表数据生成 CSV 即可，不需要 `/api/manifests/export`。
  7. ✅ **已上线（2026-10-10 核实，`b84cf37`）**：`GET /api/manifests` 顶层新增 `sections`（仅 bus 胶囊、只有一个 section 时为
     `[]`），每行新增 `section` 字段；`/manifests` 要按 section 分组显示，全选逻辑跟着调。ops 10-11 已接上，同上。

## 注意

- HR 页按后端 2026-10-03 main 上的 `/api/hr/*` 做的；后端再改 HR 字段 / 接口时要同步前端。
- **headless 检查在 `checks/headless/`**：`cd checks/headless`、第一次 `npm install`、`node run-all.js`（约 10 分钟，只连本机模拟接口）。
  改了页面以后跑对应的套（`node run-all.js tt da`），新页面照现有的套写一个 `<名>-mock.js` + `<名>-test.js`。
