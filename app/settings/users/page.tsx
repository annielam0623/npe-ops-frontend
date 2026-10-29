import { redirect } from "next/navigation";

// Users 和 Team 并成一页（Annie 2026-10-28「动手」）：旧网址、旧书签跳到 /settings/team。
export default function UsersPage() {
  redirect("/settings/team");
}
