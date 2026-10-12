import type { Metadata } from "next";

import { NavigationSettingsView } from "@/components/settings-navigation/navigation-view";

export const metadata: Metadata = {
  title: "Navigation",
};

// 只给 superadmin（dashboard 改版阶段一，设计 §2.4）。
export default function NavigationSettingsPage() {
  return <NavigationSettingsView />;
}
