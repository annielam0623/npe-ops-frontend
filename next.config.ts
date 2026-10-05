import type { NextConfig } from "next";

import { resolveApiProxyTarget } from "./lib/api-proxy";

const apiProxyTarget = resolveApiProxyTarget();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // /api/* 转发的超时（默认 30 秒）。发送类接口一批要几十秒，超时后浏览器报错、后端却还在发，
    // staff 以为失败再点一次就会重复发给客人。前端已经分小批发送，这里再放宽作为保险。
    proxyTimeout: 5 * 60 * 1000,
  },
  // 与旧后台 /admin/ 一致：首页直接进 Dashboard。用 307（非永久），以后首页换内容不会被浏览器缓存住。
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyTarget}/api/:path*`,
      },
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
