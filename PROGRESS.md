# 前端迁移进度

> 每完成一步就更新本文件。新开窗口先读 [CLAUDE.md](CLAUDE.md)，再读本文件。

## 已完成

- `/promotion-stats`

## 进行中

### `/settings/teams`

- 分支：`task/teams-page`（尚未合并到 main）
- 状态：代码已完成，等 Annie 用真实后端验收。
- 接口：列表 `GET /api/admin/teams`（不是 `/api/teams`，后者被旧接口占用）；
  新建 `POST /api/teams`；编辑 `PUT /api/teams/{id}`；删除 `DELETE /api/teams/{id}`。

**验收步骤**（数据是生产数据，只动 `ZZ Test` 开头的团队）：

1. 切到 `task/teams-page`，`npm install`，`npm run dev`（端口 3100）；
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

验收通过后：合并 `task/teams-page` 到 main，把本节移到「已完成」。

## 待做（按顺序）

1. Users（`/api/users`、`/api/me` 已就绪）
2. Dashboard
3. Send Log
4. Tickets 发送
5. Morning 发送
6. Tour 发送（等巴士团型接口）
7. Morning / Tickets / Tour 三个 tracking 页
8. Pickup Locations
9. Products
10. 其余已有接口的页面：broadcasting_log、bug_reports、ops_summary、order_log、sales_report、
    settings_hr、task_board、template_settings、orders

## 不迁移

- Manifests（等 A1）
- 3 个 Utilities 页
- coming-soon
- Test Orders（等 E1）

## 需要后端

由 Annie 转给后端窗口。

- 巴士团型下拉接口（Tour 发送页需要）—— 后端窗口正在做
- 早班追踪窗口结束时间（Morning tracking 页需要）—— 后端窗口正在做

## 注意

- 后端窗口正在修改 HR、排单、司机相关接口。做到 `settings_hr` 页时，以它改完后的接口为准，
  开工前重新看后端规则文档第五节。
