import type { Metadata } from "next";

import { TaskBoardView } from "@/components/task-board/task-board-view";

export const metadata: Metadata = {
  title: "Task Board",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function TaskBoardPage() {
  return <TaskBoardView />;
}
