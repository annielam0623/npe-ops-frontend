import type { Metadata } from "next";

import { ConfirmView } from "@/components/schedule/confirm-view";

export const metadata: Metadata = {
  title: "Confirm your schedule",
  robots: { index: false, follow: false },
};

/** 邮件里的一人一条链接（不用登录，过期失效）。 */
export default async function ConfirmScheduleLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ConfirmView token={token} />;
}
