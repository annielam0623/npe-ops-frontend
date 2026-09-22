import type { Metadata } from "next";

import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "首页",
  robots: {
    index: false,
    follow: false,
  },
};

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium tracking-wide text-neutral-500 uppercase">
          NPE Operation System
        </span>
        <h1 className="text-3xl font-semibold sm:text-4xl">
          NPE 员工后台运营系统
        </h1>
        <p className="text-base text-neutral-600 dark:text-neutral-400">
          这是把员工后台从 Jinja2 服务端渲染迁移到 React
          的前端骨架，目前仅搭建框架，暂未实现任何业务页面与登录认证。
        </p>
      </div>

      <div className="rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
        <p className="text-neutral-500">当前后端接口地址</p>
        <p className="mt-1 font-mono text-neutral-900 dark:text-neutral-100">
          {env.apiBaseUrl}
        </p>
      </div>
    </main>
  );
}
