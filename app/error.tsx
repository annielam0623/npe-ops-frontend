"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">页面出错了</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {error.message || "发生了未知错误，请稍后重试。"}
      </p>
      <div>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          重试
        </button>
      </div>
    </main>
  );
}
