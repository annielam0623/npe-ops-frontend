import { notFound } from "next/navigation";

import Harness from "./harness";

/*
 * G382 请假框 / 改班栏的检查页（6e 写，e2 2026-11-26 提交）：checks/headless/g382-leave-test.js 在 next dev 上点它。
 * 页面里拦 fetch、只用模拟数据，不连后端。生产（next build / start，线上 Railway）一律 404，staff 打不开。
 */
export const dynamic = "force-dynamic";

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Harness />;
}
