import type { NextConfig } from "next";

import { resolveApiProxyTarget } from "./lib/api-proxy";

const apiProxyTarget = resolveApiProxyTarget();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 检查脚本（checks/headless/run-all.js）起的 dev 用单独的目录。和本地 dev 共用 .next 时，
  // Turbopack 缓存里会混进另一套 NEXT_PUBLIC_* 的值（旧后台链接变成模拟接口地址、报水合不一致）。
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // /api/* 转发的超时（默认 30 秒）。发送类接口一批要几十秒，超时后浏览器报错、后端却还在发，
    // staff 以为失败再点一次就会重复发给客人。前端已经分小批发送，这里再放宽作为保险。
    proxyTimeout: 5 * 60 * 1000,
  },
  // 与旧后台 /admin/ 一致：首页直接进 Dashboard。用 307（非永久），以后首页换内容不会被浏览器缓存住。
  async redirects() {
    return [
      { source: "/", destination: "/dashboard", permanent: false },
      // 登录不带 next（直接打开 /auth/login）时，后端按角色跳 /admin/dashboard（旧后台的地址，
      // 在 ops 上没有这一页）——接到 /dashboard（后端待办 G32 第 3 条）。
      { source: "/admin/dashboard", destination: "/dashboard", permanent: false },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyTarget}/api/:path*`,
      },
      // 登录页三件套（后端渲染，不在 /api 下）：代理这几条而不是把 cookie 放宽到整个域名
      // （后端待办 G32，Annie 2026-10-06 晚定）。登录发生在 ops 自己的网址上，后端回的
      // Set-Cookie 没带 domain，cookie 因此只属于 ops；登录后端的 safe_next 回跳也落在 ops 上。
      ...["/auth/login", "/auth/change-password", "/auth/logout"].map(
        (p) => ({ source: p, destination: `${apiProxyTarget}${p}` }),
      ),
      // 早班发送接口不在 /api 下（后端 send.py）。只放这一条，不整个转发 /send/*。
      {
        source: "/send/morning-pickup",
        destination: `${apiProxyTarget}/send/morning-pickup`,
      },
      // Tour Confirmation 发送页（后端 send.py，不在 /api 下）：建批次、两块的批量发送（⚠️ 真实发送）、重新上传的 Apply。
      ...[
        "/send/tour-batches",
        "/send/tour-confirmation-bulk",
        "/send/last-minute-confirmation-bulk",
        "/send/tour-confirmation-apply",
        // Tour tracking 的 ⬆ Upload（补录，不发消息）。
        "/send/tour-tracking-import-preview",
        "/send/tour-tracking-import-commit",
      ].map((p) => ({ source: p, destination: `${apiProxyTarget}${p}` })),
      // tracking 页的对话弹窗（后端 booking_notes.py，不在 /api 下）。同样只放用到的这一条。
      {
        source: "/booking-notes/by-order/:order",
        destination: `${apiProxyTarget}/booking-notes/by-order/:order`,
      },
      // tracking 页的群发（⚠️ 真实发送）。
      {
        source: "/booking-notes/broadcast/send",
        destination: `${apiProxyTarget}/booking-notes/broadcast/send`,
      },
      // Tour manifest 的打印页（后端渲染的 A4 HTML，每打开一次写一条打印日志）和 Excel 下载（表单 POST）。
      // 都不在 /api 下；后端还没有 JSON 版（见 PROGRESS「需要后端」）。只放这两条。
      {
        source: "/admin/dispatch/manifest/print",
        destination: `${apiProxyTarget}/admin/dispatch/manifest/print`,
      },
      // 导游页预览（后端渲染，按车）。
      {
        source: "/admin/dispatch/manifest/guide",
        destination: `${apiProxyTarget}/admin/dispatch/manifest/guide`,
      },
      {
        source: "/admin/dispatch/manifest/download",
        destination: `${apiProxyTarget}/admin/dispatch/manifest/download`,
      },
      // 门票 tracking 页按行 id 取 / 写对话（?source=tickets）。:id 只匹配一段，碰不到 by-order。
      {
        // 注意 JS 字符串里要写 \\d，单个 \d 会变成字母 d。
        source: "/booking-notes/:id(\\d+)",
        destination: `${apiProxyTarget}/booking-notes/:id`,
      },
    ];
  },
};

export default nextConfig;
