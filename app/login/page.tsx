import type { Metadata } from "next";
import Link from "next/link";

import { sanitizeNextPath } from "@/lib/safe-redirect";

export const metadata: Metadata = {
  title: "登录",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  const nextPath = sanitizeNextPath(next);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">登录</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        登录功能尚未实现，这里暂时只是占位页面。
      </p>
      {nextPath ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          登录后将返回：
          <Link
            href={nextPath}
            className="ml-1 font-mono text-neutral-900 underline dark:text-neutral-100"
          >
            {nextPath}
          </Link>
        </p>
      ) : null}
    </main>
  );
}
