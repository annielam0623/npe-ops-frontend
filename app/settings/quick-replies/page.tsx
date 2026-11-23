import { redirect } from "next/navigation";

/**
 * 7c A（Annie 2026-11-20「7c「A」…| 动手」）：Driver Quick Replies 搬进 Content Studio › Team Messages 当一个标签，
 * 旧页去掉、侧栏不再有这一项；收藏的旧网址照样能用，直接跳到那个标签。
 */
export default function QuickRepliesPage() {
  redirect("/settings/content-studio?module=team&tab=driver-quick-replies");
}
