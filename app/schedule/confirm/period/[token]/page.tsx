import type { Metadata } from "next";

import { PeriodConfirmView } from "@/components/schedule/period-confirm-view";

export const metadata: Metadata = {
  title: "Confirm your schedule",
  robots: { index: false, follow: false },
};

/** 整段排班（Period › Share with staff）邮件里的一人一条链接（不用登录，过期失效）。 */
export default async function ConfirmPeriodLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PeriodConfirmView token={token} />;
}
