# 任务包：Dashboard 改版 + 在线排班 + 任务框 + Daily Operation Report

- 批准：Annie，2026-10-11（“就先这样吧，做出来到时候再改”）。
- 设计依据：Annie 与 Claude 2026-10-07 ~ 10-08 的讨论，以及 Claude 画布里的两张交互预览（Dashboard、Staff Schedule）。预览截图由 Annie 提供。
- 执行：Max
- 前后端分开：
  - **前端**：所有页面做在 `npe-ops-frontend`（React / Next.js，ops.nationalparkexpress.com）。
  - **后端**：仍是现有的 `npe-confirmation-service`，负责新数据表和 JSON 接口。只新增，不改现有表、现有接口和现有业务逻辑。
- **`npe-confirmation-service` 里的 Jinja2 页面（老前端）一律不动**，不在老前端加任何入口或页面。

## 全局原则：除格式外，什么都不写死（Annie 2026-10-09）

这是一个管理系统。**除了格式（版式、颜色、字号这类展示），任何业务值都不能写死在代码里**，都必须存数据库、能在页面上改。

- 本包里出现的所有具体值（时间、时限、名单、选项、收件人、提前量）都只是**初始数据**，用种子数据写进库，不是代码常量。
- 写进代码的只能是规则的**逻辑**（例如“早下班的是 Pre-closer”），规则用到的参数（时段、提前量、岗位名等）仍然要从库里读。
- 每个阶段交付时，Max 列一张“可配置项清单”：每一项存在哪张表、在哪个页面改、谁有权限改。漏掉的算未完成。

本包涉及的可配置项至少包括：

| 可配置项 | 初始值 | 谁能改 |
|---|---|---|
| 工作时段（必须有人在岗） | 2:00 AM – 9:30 PM | superadmin |
| 班次类型 | Open / Mid / Close / Off | superadmin |
| 岗位 | Opening / Opening-Assist / Pre-closer / Closer / 全队 | superadmin |
| 任务模板（标题、岗位、优先级、截止时间、时限、频率、跳转页面、启用/停用） | 见“初始任务清单 → 最新 Work Checklist” | 主管 / admin |
| 优先级选项 | High / Moderate / Low | superadmin |
| 提醒提前量（D2） | 30 分钟 | superadmin |
| 提醒邮件收件人 | reservations@nationalparkexpress.com | superadmin |
| 交接通知、日报通知的收件人（D1、D6） | 见 D1、D6 | superadmin |
| 日报类型和子类 | Complaint（Driver / Guide / Itinerary）、Accident、Emergency | superadmin |
| Accident 详情字段及是否必填（D7） | 见 D7 | superadmin |
| 日报状态选项 | Open / In progress / Resolved | superadmin |
| 侧栏条目的名称、分组、顺序 | 见阶段一 | superadmin |
| 默认快捷方式 | Dispatch | superadmin |
| 页面上给员工看的说明文字 | 预览里的文案 | 按项目现有 Content Studio 做法 |

## 设计预览（附件）

Annie 会把下面这些文件放进仓库（建议放在 `docs/previews/dashboard-2026-10/`）。做页面前先看一遍，版式、区块顺序、交互以预览为准。

| 文件 | 内容 |
|---|---|
| `01_dashboard_staff.png` | Dashboard 员工视角（Lizzie，Pre-closer，下午 3:30）：侧栏收起、发送卡片、My shortcuts、任务框（超时/即将到期、待接收的交接、右下角提醒弹窗）、本周排班、Messages（每窗 2 条）、Daily Operation Report |
| `02_dashboard_nav_open.png` | 侧栏展开：平铺按钮、拖拽手柄、钉住按钮 |
| `03_dashboard_supervisor.png` | Dashboard 主管视角：交接通知、按岗位分组的全部任务、每条任务可改截止时间、加任务（选岗位或具体某人） |
| `04_staff_schedule.png` | Staff Schedule 页：周表格、时间条、“Nobody on” 空档行、发布被禁止的提示、Day timeline（重叠和在岗人数） |
| `05_schedule_edit_cell.png` | 排班格子编辑：班次、上下班时间、备注、时间填错的提示 |
| `06_dashboard_handover_accepted_accident_form.png` | 接受交接后（显示来自谁和交接说明），以及日报选 Accident 时的详情字段 |
| `任务包预览_可交互.zip` | 可点击的预览。解压后在文件夹里运行 `python -m http.server`，浏览器打开 `Main.dc.html` 或 `Schedule.dc.html` |

注意：

- 预览只是设计参考，里面的人名、消息、任务都是示例数据，代码是原型，**不要照搬进项目**。
- 预览里把工作时段放在排班页上直接改；本包规定它是 superadmin 的系统设置（见“全局原则”的表格），以本包为准。
- 预览里的 Team 切换、身份切换、时间切换只是演示用的开关，不是要做的功能。

## Objective

在新系统里给 Res & Ops 团队做一个按班次工作的桌面：

1. Dashboard 改版：可拖拽的个人快捷方式、侧栏平铺。
2. 在线排班：主管排班；工作时段内有空档时不能发布。
3. 任务框：按排班自动把当天的固定任务分给对应的人。有截止时间提醒；没做完必须交接给下一班，下一班接受后才转移。
4. Daily Operation Report：登记投诉、事故、紧急情况，带状态和跟进人。

## Business Decisions Locked（Annie 已定，不要重新验证）

### Dashboard

1. 团队只有一个：Res & Ops。Annie 发布的窗口默认所有人都能看到。
2. 左侧导航栏**默认收起**，点击展开。展开后模块**不折叠**，全部是按钮：点击进入，拖到桌面成为快捷方式。
3. 每个人可以把需要的模块拖到桌面的 “My shortcuts” 区。
4. 导航合并：
   - Dispatch Imports 并入 Dispatch，侧栏不再单列。
   - Work Sheet 和 Guide Sheet 合并为一个入口，叫 **Forms**。
   - Complaints、Accidents、Emergency 合并为 **Daily Operation Report**。
5. Dispatch 只作为 My shortcuts 里的一项，**不放进**发送卡片那一排。
6. 发送卡片（Morning Pickup / Bus Tour Confirmation / Ticket Reminder / Broadcast）缩小一档。
7. 问候语下面的说明文字排成一整行，不在中间折行。
8. Messages 每个窗口只显示 2 条，其余在窗口内滚动。
9. Daily Operation Report 是独立一个区块，放在 Messages **下面**。

### 排班

10. 排班由**主管**做。员工名单 **admin 和主管**都可以添加。
11. 工作时段 **2:00 AM – 9:30 PM**，每天相同。这个时段内任何时刻都必须有人在岗。
12. 有空档时**禁止发布**这一周的排班，不是只警告。
13. 发布后**通知员工**，系统内提醒和邮件同时发。
14. 排班要能看出各人时间的重叠。

### 任务

15. 员工的工作不固定到人：排到哪个班就做哪个班的工作。
16. 岗位按当天排班推出来：
    - **早班**：最早到岗的是 Opening，晚到的是 Opening-Assist。
    - **closing team（夜班）**：只有一个人时，Pre-closer 和 Closer 的工作全归他；两个人时，早下班的是 Pre-closer（协助 closing），晚下班的是 Closer。
    - 没有固定清单的人（如 Anita）：只做主管指定给他的任务。
17. Pre-closer 清单里截止时间晚于 Pre-closer 下班时间的任务，**直接归 Closer**，不走每天的交接。
18. 任务基本每天固定。主管可以提前添加，也可以把一条任务**直接指定给某个人**。
19. **所有任务的完成时间和时限都可以调整**：每条任务有默认值，主管可以改；不写死在代码里。
20. 员工**只看自己的任务**（含全队任务和指定给他的任务）。
21. 下班前要完成本班任务。没完成的必须交接给下一班的人：
    - 下一班的人**只能接受，没有拒绝**；接受后自动进他的清单。
    - 交接记录（含上一个人写的说明）**保留在当天的工作清单里**。
    - 主管收到交接通知，系统内和邮件同时发。
    - 指定给个人的任务没做完，同样交接给下一班。
22. 有截止时间的任务要标出来并提醒：**弹窗 + 响声**，同时发邮件到 **reservations@nationalparkexpress.com**。
23. 职责里提到的系统功能（发提醒短信、发确认、forecast、manifest 等）都已存在，但要人工操作。任务只负责提醒和跳转，不替人执行。

### Daily Operation Report

24. 三类：Complaint（再分 Driver / Guide / Itinerary）、Accident、Emergency。
25. 每条记录有**状态**和**跟进人**。
26. 保存后**通知相关负责人**。负责人和人员架构将来在 Team 模块里设（本包不做）。
27. Accident 必须记录详情。

## 默认值（Annie 2026-10-11 已同意 D1–D9）

> 权限说明：Annie 之后会在 Team 模块里做授权，决定哪些信息开放给哪些人。所以本包里“谁能看、谁能改”（D5 和可配置项表里的“谁能改”）都只是初始值。实现时，每个“看 / 改”的检查都要挂在一个**可配置的权限项**上，例如 `schedule.edit`、`tasks.view_all`、`report.view`，不要在代码里写死“主管才能……”。Team 模块建好后只需改权限配置，不用改代码。

| # | 项目 | 提议 |
|---|---|---|
| D1 | 主管收交接通知的邮箱 | 主管自己账号上的邮箱 |
| D2 | 提醒什么时候弹 | 截止前 30 分钟一次，到点未完成再一次。提前量做成设置，superadmin 可改 |
| D3 | 有人下班时既没完成也没交接 | 下班时间一到，通知主管（系统内 + 邮件） |
| D4 | Opening 和 Opening-Assist 怎么分 Opening 清单 | 共用一张清单，两人都能看到和勾选，记录谁勾的 |
| D5 | 员工能看哪些排班 | 能看整周已发布的排班（要知道下一班是谁），只能改自己的任务状态 |
| D6 | Daily Operation Report 的通知对象（Team 模块建好前） | 主管 + reservations@ |
| D7 | Accident 详情字段 | 事故时间、地点、车号、司机、受伤情况、是否报警、经过描述 |
| D8 | 每小时更新的 7-day forecast | 清单上一条；每到整点重新变成未完成，漏掉的小时记录给主管看 |
| D9 | 快捷方式存在哪 | 存服务端，跟着账号走，换电脑不丢 |

## Scope

分四个阶段，每阶段 commit 后停下，等 Annie 验收再开下一阶段。

### 阶段一：Dashboard 外壳

- 侧栏：默认收起；展开后平铺按钮；每个按钮可点击进入，也可拖到 My shortcuts。按钮上另有一个“钉住”按钮，作为拖拽的替代操作（触屏和键盘用户需要）。
- 侧栏条目：
  - Operations：Dashboard、30 Days Forecast、Manifests、Orders、Dispatch、Forms、Staff Schedule、Daily Operation Report
  - Notifications：Morning Pickup、Tour Confirmation、Ticket Reminder
  - Activities：Order Log、Send Log、Broadcast Log
  - Reports：按新系统现有报表页列出
- My shortcuts 区：拖入、拖动排序、移除、恢复默认。默认含 Dispatch。按用户存服务端（D9）。
- 发送卡片缩小；问候语说明文字一行；Messages 每窗口 2 条、窗口内滚动。
- 区块顺序：问候 → 发送卡片 → My shortcuts → Today's tasks → Messages → Daily Operation Report。任务框和日报两个区块先放占位，后面阶段接上。

### 阶段二：在线排班（Staff Schedule 页）

- 数据：员工名单、每周排班（每人每天：班次 Open / Mid / Close / Off，或只填时间不填班次；上下班时间；备注）、周状态（草稿 / 已发布）、工作时段设置（默认 02:00–21:30，只有 superadmin 能改）。
- 页面：
  - 周表格：点格子编辑班次、时间、备注。
  - 换周；复制上一周；添加员工（admin 和主管）。
  - 下班时间不晚于上班时间的格子标黄提示。
  - Day timeline：所有人画在同一条 24 小时轴上，下方显示每个时段在岗人数和重叠，并列出空档时段。
- 发布：工作时段内有空档时，发布按钮不可用，并提示哪几天有空档。服务端也要做同样校验，不能只靠前端。
- 发布后通知这一周排班上的每个人（系统内 + 邮件）。

### 阶段三：任务框

- **任务模板**：每条有标题、岗位、优先级、默认截止时间（可空）、时限、频率（每天 / 每小时 / 每 N 天 / 有空时，N 可配置）、可选的跳转页面、启用/停用。按下方“初始任务清单 → 最新 Work Checklist”作为种子数据导入。主管或 admin 在页面上增删改模板，改动从下一次生成每日任务起生效；当天已生成的任务，截止时间也能单独改。
- **每日任务**：按当天已发布的排班和第 16 条规则，把模板生成到具体的人名下；主管加的一次性任务和指定给个人的任务一并进入。
- **员工视角**：
  - 只看自己的任务，按截止时间排序。
  - 一小时内到期标黄，超时标红；顶部汇总超时和即将到期的条数。
  - 有跳转页面的任务显示 “Open … →”。
- **主管视角**：
  - 按岗位看全部任务和完成进度；每条任务的截止时间可直接改。
  - 加任务：选岗位或具体某人，选今天 / 明天 / 每天，可填截止时间。
  - 交接通知列表。
- **交接**：未完成的任务可点 “Pass over”，填说明后发给下一班的人。
  - 下一班的人在清单顶部看到待接收项，只有 Accept。
  - 接受后进入他的清单，并显示“来自谁”和交接说明。
  - 交接记录保留在当天清单。
  - “下一班”的定义：当天排班里接在本班后面的那个班；Closer 的下一班是第二天的 Opening。
- **提醒**（D2）：弹窗 + 响声，同时发邮件到 reservations@nationalparkexpress.com。
- **主管通知**：交接发生和被接受时，系统内 + 邮件（D1）；D3 的情况同样通知。

### 阶段四：Daily Operation Report

- 表单：
  - 类型：Complaint（选 Driver / Guide / Itinerary）、Accident、Emergency。
  - 字段：订单号；司机 / 导游 / 行程名；经过描述。
  - 选 Accident 时显示 D7 的详情字段，必填项由 Max 提议。
- 列表：当天记录，可改状态（Open → In progress → Resolved）和跟进人。
- 保存后通知 D6 的对象（系统内 + 邮件）。

## 初始任务清单（模板种子数据）

### 最新 Work Checklist（Annie 2026-10-14 提供，以此为准）

**Annie 2026-10-14 定：下表内容原样作为种子数据直接导入，不另做调整；上线后由主管或 admin 在任务模板页面上修改。**
原表三列照录（Time / Things To Do / Duty），任务文字、时间、岗位都照表写进库。

| 时间 | 任务 | 岗位 |
|---|---|---|
| 6:00 AM | Next 3 days confirmation | Morning Assist |
| 7:00 AM | Check in next day confirmation and follow up next day No-Show guest | Morning Assist |
| 8:00 AM | Check Flixbus Booking | Morning Assist |
| 9:00 – 10:00 AM | Hoover Dam Dispatch | Dispatch / Morning Assist |
| 11:00 AM | Check Shuttle and remind Tour Guide for Shuttle Pickup | Morning Assist / Pre Close |
| 12:00 – 1:00 PM | South Lunch | Pre Close |
| 1:00 – 2:00 PM | Antelope Lunch putting on Excel | Pre Close |
| 1:00 – 2:00 PM | Send Last mins Confirmation | Pre Close |
| 3:00 – 4:00 PM | CCL - Bus Assignments on 7 Days | Pre Close / Closer |
| 3:00 – 4:00 PM | Check which tour need to be capped | Closer |
| 3:00 – 4:00 PM | Manifest | Closer |
| 3:00 – 4:00 PM | BZ Lunch | Pre Close |
| 4:00 – 5:00 PM | Driver manifests SCREENSHOTS | Pre Close / Closer |
| 5:00 – 6:00 PM | Call and Text Antelope Lunch | Pre Close / Closer |
| 5:00 – 8:00 PM | Print Shuttle Manifest | Pre Close / Closer |
| 5:00 – 8:00 PM | West Lunch | Pre Close / Closer |
| 5:00 – 8:00 PM | Email Guest Bus Letter | Pre Close / Closer |
| 5:00 – 8:00 PM | West & South Bus Tour Helicopter (Papillon) | Pre Close / Closer |
| 5:00 – 8:00 PM | Check Flixbus Booking | Pre Close / Closer |
| 5:00 – 8:00 PM | Prepare South Tour Book（原表写 Preper） | Pre Close / Closer |
| 9:00 PM | Re-do Relay Split | Closer |
| 9:00 PM | Checking last mins and make sure they all on Manifest | Closer |
| 9:00 PM | Scan Manifest | Closer |

导入时只需注意：

- 表里的岗位名（Morning Assist / Pre Close / Closer / Dispatch）照写进岗位种子数据，没有的就加上。
- 两个岗位都写的（如「Pre Close / Closer」）照本包第 16、17 条分：一个人 closing 时全归他；两个人时按截止时间是否晚于 Pre-closer 下班。
- 时段（如 5–8 PM）存为「开始–截止」；只写一个时间的，截止就是该时间。

### 旧清单（2026-10-11，不导入，仅供参考）

来源：Annie 提供的 Nightly Checklist（含红笔修改）和 Opening / Pre-closer / Closing 职责表。时间都是默认值，主管可改。

标 \* 的归属是 Claude 按职责表推断的。（原定 10-11 按此导入，已由 2026-10-14 的新表取代。）

#### Opening（13 条，原表无截止时间）

1. Print out all manifests →Manifests
2. Send reminder texts to guests →Morning Pickup
3. Check last-minute add-ons for all tours and update the Excel sheets
4. Review Reservation folder emails; quick scan in OPS3 for same-day updates
5. File emails into the appropriate folders
6. Dispatch for relays →Dispatch
7. Verify final counts for all tours
8. Send out the final count for Antelope
9. Record no-shows
10. Send final counts for all lunches
11. Scan Go City passes
12. Send out CUA tickets for West and Hoover
13. Send next-day confirmations for all tours →Tour Confirmation

#### Pre-closer

| 任务 | 优先级 | 默认截止 |
|---|---|---|
| Update the 7-day forecast →30 Days Forecast | High | 每小时 |
| Email Grand Canyon South the lunch count \* | High | 1:00 PM |
| Send BZ lunches \* | High | 4:00 PM |
| Text Last Stop lunch group chat the lunch order for tomorrow \* | High | 4:00 PM |
| Check that Antelope lunches have been sent out | High | 5:00 PM |
| Enter Antelope lunches into Excel | High | — |
| Monitor emails and Google Voice messages | High | 全班 |
| Check last-minute changes for tomorrow and notify the closer | High | 全班 |

#### Closer

| 任务 | 优先级 | 默认截止 |
|---|---|---|
| Make sure all confirmations are done for tomorrow →Tour Confirmation | High | — |
| Make sure all manifests are entered into Excel | High | — |
| Start splitting vehicles for tomorrow (West, South, Antelope) \* →Dispatch | High | 6:00 PM |
| Send manifest screenshots to drivers and relay team →Manifests | High | 6:00 PM |
| After splitting, BCC bus info to early-tour and West guests \* | High | 7:00 PM |
| Email Papillon the Excel for tomorrow | High | 7:00 PM |
| Print QR codes, Antelope and shuttle manifests; label and leave on opener's desk →Manifests | High | 8:00 PM |
| Purchase West tickets and split into folders | High | 8:00 PM |
| Scan manifests to the reservations email | High | 8:00 PM |
| Handle relay splits →Dispatch | High | — |
| Print manifests and relays, expanded and legible →Manifests | High | — |
| Handle all last-minute add-ons | High | 至 9:00 PM |
| Email scanned manifests to Tessa, CCL and Rickie | High | 9:30 PM |
| Clear inbox, texts, voicemails and Google Voice | High | 9:30 PM |
| Make sure all Strip vendor texts are answered and slips saved \* | Moderate | 9:30 PM |
| Check availability — do we need another bus for the coming days? \* →30 Days Forecast | High | 全班 |
| Do competitor analysis and submit to Hiromi and Tessa \* | High | — |
| Check Go City passes for the next 3 days; cancel invalid ones \* | Low | 有空时 |
| Do Rezdys \* | Low | 空闲时 |

#### 全队

- Check receipts and file into driver/guide boxes by card number（Low，每 3 天）

#### 已从原表删掉（Annie 红笔划掉或标 no）

- Text Brenda group chat updated count
- Text John Snider / Presley updated count
- Make two copies of Antelope pages

## Out of Scope

- 老前端（`npe-confirmation-service` 的 Jinja2 模板和页面路由）：不改、不加入口。
- 后端现有的表、接口和业务逻辑：不改，只新增。
- Team 模块：人员架构、联系人名单、各类报告的负责人设置。
- Forms、Dispatch 页面本身的合并改造。本包只改导航入口；如果新系统里这些页面还不存在，入口先指向现有页面，并报告给 Annie。
- “系统里操作完自动打勾”。第一版只做提醒和跳转。
- 短信通知。本包的通知只有系统内提醒和邮件。

## Upstream Dependencies（动手前先读实际代码确认）

- `npe-ops-frontend`：现有布局、侧栏、登录和权限的做法，以及 Dashboard 是否已存在。
- `npe-confirmation-service`：
  - 用户和角色：有没有“主管”角色。没有就停下报告，不要自行新增角色。
  - 现有 teams 表。
  - `/api/notifications/unhandled`（Messages 窗口的数据源）。
  - 邮件发送走现有 `EMAIL_PROVIDER`（Postmark），不要另接邮件服务。
- 现有的定时任务机制：提醒和整点任务需要按时触发，先报告现有机制再设计。
- 项目规矩：DATE 列传 `date` 对象；枚举用 `native_enum=False`；迁移用守卫子句、不可重复执行；时间按洛杉矶时区显示。

## Downstream Impact

- 新增的都是新表、新接口、新页面。交付时确认没有改动任何现有表结构和现有接口的返回格式，并报告。
- 邮件量：提醒、交接、发布、日报都会发邮件到 reservations@ 和个人邮箱。交付时估算每天大约多少封，报告给 Annie。

## Acceptance Criteria

### 阶段一

1. 侧栏默认收起；展开后没有折叠分组；条目和合并关系符合第 4 条。
2. 拖拽和钉住都能加快捷方式；能排序、移除、恢复默认；换浏览器登录同一账号，快捷方式还在。
3. 发送卡片里没有 Dispatch；Messages 每窗口显示 2 条，其余可在窗口内滚动；问候语说明文字在 1280px 宽度下不折行。

### 阶段二

4. 用 Annie 提供的 10/4–10/10 排班表做测试数据：周一会因 Jing 的时间（11:30 PM – 9:30 PM）报空档 5:00 PM – 9:30 PM，发布被禁止；把 Jing 周一改成 11:30 AM 后，空档消失，可以发布。
5. 绕过前端直接调发布接口，有空档时同样被拒，并返回哪几天、哪些时段。
6. 发布后，这一周排班上的每个人都收到系统内提醒和邮件。
7. Day timeline 上，10/7 显示重叠 Veronica + Lizzie 9:30–10:00 AM、Lizzie + Nadia 1:30–5:30 PM，没有空档。

### 阶段三

8. 用 10/7 的排班：Veronica = Opening；Lizzie = Pre-closer；Nadia = Closer。Pre-closer 截止时间在 5:30 PM 之后的任务出现在 Nadia 名下。
9. 一个人单独 closing 的日子，Pre-closer 和 Closer 的任务都在他名下。
10. 员工登录只看到自己的任务；主管看到全部。
11. 交接：A 发出后，任务仍在 A 名下并显示“等待接受”；B 只有 Accept 按钮；接受后任务在 B 名下，显示来自 A 和 A 的说明；当天清单里交接记录完整；主管收到两次通知（发出、接受）。
12. 主管改了某条任务的截止时间，员工那边的排序和提醒按新时间走。
13. 提醒在 D2 定的时间弹出并响声；同一时刻 reservations@ 收到邮件，邮件写明任务、负责人、截止时间。
14. 邮件发送失败时，系统内记录失败原因（写明是哪封、发给谁、为什么失败），不影响任务本身的状态。

### 阶段四

15. 三类都能保存；Accident 缺必填详情时不能保存，并写明缺哪一项。
16. 状态和跟进人可改，有修改记录。
17. 保存后 D6 的对象收到通知。

### 每个阶段都要满足

18. 代码里没有写死的业务值：交付时附“可配置项清单”，Annie 抽查任意一项，都能在页面上改，改完立即生效。

## Required Checks

- 四道门：code-reviewer → security-auditor → db-schema-checker → deploy-guard。
- 全库检查受影响的页面和路由，结果报告给 Annie，不自行裁定。
- 先交 SQL 和设计给 Annie 审，再写代码。每个阶段都一样。

## Risk Level

- 迁移文件编写：B。生产库执行：C（Annie 在 TablePlus 整文件执行）。
- 阶段一：B。
- 阶段二到四：B。这几个阶段有对外发邮件，不自动 push。

## Stop Conditions

- 没有“主管”角色，或现有权限模型做不到“按权限项检查”，需要改现有权限模型。
- 需要改后端现有表结构、现有接口返回格式或现有业务逻辑，或需要动老前端（Jinja2 页面）。
- 新系统缺少某个侧栏条目对应的页面。
- 现有定时任务机制做不到按时提醒。
- 排班里出现规则覆盖不到的情况（例如早班三个人、closing 三个人）。
- 某个业务值找不到合适的地方做成可配置，打算写进代码。
- 任何需要新的业务决定的情况。

## Delivery Rule

- 每阶段 commit 后停下，等 Annie 说 push。上一阶段验收后才开下一阶段。
- 需要新增环境变量时，先报变量名给 Annie，由她在 Railway 添加。
