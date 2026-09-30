# npe-ops-frontend

NPE 员工后台运营系统（Operation System）的前端仓库。

本仓库用于把员工后台从 **Jinja2 服务端渲染** 迁移到 **React**。现有的 Python FastAPI
后端（部署在 Railway，使用 session / cookie 认证）**保持不变**，本仓库只通过 HTTP
调用它的接口。

> 当前阶段：已迁移 `/promotion-stats`、`/settings/teams`、`/settings/users`、`/dashboard`、`/send-log`、`/tickets-reminder/send`、`/morning-pickup/send` 七个业务页面，**前端尚未实现登录认证**
> （本地登录方式见下文「本地登录」）。状态管理库和 UI 组件库都尚未引入，会在后续阶段再确定。

## 技术栈

- [Next.js 15.5](https://nextjs.org/)（App Router + Turbopack）
- TypeScript（strict 模式）
- [Tailwind CSS v4](https://tailwindcss.com/)（通过 `@tailwindcss/postcss`，v4 不需要 `tailwind.config`）
- ESLint 9 + `eslint-config-next`
- Prettier 3 + `prettier-plugin-tailwindcss`
- 包管理器：npm（提交 `package-lock.json`）

## 环境要求

- Node.js：见 [`.nvmrc`](./.nvmrc)（Node 22）。使用 nvm 时可执行 `nvm use`。
- npm：随 Node 一起安装即可。

## 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量：复制示例文件并按需修改
cp .env.example .env.local

# 3. 启动开发服务器（端口 3100）
npm run dev
```

打开 http://localhost:3100 即可访问。

> 端口有意避开 3000，固定使用 **3100**（`dev` 和 `start` 均如此）。

## 可用脚本

| 脚本                   | 说明                                   |
| ---------------------- | -------------------------------------- |
| `npm run dev`          | 启动开发服务器（Turbopack，端口 3100） |
| `npm run build`        | 生产构建（Turbopack）                  |
| `npm run start`        | 启动生产服务器（端口 3100）            |
| `npm run lint`         | ESLint 检查                            |
| `npm run lint:fix`     | ESLint 检查并自动修复                  |
| `npm run typecheck`    | TypeScript 类型检查（`tsc --noEmit`）  |
| `npm run format`       | Prettier 格式化写入                    |
| `npm run format:check` | Prettier 格式检查（不写入）            |

## 目录结构

```text
.
├── app/                  # App Router 入口
│   ├── layout.tsx        # 根布局，html lang="zh-CN"
│   ├── globals.css       # 全局样式，引入 Tailwind v4
│   ├── loading.tsx       # 约定的加载态
│   ├── error.tsx         # 约定的错误边界（client component）
│   ├── not-found.tsx     # 约定的 404 页面
│   ├── login/            # 登录占位页（暂未实现认证）
│   ├── dashboard/        # 首页 Dashboard（快捷入口 + 未处理消息）
│   ├── morning-pickup/send/ # 早班提醒发送
│   ├── promotion-stats/  # 推广统计页（试点业务页面）
│   ├── send-log/         # 发送记录（Send Log）
│   ├── tickets-reminder/send/ # 门票提醒发送
│   ├── settings/teams/   # 团队管理页（admin 及以上）
│   └── settings/users/   # 用户管理页（admin 及以上）
├── components/
│   ├── dashboard/        # Dashboard 的组件
│   ├── morning-send/     # 早班提醒发送的组件
│   ├── promotion-stats/  # 推广统计页的组件
│   ├── send-log/         # Send Log 的组件
│   ├── tickets-send/     # 门票提醒发送的组件
│   ├── teams/            # 团队管理页的组件
│   ├── ui/               # 共用的弹窗、按钮样式、提示条
│   └── users/            # 用户管理页的组件
├── lib/
│   ├── api-client.ts     # 调用 FastAPI 的 fetch 封装（apiFetch）
│   ├── api-proxy.ts      # /api/* 代理的后端地址（服务器端，API_PROXY_TARGET）
│   ├── auth-api.ts       # 当前用户接口（/api/me）
│   ├── dashboard-api.ts  # Dashboard 未处理消息接口
│   ├── morning-send-api.ts # 早班提醒：消息预览、上传预览、分批发送
│   ├── env.ts            # 集中读取浏览器端环境变量（NEXT_PUBLIC_*）
│   ├── promotion-stats-api.ts # 推广统计接口
│   ├── teams-api.ts      # 团队增删改查接口
│   ├── send-log-api.ts   # Send Log 列表 / 导出接口
│   ├── tickets-send-api.ts # 门票提醒：消息预览、上传查重、分批发送
│   ├── send-batches.ts   # 发送类页面的分批工具（每批 10 位）
│   ├── safe-redirect.ts  # 登录回跳地址校验（防开放重定向）
│   └── utils.ts          # 通用工具（cn、buildQueryString）
├── types/
│   ├── api.ts            # ApiError 类与请求参数类型
│   ├── auth.ts           # 当前用户类型
│   ├── dashboard.ts      # 未处理消息接口的类型
│   ├── morning-send.ts   # 早班提醒发送接口的类型
│   ├── promotion-stats.ts # 推广统计接口的返回类型
│   ├── send-log.ts       # Send Log 接口的类型
│   ├── teams.ts          # 团队接口的类型
│   ├── tickets-send.ts   # 门票提醒发送接口的类型
│   └── index.ts          # 类型统一出口
├── public/               # 静态资源（暂空）
├── .env.example          # 环境变量示例
├── eslint.config.mjs     # ESLint 9 扁平配置
├── postcss.config.mjs    # PostCSS（@tailwindcss/postcss）
└── next.config.ts        # Next.js 配置（/api/* 代理 rewrites；首页 / 307 跳转 /dashboard）
```

路径别名 `@/*` 指向仓库根目录（见 `tsconfig.json`），例如 `import { apiFetch } from "@/lib/api-client"`。

## 与后端对接

浏览器**只请求同源的 `/api/*`**，由 `next.config.ts` 的 `rewrites` 在服务器端转发到后端，
所以不需要后端配 CORS，session cookie 也按同源请求带上：

- 后端地址由服务器端环境变量 `API_PROXY_TARGET` 配置（`lib/api-proxy.ts` 读取），
  默认 `http://127.0.0.1:8000`；非法 URL 会在启动 / 构建时直接抛错；
- 它不带 `NEXT_PUBLIC_` 前缀，不会进浏览器代码；
- `rewrites` 在 `next build` 时固化，**生产环境改了 `API_PROXY_TARGET` 要重新 build**。
- 转发超时由 `experimental.proxyTimeout` 放宽到 5 分钟（默认 30 秒）。发送类页面仍按小批发送，
  不依赖这个值；线上 Cloudflare 还有约 100 秒的超时。

过渡期内部分链接会跳回旧版后台，地址由 `NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL` 配置，
留空时默认 `http://localhost:8000`。`NEXT_PUBLIC_*` 变量必须以字面量
`process.env.NEXT_PUBLIC_XXX` 读取，Next.js 才会在构建时把它内联进浏览器代码
（`process.env[name]` 在客户端永远是 undefined），集中在 `lib/env.ts` 读取。

调用接口统一使用 `lib/api-client.ts` 中的 `apiFetch<T>()`：

```ts
import { apiFetch } from "@/lib/api-client";

// GET 请求
const me = await apiFetch<{ id: number; name: string }>("/api/me");

// 带查询参数的 GET
const list = await apiFetch<Item[]>("/api/items", {
  query: { page: 1, keyword: "abc" },
});

// POST JSON
const created = await apiFetch<Item>("/api/items", {
  method: "POST",
  body: { name: "新条目" },
});
```

`apiFetch` 的行为：

- 请求同源相对路径（经上面的 `/api/*` 代理），**只能在浏览器里（客户端组件）调用**；
- 自动序列化 JSON 请求体并设置 `Content-Type`；
- **固定携带 `credentials: "include"`**，以便浏览器带上后端 session cookie；
- 非 2xx 响应统一抛出 `ApiError`（包含 `status`、`statusText`、`url`、`body`）。

### 本地登录

前端的 `/login` 目前只是占位页。本地测试需要登录态的页面时：

1. 本地启动后端（端口 8000）和前端（`npm run dev`，端口 3100）；
2. 先打开 `http://localhost:8000/auth/login` 登录后端；
3. 再打开 `http://localhost:3100/settings/teams` 等页面。

浏览器的 cookie 只认主机名、不认端口，所以 8000 上的登录态会随 3100 上的 `/api/*`
请求带过去。**两边都必须用 `localhost`**，一边 `localhost`、一边 `127.0.0.1` 会被当成两个站点，
登录态带不过来。`API_PROXY_TARGET` 是服务器端转发用的地址，不受这条限制。

⚠️ 如果本地后端的 `.env` 连的是生产库，在页面上的新建 / 编辑 / 删除都是**真实写入**。

## 页面与权限

| 页面                     | 旧后台地址                                   | 权限                                                                                                                            |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/promotion-stats`       | —                                            | staff 及以上（后端 `require_staff`）                                                                                            |
| `/settings/teams`        | `/admin/settings/teams`                      | 先调 `/api/me`，`is_admin` 为 true（admin、superadmin）才拉列表，否则显示 “Admin access required”                               |
| `/dashboard`             | `/admin/dashboard`                           | staff 及以上（`/api/me` 403 时显示 “Staff access required”）；快捷卡和消息卡片暂时链接到旧后台的发送 / 追踪页                   |
| `/send-log`              | `/admin/notifications/send-log`              | staff 及以上（接口 403 时显示 “Staff access required”）                                                                         |
| `/tickets-reminder/send` | `/admin/notifications/tickets-reminder/send` | staff 及以上；⚠️ **会真实发短信 / 邮件给客人**，测试只用 Annie 提供的文件                                                       |
| `/morning-pickup/send`   | `/admin/notifications/morning-pickup/send`   | staff 及以上；⚠️ **会真实发短信 / 邮件给客人**；发送接口 `/send/morning-pickup` 不在 `/api` 下，`next.config.ts` 单独转发这一条 |

各页面未登录（接口返回 401）时统一跳旧后台登录页
`<NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL>/auth/login?next=<当前页面完整 URL>`（`lib/safe-redirect.ts`）。
新页面暂未接入侧边导航，需直接输入网址访问。
