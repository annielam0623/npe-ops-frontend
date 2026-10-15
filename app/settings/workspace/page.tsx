import type { Metadata } from "next";

import { WorkspaceSettingsView } from "@/components/workspace/workspace-settings-view";

export const metadata: Metadata = {
  title: "My Workspace settings",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function WorkspaceSettingsPage() {
  return <WorkspaceSettingsView />;
}
