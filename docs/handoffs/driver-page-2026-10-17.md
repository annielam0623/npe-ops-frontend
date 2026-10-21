# 司机页交接文档（给后端窗口）

> 2026-10-17 夜，ops 前端 D 窗口（`D&G-npe-ops-frontend-5f`）写，经主窗口 31 转后端主窗口 38。
> 本文只是文档：ops 仓库没有写任何功能代码；司机页是后端渲染的，实际改动都在后端仓库。
> Annie 2026-10-17 夜已对 v12 preview 说「动手」，31 把交接这一步算在里面；后端窗口开工前，按各自仓库规矩再确认。

## 0. 范围

**在范围内**
1. relay 司机页：顶部两个标签 **Routes** + **Messages**。
2. tour（bus tour）司机页：同一套视觉，按接客地点 / 时间分块。
3. Messages 面板：司机收客人短信、发快捷回复；员工在后台也看得到这些对话。

**不在范围内（明确）**
- 导游页（`/guide`、G38、G75）：**司机做完再说**，Annie 原话「做完司机再说导游，不要再问了」。
- ops 前端 Settings「快捷回复」管理页：等后端接口出来后 ops 再做，不属于本文。
- 下车点的真实值：Annie 晚点补，本文只要求占位（见 3.9）。

## 1. 现状（后端只读核对，行号以 `main` 当时为准）

- 路由：`app/routers/field.py`
  - `GET /driver`：`driver_home`（约 L65），按洛杉矶时间取「今天」，`?date=` 只认 `relay_pull.open_day()` 认的日子。
  - `POST /driver/api/boarding`（约 L148）：团车 Boarded / No show，权限在 `tour_manifest.mark_boarding()`（`app/services/tour_manifest.py` 约 L1786）。
  - `POST /driver/api/relay-status`（约 L173）：relay 的 Picked up / No show，权限在 `relay_pull.mark_relay()`（`app/services/relay_pull.py` 约 L289，账号 → `hr_profiles.user_id` → 当天 `dispatch_assignment.driver_hr_id`）。
  - `GET /guide`（约 L204）：导游页，本文不动。
- 模板：`app/templates/field/driver_home.html`（段落循环渲染，不写死几段）；风格基底 `field/base.html`（`--bg:#06101c`、`--panel:#0b1724` 等）。
- 数据：
  - 站点：`driver_day.stops_for_assignment()`（`app/services/driver_day.py` 约 L152，来自 `dispatch_stop` + `pickup_locations`，顺序 `sort_order`）。
  - relay 名单：`relay_pull.guests_for_relay_car()`（约 L329），目前**平铺**，含 `pickup_time`、`pickup_location`、`relay_status`、`order_number`、`phone`、`pax`。
  - tour 名单：`tour_manifest.guests_for_assignment()`（约 L1724），已分节（bus tour / shuttle outbound / inbound），含 `lunch`、`lunch_text`、`boarding`、`relay_status`、`pickup_*`。表 `tour_manifest_guest`（`migrations/migrate_v67.sql` L89 起；`boarding_at` L115）、relay 状态列 `migrate_v71.sql`。
  - 客人签到：`checkin_log`（`app/routers/tracking.py` 约 L351 查、L703 写；`_already_checked_in()` 约 L334，按 `order_number` + 洛杉矶 00:00–16:00 去重）。
  - 客人入站短信：`POST /webhook/twilio/inbound`（`app/routers/webhook.py` L1175），按手机号经 `multi_orders.resolve_inbound()` 找到订单，写 `booking_notes`（`direction='sms_in'`，约 L1285 / L1348，带订单号、渠道、时间）。
  - 员工发短信选渠道：`reply_channel.pick_send_channel()`（`app/services/reply_channel.py` 约 L223），`app/routers/booking_notes.py` 约 L610、L920 在用。
- 司机 / 导游角色**刻意不在 `ALL_ROLES`**（`app/auth.py` L55–L82），所以新增的任何司机路由都只能用 `require_driver`（约 L419），不要扩大后台权限。

## 2. Annie 的话（按主题；「明确」= 她亲口答的；「推测」= D 窗口的理解，不是她的决定）

### 2.1 总方向（明确）
- 看了 9/15 旧样稿截图后：「是的，我比较喜欢这个方式，按照时间线和接站点来」。
- 「可以。这个是给 relay 司机的」（认可 relay 页 v8 的样子）。
- 「如果 tour 司机也是按这个思路走，设计一个」→ 我们出了 tour 页；之后她答「2 对，shuttle 可以」（认可 tour 页设计含 shuttle）。
- 「先把司机页定下来，导游页就很简单了」「做完司机再说导游，不要再问了」。

### 2.2 配色与块（明确）
- 「把两个相邻的酒店被背景色设得不一样就好了」→「是整个酒店板块的背景色」。
- 「第一家就用深绿色，是整个从酒店名字一直到 call text onboard 和 no show 那里，整个 section 都是深绿色，然后第二家酒店就是原来的深蓝，然后下一家又深绿」。
- 「你这个绿太偏黄了，做个色板让我挑」→ 她发截图问能否用图里的深绿，D 窗口取色 `#081920`；后来她答「1. 对」（认可深绿 + 交替）。
- 「我对你的深蓝相当不满意，你要用现在 website 的那个背景蓝」→ 改用 ops 站点背景蓝 `#06101c`（`app/globals.css --background`）→「这次颜色对了，把酒店的名字也标黄吧」。
- 「guest 的 text 白底黑字」。

### 2.3 版面细节（明确）
- 「Run → Routes」（顶部标签改名；Messages 不变）。
- 「客人的订单号不要加胶囊」。
- 「check-in 放到右边空白的地方，做两行」；看过 v9 后：「checked in 它分得对」。
- 「start 键没意义，已经被它拿掉了」。
- 「No location on sheet 这种情况不会出现，因为缺了的话根本就发不出来」。
- 「5. 是的」：Messages 收件箱只放自己车上的客人。

### 2.4 Text 与 Messages（明确）
- 「给司机一个接收 text 的界面吧」。
- 「员工可以看到这些对话。都用（relay、tour 司机都用）。就先用这 3 句。只用快捷回复，我们可以在后台不断添加 template」。3 句：`2 minutes away` / `Stay where you are` / `I can't find you, call me`。
- 「text 键要保留，有消息就放红点，然后上面有白底黑字框不变，点击 text 键就进入 message 的界面」。
- 「点击 text 可以主动发设定的 template 给客人，message 那里是收件箱，但是不管是发还是收都在 message 的那个面板上」。
- 「6 对，不需要客人名字或者问好之类的，就是直接明了」（模板：无占位符，admin 才能改，每条 ≤80 字——「admin / ≤80」这两点是 D 窗口提的，她答「对」）。

### 2.5 shuttle（明确）
- 「shuttle 的下车点我晚一点加，你先编个地方占位」「shuttle 产品本来的名字就是起始点」（如 `LAS to Page`）。

### 2.6 后一轮 Annie 回答（明确；经主窗口 31 转述，**不再有待定项**）
- 摘要卡：「摘要卡可以留」→ **保留**。
- Next stop 横条：「横条拿掉」→ **拿掉**。
- 进度行：她先反问「是什么」，31 解释后她答「C 进度行要，认可」，又说「司机页我不是答复过了么，要进度，不要做」→ relay 页和 tour 页的进度行都**要**；「不要做」指的是摘要卡里「relay 车 → 若干 tour 车」的车号关联**不做**，摘要卡里**只显示本车车号**。
- 去掉按客人状态的整行染色：「同意去掉染色，对」→ **同意**（只留按钮高亮）。
- 红点：「司机点击了就算已读」，31 转述的「打开对话即已读 对」与之一致 → 点开对话即已读。

## 3. 定稿视觉规格（以 preview 为准，v12）

Preview（均为 claude.ai artifact，私有，需 Annie 授权才能打开）：
- relay 司机页 v12（可点：Text 红点 → 对话；Messages 标签）：https://claude.ai/artifact/5e8rJyv4zHjxhU7rqN56RZ
- tour 司机页 v2：https://claude.ai/artifact/KpwetKuSnSknvxJHWWCS4d
- Messages 面板（早期版，以 relay 页 v12 里可点的面板为准）：https://claude.ai/artifact/FWdfUWt8vhm1PbNpFyYnwc
- 司机页现状截图版（对照用）：https://claude.ai/artifact/8ZUGif3untYoZ49QYqTQpV

规格：
1. **配色**：第一块 `#081920`（深绿）、第二块 `#06101c`（网站背景蓝）、第三块起交替；整块（酒店名行到按钮行）同一底色；块边框细线；**酒店名黄色**（amber，与接客时间同色）。
2. **标签**：顶部两个标签 `Routes`（原 Run）和 `Messages`（带红色未读数）。
3. **站点块**：左上黄色接客时间 + 黄色酒店名 + 接客点说明（灰小字）；右上 pax 数 + 「N bookings」；块内每位客人一行。
4. **客人行**：姓名 + `N pax` 小标；下一行订单号（**普通灰字，不加胶囊**）；右侧空白处 **Checked in 两行**：第一行小字 `Checked in`、第二行时间；没签到：`Not checked in` / `–`。
5. **按钮行**：`Call` · `Text` · `Picked up`（tour 页是 `Boarded`）· `No show`；Text 键有新消息时右上角**红点**。
6. **客人短信框**：客人最新一条显示在客人行内，**白底黑字**，前缀小标 `GUEST`（不变）。
7. **点 Text** 进入 Messages 面板（该客人的对话）；顶部 `Messages` 标签是收件箱（只放这位司机自己这趟车上的客人，新消息在上、未读有红条/红点），点进去是**同一个面板**；面板左上 `‹` 返回收件箱。
8. **面板内**：客人的话白底黑字靠左；司机发的蓝色靠右并写「sent from the company number」；底部「Tap to send」下三个蓝色大键（3 句快捷回复），点一下即发，**没有输入框**，只发模板 id。蓝键只用于提交类动作，符合 ops 约定。
9. **shuttle**：块标签 `Shuttle out` / `Shuttle in`；起点 = shuttle **产品名**（如 `LAS to Page`）；下车点 / 时间 = **占位**（虚线框，文字 `PLACEHOLDER`），**不要当成真字段**；Annie 晚点补，字段与来源届时她定。
10. **不要出现**：Start 键；`No location on sheet` 块；司机端自由输入；任何占位符模板。
11. **Bus Tour 页**：顶部摘要（人数 / 站数 / 时间 / 车字母+车号 / 导游）、午餐合计条（Turkey / Veggie / Roast Beef / No lunch）、红条「N guests were not picked up at their hotel」、按接客地点 + 时间分块、块标签 Bus tour / Shuttle out / Shuttle in、客人行带午餐文字 + `Call` + `Boarded` + `No show`。tour 页没有 Text 键的示例（preview 里没画，Annie 说 relay、tour 司机**都用** Messages——tour 页的 Text 键位置待 D 窗口补图时再对；后端先按「两种司机都有 Messages 标签」做）。
12. **Farm out 客人**：仍在 relay 页底部单独一栏、无按钮（照现状，G91）。

## 4. 后端任务包（来源：后端 fc 窗口 `npe-confirmation-service-fc` 的只读评估原文要点 + D 窗口补充；行号是 fc 的，开工前请自行复核）

> 标记：🔒=需 security-auditor；🗄️=需 db-schema-checker；⚠️=含 migration，按 CLAUDE.md 是 **Risk C**（开工前 Annie 确认，迁移 SQL 先给 Annie 过目再执行）。
> fc 声明：只读评估，没改文件；Annie 未点头前不开发。

### 4.1 先说三个数据事实（fc 核实）
- **客人入站短信存了**：`booking_notes`（`models.py:758-788`）按 `order_number` 存，带 `created_at`（timestamptz，`:788`）；入站短信 / WhatsApp 的 `direction` 都是 `sms_in`（`channel` 列区分，`webhook.py:1343-1366`），邮件是 `email_in`（`webhook.py:1584-1590`）。能按「订单号 + 时间」挂到车：`tour_manifest_guest` 有 `order_number`、`bus_label`（`relay_pull.py:131-132`），客人在哪台车由 `_guest_on_bus` 判（`tour_manifest.py:563`）。
  - ⚠️ 缺口：订单号是靠「号码 / 邮箱 → 还没出发的单」**猜**出来的（`webhook.py:1272` 短信、`:1544` 邮件，规则 `multi_orders.py:174-199`）；一个号码有 ≥2 张没出发的单时 `order_number` 存 **NULL**，只有 `from_address`（`webhook.py:1279-1294`）。NULL 那批可用 `from_address` 对 `tour_manifest_guest.phone`（`relay_pull.py:131`）兜底，但那是**新匹配逻辑**。邮件按发件邮箱匹配、不看主题。
- **check-in 有时间**：表 `checkin_log`（裸 SQL，`models.py` 没对应类），`checkin_time=NOW()`，带 `van_id`、`order_number`（`tracking.py:703-715`），每单每天一条（00:00–16:00 洛杉矶，`tracking.py:349-355`），是客人在早班 tracking 链接上点的签到（`module='morning_pickup'`）。**司机页（`field.py` / `driver_day.py`）现在没有任何读它的代码**，要新加按 `order_number` 关联的查询。
- **没有下车字段**：`tour_manifest_guest`（`migrate_v67.sql:105-124`）只有 product / pickup_time / pickup_location / special_requirements；Rezdy 近 60 天 33,672 个 item 的 payload 里**没有下车字段**（`transferReturn` 全 false 或不存在）；shuttle 706 行里 `special_requirements` 提到 drop 的只有 2 行。

### 4.2 任务包
**包 D：relay 司机页（Routes 标签）——无 migration**
- **按站分组 / 站点时间 / 每站 pax 与订单数**：计算 + 模板。`dispatch_stop` 只有 `assignment_id / location_id / sort_order`（`migrate_v52.sql:272-294`）、没有时间和人数列，所以站点时间 = 该站客人最早 `pickup_time`（已减 15 分钟，见 `relay_pull.py:125-147`），人数现算。
- **Checked in 两行**：新加一次只读查询（`checkin_log`，按 `order_number`，同 `tracking._already_checked_in()` 的 00:00–16:00 窗）。
- **摘要卡**：**保留**（Annie 明确）。人数、站数、首末时间、**本车车号**；**不做**「relay 车 → tour 车」的车号关联（Annie：不做）。（fc 备注：库里没有 relay→tour 车外键，只能现算且是一对多，所以这条不做是合适的。）
- **进度行**：保留（relay：`Picked up x / y · n no show`）；**Next stop 横条拿掉**。
- **~~No location on sheet~~**：Annie 已说该情况不出现（缺地点发不出来），**不要做**（fc 评估里的 9「短信也没写具体地点」同样作废）。

**包 C'：tour 司机页**（进度行 `On board x / y` 要；已由 31 转后端补）——计算 + 模板，无 migration：接客地点 / 时间分块（含 shuttle 标签）、午餐合计（`lunch_for` `tour_manifest.py:172`，合计 `_totals :708-717`）、顶部红条 = `relay_status == 'no_show'` 人数（`migrate_v71.sql:94-96`，导游页已用 `tour_manifest.py:1760`）、上车合计 / 每人 `boarding_at`（`_enrich :610`，列 `migrate_v67.sql:114-116`）。

**包 E：shuttle 起点 = 产品名；下车点占位**
- 起点：`tour_manifest_guest.product`（`migrate_v67.sql:105-106`，存的是**产品名不是产品代码**）已有，页面直接显示。
- 下车点 / 时间：**本批不做字段**，只留占位 UI。Annie 晚点补。fc 的倾向（供将来定）：首选「每个 shuttle 产品固定站点表（产品 → 有序站点 + 时间）」，staff 逐单填只作例外覆盖；「Rezdy 加列」最不推荐（payload 里是空的，OTA 单不会有）。依赖：站点表要按产品名或补 `product_code`；站点属于配置，放配置表，不写死；需 Annie 答「下车点是产品固定，还是每位客人不同」。可能含 migration。

**包 F：司机接收 text（Messages）——一个包，含 migration（Risk C ⚠️），整包 🔒 + 🗄️**
1. **匹配**（服务，无表）：入站短信 → 这台车的客人订单（见 4.1 缺口；`order_number` 为 NULL 的要用 `from_address` 对 `tour_manifest_guest.phone` 兜底，**新逻辑**）。
2. **司机只读自己当天那台车的对话**（新路由，`require_driver`）。验权链沿用现有模式：账号 → `hr_profiles.user_id` → 当天 `dispatch_assignment.driver_hr_id` → 客人在这台车上，当天才行，否则 400（团车 `tour_manifest.py:1796-1808`，relay `relay_pull.py:304-317`，`markable_day :246`）；relay 车的订单用 `pull_day` 算；然后才能读该 `order_number` 的 `booking_notes`。
3. **司机发快捷回复**（新路由）：只收 reply id + 订单号，不收自由文字；走 `pick_send_channel`（`reply_channel.py:223`），并写 `booking_notes` 让员工线程可见（带司机姓名，抄 `booking_notes.py:567-640`）。员工回复路由是 `require_staff`，司机 / 导游被 `ALL_ROLES` 挡在外（`auth.py:55`，`FIELD_ROLES :69`），**不能复用，必须新路由**。
4. **每司机未读标记**：新表（司机 × 订单 `last_read_at`）→ migration 🗄️。
5. **快捷回复模板表**：新表 → migration 🗄️。没有现成表可复用（`booking_notes.py:442` 的 `BROADCAST_TEMPLATES` 是写死在代码里的广播模板，不是同一回事）。建议列 `id / text(≤80) / sort_order / active / updated_by / updated_at`，迁移种 3 句；staff 增删改排序开关 **仅 admin、superadmin**，写 action log；司机路由只读 active。
6. 🔒 security-auditor 要审：越权读别车 / 别的订单、`sms_in` 的 NULL 订单号、快捷回复被拿来发任意文字、客人电话 / 邮件内容暴露。
7. 员工端：dashboard Messages 线程要能显示「司机发的」消息（带司机名）。

### 4.3 与导游页的关系（不在本批）
fc 评估里的导游相关包（A 导游页展示、B 导游标 Boarded、C 导游短信 G75、E 下车点）**不在这份范围**，Annie：「做完司机再说导游」。导游页复用的 `lunch_for`、`_totals`、`relay_status` 与本批同源，做司机页时顺手用同一批函数即可。

### 4.4 需要谁审
- 🔒 security-auditor：包 F 全部（尤其匹配、权限、快捷回复）。
- 🗄️ db-schema-checker：包 F 的未读表、模板表；包 E 若选新表。
- ⚠️ Risk C：包 F（含 migration）、包 E（若新表）——开工前 Annie 确认，迁移 SQL 先给她过目。

## 5. 提醒与风险

- `driver_home.html` 开头注释：模板只渲染，业务计算全在 service（CLAUDE.md：No business logic inside Jinja2 templates）；凌晨 3–4 点的活，「今天」一律按洛杉矶时间算（`field.py` L45）。
- 司机页读不到名单时**页面必须照样打开**（`field.py` L100–L123 的 try/rollback 模式）；Messages 读失败也不能拖垮 Routes 页。
- `GET /driver` 现在在失败 rollback 后 ORM 对象会过期（`field.py` L86–L91 的注释）：新增查询继续先取出 `user_id` 等局部变量。
- 发短信会花钱、会真发：测试只用 `ZZ Test` 开头的订单 / Annie 提供的只含她本人信息的号码。
- 与已排队的 G75（导游短信、`/guide?date=`）互不依赖，本文不动导游。

## 6. 验收

- 视觉：对 v12 relay 页 / tour 页 v2 截图逐块核对（颜色、酒店名黄、Checked in 两行、订单号无胶囊、红点、白底黑字框）。
- 行为：点 Text → 面板；点快捷回复 → 客人收到、员工线程可见并带司机名；只能给自己车上的客人发；非当天 / 他车 → 400。
- 权限：司机不能读他车客人的短信；司机不能发自由文字；非 admin 不能改模板。

— 完 —
