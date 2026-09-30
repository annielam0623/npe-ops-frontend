import type { Metadata } from "next";

import { UsersView } from "@/components/users/users-view";

export const metadata: Metadata = {
  title: "Users",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源 /api/* 请求才会带上。
export default function UsersPage() {
  return <UsersView />;
}
