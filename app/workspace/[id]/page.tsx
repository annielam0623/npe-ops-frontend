import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WorkspaceItemView } from "@/components/workspace/item-view";

export const metadata: Metadata = {
  title: "Work item",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default async function WorkspaceItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <WorkspaceItemView id={Number(id)} />;
}
