# Dashboard 改版 · 阶段一（Dashboard 外壳）前端设计 —— 待 Annie 审

- 依据：[任务包](previews/dashboard-2026-10/任务包_Dashboard改版_排班_任务_日报.md)（Annie 2026-10-11 批准）、
  可交互预览 `previews/dashboard-2026-10/任务包预览_可交互.zip`（截图 `preview_main_default.png`）。
- 分支：`task/dashboard-redesign`（从链尾 `task/manifests-v2` 的 `4059f4b` 拉出，worktree `D:\npe-ops-frontend-dashboard`）。
- 任务包要求「先交 SQL 和设计给 Annie 审，再写代码」。本仓库只有前端，SQL 由后端窗口出；这里是前端设计和要后端提供的接口。
- **Annie 审过本文件之前不写阶段一的代码。**

## 1. 现状（2026-10-11 只读核对）

| 项 | 现在的样子 |
|---|---|
| 侧栏 | `components/nav/app-frame.tsx`，**整站共用**。244px 常开，分组可折叠，照旧后台 base.html |
| 侧栏条目 | `components/nav/nav-config.ts` 写在代码里：Operations 有 Dispatch / Dispatch Imports / Work Sheet / Guide Sheet 四项分开列；Reports 有 5 项；Settings 只给 admin；Messages 链旧后台 |
| 发送卡片 | `components/dashboard/quick-cards.tsx`：4 张，**本来就没有 Dispatch** |
| Messages | 每个窗口最高 460 / 600px，能看到很多条 |
| 问候语说明 | `max-w-[540px]`，在中间折行 |
| 个人偏好存储 | 后端 `/api/user-prefs/{key}`，键名有白名单（`app/services/user_prefs.py` 的 `ALLOWED_PREF_KEYS`），现在没有快捷方式的键 |
| Dispatch 页 | **页面里没有去 `/dispatch/imports` 的入口**。侧栏去掉 Dispatch Imports 以后，导入页就找不到了 |
| Forms | 新系统里没有叫 Forms 的页面，只有 `/dispatch/work-sheet`、`/dispatch/guide-sheet` 两页 |
| Staff Schedule、Daily Operation Report | 还没有页面（分别是阶段二、阶段四） |

## 2. 阶段一做什么（前端）

### 2.1 侧栏（整站）

- 默认收起：窄条（约 56px），只有 ☰ 按钮和「NPE」，照预览。点 ☰ 展开（约 260px，把内容往右推，不盖住内容）。
  每次打开页面都是收起的；在站内换页时保持当前的开 / 收状态。
- 展开后**不折叠分组**：分组标题只是小字，下面的条目全部平铺成按钮。每个按钮：
  - 点击：进入页面（链接照旧走 `lib/page-switch.ts` 的 `pageHref` / `isSwitched`，不写死路径、不写旧后台域名）；
  - 左边有拖拽手柄：拖到 Dashboard 的 My shortcuts 区就成为快捷方式；
  - 右边有「钉住」按钮（拖拽的替代操作，触屏和键盘可用）：钉住 / 取消钉住。**任何页面上都能钉**，不只在 Dashboard。
  - 当前页蓝色高亮；Staff Schedule、Daily Operation Report 标黄色 NEW（照预览）。
  - **还没有页面的条目**（Quotation，以及做好之前的 Staff Schedule / Daily Operation Report）：和其他条目**完全一样**能点、能拖、能钉，
    名字后面标灰色描边的 SOON 小标签（不用蓝色、不像按钮）。点了（侧栏或快捷方式）进一个统一的占位页：深色、页面名 + 「Coming soon」一句，
    网址就是这一页将来的网址（如 `/quotation`）。页面做好后直接替换占位页，员工已经钉的快捷方式不用重钉。
- 顶部一行说明：「Click a button to open it. Drag it onto your desktop, or use the pin, to keep it as a shortcut.」
- 底部用户卡 + Sign out 保留（只在展开时显示）。
- 窄屏（< lg）：沿用现在的做法，☰ 打开浮层。
- 顶栏（页面名、搜索框样子、用户名）：预览里没画，任务包也没说要去掉，**保留不动**。

### 2.2 侧栏条目（任务包第 4 条 + 阶段一）

| 分组 | 条目 | 指向 |
|---|---|---|
| Operations | Dashboard | `/dashboard` |
| | 30 Days Forecast | `/forecast` |
| | Manifests | `/manifests` |
| | Orders | `/orders` |
| | Quotation | `/quotation`，内容 Annie 还没定（2026-10-11），先放占位页（见 §2.1「还没有页面的条目」）。放 Operations、紧跟 Orders：报价和订单是同一类工作，**待 Annie 确认分组** |
| | Dispatch | `/dispatch`（`/dispatch/manifest`、`/dispatch/imports` 都算在这一项下高亮） |
| | Forms | 见 §4 决定 ② |
| | Staff Schedule | `/schedule`；阶段二之前是占位页（见 §2.1，§4 决定 ③） |
| | Daily Operation Report | `/daily-report`；阶段四之前同上 |
| Notifications | Morning Pickup / Tour Confirmation / Ticket Reminder | 不变 |
| Activities | Order Log / Send Log / Broadcast Log | 不变 |
| Reports | Sales Report / Operations Summary / Promotion Stats / Bug Reports / Task Board | 「按新系统现有报表页列出」：现在 Reports 组下就是这 5 页，照列（预览只画了前 3 个） |
| Settings（只 admin） | 不变 | 任务包没提，去掉会让 admin 进不了设置页，**保留** |
| Messages（旧后台） | 不变 | 同上，**保留** |

拿掉的条目：Dispatch Imports、Work Sheet、Guide Sheet（页面本身都还在，网址不变）。

### 2.3 Dashboard 页面

区块顺序：问候 → 发送卡片 → My shortcuts → Today's tasks（占位）→ Messages → Daily Operation Report（占位）。

- **问候**：说明文字去掉 540px 宽度限制，1280px 宽下排成一行不折行（更窄的屏幕允许折行，否则手机上会横向溢出）。
  预览里日期旁边的「RES & OPS TEAM DESKTOP」小标签：`/api/me` 现在不带团队，**阶段一不做**（Team 模块之后再加）。
- **发送卡片**：Morning Pickup / Bus Tour Confirmation / Ticket Reminder / Broadcast 四张，照预览缩小一档：
  内边距 22→14px，图标 52→34px、和标题放同一行，按钮高 40→34px，去掉右上角圆点和箭头。仍是一行四张。不放 Dispatch。
- **My shortcuts**：虚线框。
  - 标题右边同一行写用法说明（Annie 2026-10-11）：「Drag a page here from the ☰ menu, or click its pin · drag tiles to reorder · × to remove」，
    不换行（1280px 宽实测放得下；更窄时末尾省略，不折行）；「Reset to default」放在这一行最右边。
  - 从侧栏拖进来；框内拖动排序；每块有 × 移除；右上角「Reset to default」恢复默认。
  - 空的时候显示「No shortcuts yet — drag any module from the menu on the left and drop it here.」
  - 每块点了进对应页面（同样走 `PageLink`）。
  - 每次改动立刻存服务端（D9）；保存失败时块的顺序退回改动前，并在框里显示错误，可以重试。
  - 默认值（初始只有 Dispatch）从服务端读，见 §3。
- **Today's tasks**、**Daily Operation Report**：只放带标题的空框，写「Coming in a later phase」，阶段三 / 四接上。
- **Messages**：每个窗口只露出 2 张卡片的高度（按前两张卡片的实际高度算，因为卡片高度不固定），其余在窗口内滚动。
  其他行为（Multi Orders 窗口、红胶囊、Reply / Assign 等）一律不变。
  标题下加一行预览里的说明：「Each window shows two messages — scroll inside a window for the rest. Click a message to reply on its tracking page.」

### 2.4 可配置项（全局原则「除格式外什么都不写死」）

| 可配置项 | 存哪 | 在哪改 | 谁能改 |
|---|---|---|---|
| 侧栏条目的名称、分组、顺序、是否显示 | 后端新表（见 §3 接口 A） | 新页面 Settings → Navigation（本仓库做） | superadmin |
| 默认快捷方式（初始 Dispatch） | 同上 | 同上 | superadmin |
| 每人的快捷方式 | `user_prefs` 新键 `dashboard_shortcuts` | Dashboard 上拖 / 钉 / 移除 / 排序 | 本人 |
| 页面上给员工看的说明文字（问候说明、侧栏说明、Shortcuts / Messages 说明、空状态） | 按 Content Studio 的做法存后端（见 §3 接口 C） | Settings → Content Studio | 按 Content Studio 现有权限 |

**代码里固定的只有**：每个条目对应的页面路径和内部 id（这是路由，不是业务值；新加一个页面本来就要改代码）、
颜色 / 字号 / 版式。条目的 id 列表由前端提供给配置页选择，后端只存 id。

后端接口没好之前，前端用一份**和种子数据完全一样**的内置默认值显示（接口 404 / 报错时回落），
页面能看、能测；**但不算阶段一完成**——要等接口接上、配置页能改且改完立即生效才算。

## 3. 需要后端（请 Annie 转给后端窗口；只新增，不改现有表 / 接口）

| # | 接口 | 用途 | 权限 |
|---|---|---|---|
| A1 | `GET /api/nav-config` → `{groups: [{label, items: [{id, label, visible}]}], default_shortcuts: [id, ...]}` | 侧栏和默认快捷方式 | staff 可读 |
| A2 | `PUT /api/admin/nav-config`（同上形状） | Settings → Navigation 保存 | superadmin（按任务包要求挂在一个可配置的权限项上，如 `nav.edit`） |
| A3 | 种子数据：§2.2 的分组 / 条目 / 顺序；`default_shortcuts = ["dispatch"]` | | |
| B | `ALLOWED_PREF_KEYS` 加 `dashboard_shortcuts`（值是条目 id 的 JSON 数组；没存过 = 用 `default_shortcuts`） | 每人快捷方式，跟账号走（D9） | 本人 |
| C | Content Studio 里加一组「Dashboard / 侧栏说明文字」的文案键，或者告诉我现有哪种做法可以直接用 | 说明文字可改 | 同 Content Studio |

条目 id（前端定，后端只当字符串存）：`dashboard, forecast, manifests, orders, quotation, dispatch, forms, schedule, daily_report,
morning, tour, tickets, order_log, send_log, broadcast_log, sales_report, ops_summary, promotion_stats, bug_reports,
task_board`。Settings 组和 Messages 不进配置（Settings 只按 admin 显示，照旧）。

## 4. 需要 Annie 定的事（每条附我的建议）

1. **Dispatch Imports 合进 Dispatch 以后从哪进？** Dispatch 页现在没有去导入页的入口，侧栏一拿掉就找不到了。
   建议：在 Dispatch 页顶部加一个「Imports →」按钮（只加入口，不改导入页本身）。不加的话，就先保留侧栏里的 Dispatch Imports。
2. **Forms 点进去去哪？** Work Sheet 和 Guide Sheet 是两页。
   建议：新做一个很简单的 `/forms` 页，深色，两个大按钮 Work Sheet / Guide Sheet；两页本身不动。
   （另一种：Forms 直接进 Work Sheet，Work Sheet 页上加一个去 Guide Sheet 的切换——要改那两页，范围更大。）
3. **Staff Schedule、Daily Operation Report 在页面做好之前**：（2026-10-11 改，跟 Quotation 统一）建议侧栏照常列出、标 SOON，
   能点、能拖、能钉，点了进占位页「Coming soon」（见 §2.1）。原来的建议是「不能点、不能钉」，但 Annie 要 Quotation 能拖，三项统一做法更简单
   （任务包 Stop Conditions 有「缺侧栏条目对应的页面」一条，这几页本来就是后面阶段要做 / Annie 回头定的，所以不当成阻塞）。
4. **侧栏收起是整站的**：侧栏是所有页面共用的，按任务包「默认收起」做，其他页面也会变成默认收起。
   建议就这样做（只在 Dashboard 收起的话，换页时侧栏一会儿开一会儿收，更乱）。

## 4b. Annie 看预览后的改动（2026-10-11）

- **任务框太长，把 Messages 压到下面去了**（阶段三，阶段一只放占位，占位按这个高度留）：
  - 进度「3 of 12 done」从右上角挪到标题旁边，用和标题同大小的粗体**普通文字**，前面用「·」隔开。
    **没全部完成时用红字**（和超时任务同一个红色 `#fca5a5`），**全部完成后变白字**；主管视角每个岗位的「n of n done」同样处理。
    **不做成胶囊、不用蓝色**（Annie 2026-10-11：蓝色按钮全站只留给提交类按钮 Send / Save / Upload 等，计数不能像按钮）。
  - 任务两列一排，框里只露出 4 行，其余在框内滚动（同 Messages 窗口）。主管视角按岗位分组的列表同样两列，整块只露 4 行左右。
  - 卡片压缩：标题一行（太长省略，悬停看全文），第二行放优先级 / 截止时间 / 标签，Pass over 靠右、变小。
  - 超时提醒条、「Passed over to you」待接收项仍在列表上方，不算在 4 行里。
  - 预览改版：scratchpad 里的 `Main_tasks-v2.dc.html`（原型，不进仓库）。

## 5. 提前报告：后面阶段已经碰到的 Stop Conditions

只读看了后端代码（`app/auth.py`），后面阶段动手前需要 Annie 先定：

- **没有「主管」角色**：后端角色只有 `superadmin > admin > staff`（另有司机 / 导游）。任务包规定「没有就停下报告，不要自行新增角色」。
- **权限是按角色判断的**（`require_staff` / `require_admin` / `require_superadmin`），没有「权限项」（如 `schedule.edit`）的机制。
  任务包要求每个看 / 改的检查都挂在可配置的权限项上，这需要后端新做一层，属于 Stop Condition「现有权限模型做不到按权限项检查」。
  阶段一只有「superadmin 改侧栏配置」一处权限，影响小；阶段二～四影响很大。
- 定时任务：后端已经有 APScheduler（`main.py`，洛杉矶时区，已有每 5 分钟一次的任务），按时提醒应该能做，具体由后端窗口报告。

## 6. 和另一个前端窗口（e6）的协调

- 改侧栏要动 `components/nav/app-frame.tsx`、`nav-config.ts`，这是整站共用的，不在 e6 让出的 dashboard 文件范围里。
  动手前用 SendMessage 先告诉 e6。
- 预计不改 `components/ui/page-link.tsx`、`broadcast-dialog.tsx`；要改的话也先告诉 e6。
- 决定 ① 选「加按钮」的话要动 `components/dispatch/`，同样先告诉 e6。

## 7. 验证计划（写代码以后）

- `npm run lint`、`npx tsc --noEmit`、`npm run build`。
- headless Chrome（端口 3198，跑之前先问 e6）+ 模拟接口，新加 `dr` 套，至少检查：侧栏默认收起、展开后没有折叠、条目和合并关系；
  拖拽 / 钉住加快捷方式、排序、移除、恢复默认、保存请求体、保存失败回退；换一个浏览器配置（新 profile）读回同一份快捷方式；
  发送卡片没有 Dispatch；Messages 每窗口露 2 张、可滚动；1280px 宽问候说明不折行；所有链接走 page-switch（切换前 / 切换后两种清单）。
- 现有 `mt` 套重跑，确认 dashboard 原有检查不退步。
