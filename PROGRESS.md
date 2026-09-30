# 前端迁移进度

> 每完成一步就更新本文件。新开窗口先读 [CLAUDE.md](CLAUDE.md)，再读本文件。

## 已完成

- `/promotion-stats`

## 进行中

> ⛔ **3 个页面等验收，已到上限（见 CLAUDE.md「未验收页面上限」），暂停开新页面。**
>
> **合并方式（Annie 2026-09-30 定）**：teams、users、dashboard 三个页面一起验收，通过后
> 直接把 `task/dashboard-page` 合进 main（它包含 teams、users 的全部提交），
> 然后把三节一起移到「已完成」，删掉 `task/teams-page`、`task/users-page`、`task/dashboard-page` 三个分支。
> ⚠️ 推 main 会自动部署到 `ops.nationalparkexpress.com`。
>
> 三个页面都在 `task/dashboard-page` 上验收，不用来回切分支。

### `/settings/teams`

- 分支：`task/teams-page`（已包含在 `task/dashboard-page` 里）
- 状态：代码已完成，等 Annie 用真实后端验收。
- 接口：列表 `GET /api/admin/teams`（不是 `/api/teams`，后者被旧接口占用）；
  新建 `POST /api/teams`；编辑 `PUT /api/teams/{id}`；删除 `DELETE /api/teams/{id}`。

**验收步骤**（数据是生产数据，只动 `ZZ Test` 开头的团队）：

1. 切到 `task/dashboard-page`，`npm install`，`npm run dev`（端口 3100）；
   `.env.local` 的 `API_PROXY_TARGET` 指向本地后端。
2. 本地启动后端（端口 8000），先打开 `http://localhost:8000/auth/login` 用 admin 账号登录。
   两边都用 `localhost`，不要一边用 `127.0.0.1`。
3. 打开 `http://localhost:3100/settings/teams`：团队列表与旧后台 `/admin/settings/teams` 一致
   （名称、颜色、描述、成员数）。
4. 点 **+ New Team**，新建 `ZZ Test Team`，选一个颜色、填描述，保存后列表里出现。
5. 再新建一个同名 `ZZ Test Team`：弹窗里显示 “A team with that name already exists”，不会建出第二个。
6. 编辑 `ZZ Test Team`，改名为 `ZZ Test Team 2`、换颜色和描述，保存后列表更新；旧后台刷新也能看到。
7. 删除 `ZZ Test Team 2`，确认后从列表消失；旧后台刷新后也没有了。
8. 用 staff（非 admin）账号登录后打开页面：显示 “Admin access required”，不显示列表。
9. 退出后端登录后刷新页面：跳到旧后台登录页，登录后回到 `/settings/teams`。

验收通过后：按「进行中」开头写的合并方式处理。

### `/settings/users`

- 分支：`task/users-page`（从 `task/teams-page` 拉出；已包含在 `task/dashboard-page` 里）。
- 状态：代码已完成，已用 headless Chrome + 模拟接口跑通 34 项检查；等 Annie 用真实后端验收。
- 顺带把 teams 页里的 `Modal`、按钮样式、`ActionResult`、错误文案、`Panel` / `ErrorBanner`
  抽到 `components/ui/`、`lib/api-errors.ts`，teams 页行为不变。
- 接口：列表 `GET /api/users` + `GET /api/admin/teams`（团队列显示名字和颜色）；
  邀请 `POST /api/users/invite`；改显示名 `PUT /api/users/{id}/display-name`；
  改组 `PUT /api/users/{id}/teams`；停用 / 恢复 `POST /api/users/{id}/deactivate|reactivate`；
  删除 `DELETE /api/users/{id}`；改角色 `POST /api/users/{id}/role`（只有 superadmin 看得到下拉框）。
- 与旧页面的差异：
  - 邀请链接用 `invite_token` 拼 `NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL/register/<token>`
    （注册页还在旧后台；后端返回的 `invite_url` 经代理时主机名是代理目标，不用）。
  - 确认框从 `window.confirm` 改成弹窗，后端报错（例如 “Cannot delete yourself”）留在弹窗里显示。
  - superadmin 账号不显示 停用 / 恢复 / 删除 按钮（后端 9/29 起一律 400）；改显示名照旧可以。
  - Joined 日期按洛杉矶时区显示（旧页面按 UTC，晚上注册的人会差一天）。

**验收步骤**（数据是生产数据；改名 / 改组 / 改角色 / 停用 / 删除只对自己新建的测试邀请账号做）：

1. 同 teams 步骤 1–2，打开 `http://localhost:3100/settings/users`：
   列表与旧后台 `/admin/settings/users` 一致（头像、角色、状态、团队、邀请人、加入日期）。
2. 点 **+ Invite Staff** → **Generate Invite Link**：显示 `http://localhost:8000/register/...`，
   点 Copy 显示 “✓ Copied”；点 Done，列表多出一行 “Pending registration…”。
3. 该行点 **Copy Link**，粘贴到无痕窗口打开，能看到旧后台注册页；
   用 `ZZ Test` 开头的用户名注册（例如 `zztest1`，姓名缩写 `ZZ`）。
4. 刷新新页面：该行变成已注册账号。依次测：**Edit Name** 改成 `ZZ Test User`；
   点团队列勾两个团队保存；（superadmin 登录时）角色下拉改成 Driver，确认框里有红字警告，
   先取消（下拉回到原值）再改成 Admin 确认，然后改回 Staff。
5. **Deactivate** → 确认，状态变 Inactive；**Reactivate**，变回 Active。
6. 再停用，然后 **Delete** → 确认，行消失；旧后台刷新也没有了。
7. 再生成一个邀请，不注册，直接 **Delete**，确认框标题是 “Delete Invite”。
8. admin（非 superadmin）登录：角色列只显示徽章，没有下拉框。staff 登录：显示 “Admin access required”。
9. 退出后端登录后刷新页面：跳到旧后台登录页。

验收通过后：按「进行中」开头写的合并方式处理。

### `/dashboard`

- 分支：`task/dashboard-page`（从 `task/users-page` 拉出，复用 `components/ui/`；
  **包含 teams、users 的全部提交**）。
- 首页 `/` 由 `next.config.ts` 的 `redirects` 307 跳转到 `/dashboard`（与旧后台 `/admin/` 一致）。
- 状态：代码已完成，已用 headless Chrome + 模拟接口跑通 52 项检查；等 Annie 用真实后端验收。
- 接口：`GET /api/me`（问候语、权限）+ `GET /api/notifications/unhandled`（Messages 三个窗口，60 秒轮询）。
- 内容与旧页面一致：问候语、4 张快捷卡（Send / Track）、Messages 区（红胶囊计数、三个窗口、
  WhatsApp 24 小时倒计时每 30 秒走、改期 / WhatsApp 左侧色条、折叠只收卡片不收栏头、
  连续两轮拉取失败显示 “Not updating …” 黄字且保留上一轮数据）。
- 与旧页面的差异：
  - 配色跟新前端其他页面走浅色，模块强调色（蓝 / 绿 / 紫 / 橙）不变。
  - 快捷卡和消息卡片的链接拼 `NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL`（发送 / 追踪页还在旧后台），
    那几页迁过来以后改成站内路径（`components/dashboard/quick-cards.tsx`、`config.ts` 的 `legacyUrl`）。
  - 页头日期按洛杉矶时区（旧页面按浏览器本地时区）。
  - 故障提示写「最后一次成功更新的时刻」（旧页面写的是这次失败的时刻）。
  - 旧页面快捷卡右上角那个空的彩色圆点和箭头（从没填过数据）没搬。

**验收步骤**（只读页面，不会写数据）：

1. 同 teams 步骤 1–2，打开 `http://localhost:3100/`：自动跳到 `/dashboard`，
   问候语是自己的显示名，页头是今天的日期。
2. 和旧后台 `/admin/dashboard` 并排对比 Messages：红胶囊总数、三个窗口各自的条数、卡片顺序、
   每张卡的姓名 / 订单号 / 团名、改期徽章、WhatsApp 倒计时、出发日、等待时长都一致。
3. 点一张消息卡片：跳到旧后台对应的 tracking 页（带 `?date=`）。点 4 张快捷卡的 Send / Track：进旧后台对应页面。
4. 点 **Collapse**：卡片收起，三个栏头和红胶囊还在，按钮变 **Show**；再点展开。
5. 开着页面 1 分钟以上：Network 里每 60 秒一次 `/api/notifications/unhandled`。
6. 停掉本地后端等 2 分钟：状态行变黄 “Not updating — last updated …”，卡片保留；重启后端后一分钟内恢复。
7. driver / guide 账号登录：显示 “Staff access required”。退出后端登录后刷新：跳到旧后台登录页。

验收通过后：按「进行中」开头写的合并方式处理。

## 待做（按顺序）

1. Send Log
2. Tickets 发送
3. Morning 发送
4. Tour 发送（等巴士团型接口）
5. Morning / Tickets / Tour 三个 tracking 页
6. Pickup Locations
7. Products
8. 其余已有接口的页面：broadcasting_log、bug_reports、ops_summary、order_log、sales_report、
   settings_hr、task_board、template_settings、orders

## 不迁移

- Manifests（等 A1）
- 3 个 Utilities 页
- coming-soon
- Test Orders（等 E1）

## 需要后端

由 Annie 转给后端窗口。

- 登录回跳：在 confirm 登录后跳回原来的 ops 页面（登录接口支持 `next`，线上 session cookie 能带到 ops 子域）。
  后端规则文档第三节记为「未定」、还没登记进后端待办清单。在这之前 teams 验收第 9 步
  「登录后回到原页面」只在本地（同为 localhost）成立。

- 巴士团型下拉接口（Tour 发送、Tour Tracking 需要）—— 后端文档写「数据来源待 Annie 定」
- ~~早班追踪窗口结束时间~~ 已完成：`GET /api/notifications/morning-pickup/tracking` 顶层字段
  `tracking_window: {end_minute, end_label}`，前端据此决定何时停止轮询，不要写死 10:30

## 注意

- 后端窗口正在修改 HR、排单、司机相关接口。做到 `settings_hr` 页时，以它改完后的接口为准，
  开工前重新看后端规则文档第五节。
