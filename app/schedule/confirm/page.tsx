import type { Metadata } from "next";

import { ConfirmView } from "@/components/schedule/confirm-view";

export const metadata: Metadata = {
  title: "Confirm your schedule",
};

export default function ConfirmSchedulePage() {
  return <ConfirmView />;
}
