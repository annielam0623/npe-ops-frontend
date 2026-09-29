import type { Metadata } from "next";

import { TeamsView } from "@/components/teams/teams-view";

export const metadata: Metadata = {
  title: "Teams",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源 /api/* 请求才会带上。
export default function TeamsPage() {
  return <TeamsView />;
}
