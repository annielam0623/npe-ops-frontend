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

## 进行中

（无）

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
