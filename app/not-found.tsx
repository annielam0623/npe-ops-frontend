import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">页面不存在</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        你访问的页面不存在或已被移动。
      </p>
      <div>
        <Link
          href="/"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          返回首页
        </Link>
      </div>
    </main>
  );
}
