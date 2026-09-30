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
    ];
  },
};

export default nextConfig;
