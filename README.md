# npe-ops-frontend

NPE 员工后台运营系统（Operation System）的前端仓库。

本仓库用于把员工后台从 **Jinja2 服务端渲染** 迁移到 **React**。现有的 Python FastAPI
后端（部署在 Railway，使用 session / cookie 认证）**保持不变**，本仓库只通过 HTTP
调用它的接口。

> 当前阶段：仅搭建工程骨架，**没有任何业务页面，也未实现登录认证**。状态管理库和 UI
> 组件库都尚未引入，会在后续阶段再确定。

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
│   ├── page.tsx          # 首页（metadata 设置 robots noindex）
│   ├── globals.css       # 全局样式，引入 Tailwind v4
│   ├── loading.tsx       # 约定的加载态
│   ├── error.tsx         # 约定的错误边界（client component）
│   ├── not-found.tsx     # 约定的 404 页面
│   ├── login/            # 登录占位页（暂未实现认证）
│   └── promotion-stats/  # 推广统计页（试点业务页面）
├── components/
│   └── promotion-stats/  # 推广统计页的组件
├── lib/
│   ├── api-client.ts     # 调用 FastAPI 的 fetch 封装（apiFetch）
│   ├── env.ts            # 集中读取环境变量
│   ├── promotion-stats-api.ts # 推广统计接口
│   ├── safe-redirect.ts  # 登录回跳地址校验（防开放重定向）
│   └── utils.ts          # 通用工具（cn、buildQueryString）
├── types/
│   ├── api.ts            # ApiError 类与请求参数类型
│   ├── promotion-stats.ts # 推广统计接口的返回类型
│   └── index.ts          # 类型统一出口
├── public/               # 静态资源（暂空）
├── .env.example          # 环境变量示例
├── eslint.config.mjs     # ESLint 9 扁平配置
├── postcss.config.mjs    # PostCSS（@tailwindcss/postcss）
└── next.config.ts        # Next.js 配置
```

路径别名 `@/*` 指向仓库根目录（见 `tsconfig.json`），例如 `import { apiFetch } from "@/lib/api-client"`。

## 与后端对接

后端地址通过环境变量 `NEXT_PUBLIC_API_BASE_URL` 配置，集中在 `lib/env.ts` 读取：

- 默认值为 `http://127.0.0.1:8000`；
- 若配置为非法 URL 会直接抛错，避免带着错误配置启动；
- `NEXT_PUBLIC_*` 变量必须以字面量 `process.env.NEXT_PUBLIC_XXX` 读取，Next.js
  才会在构建时把它内联进浏览器代码（`process.env[name]` 在客户端永远是 undefined）。

过渡期内部分链接会跳回旧版后台，地址由 `NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL` 配置，
留空时默认等于 `NEXT_PUBLIC_API_BASE_URL`。

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

- 基于 `NEXT_PUBLIC_API_BASE_URL` 拼接完整 URL；
- 自动序列化 JSON 请求体并设置 `Content-Type`；
- **固定携带 `credentials: "include"`**，以便浏览器带上后端 session cookie；
- 非 2xx 响应统一抛出 `ApiError`（包含 `status`、`statusText`、`url`、`body`）。

由于使用 cookie 认证并携带 `credentials: "include"`，后端需要为本前端域名配置
CORS（允许携带凭证，即 `Access-Control-Allow-Credentials: true` 且 `Access-Control-Allow-Origin`
为具体域名而非 `*`）。
