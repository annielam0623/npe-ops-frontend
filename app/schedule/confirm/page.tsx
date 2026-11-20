import { redirect } from "next/navigation";

/**
 * 旧网址（Annie 2026-11-19 4A）：Confirm your schedule 改名 My schedule ⇒ /schedule/confirm?week=… 跳到 /my-schedule，带着原来的参数。
 * 邮件里免登录的 /schedule/confirm/link/… 和 /schedule/confirm/period/… 是别的路由，不受影响。
 */
export default async function ConfirmScheduleRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v !== undefined) qs.append(k, v);
  }
  const q = qs.toString();
  redirect(q ? `/my-schedule?${q}` : "/my-schedule");
}
