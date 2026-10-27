import { redirect } from "next/navigation";

// 时刻表搬到每家 Partner 下面（G199，Annie 2026-10-27）：旧网址跳到 Partners，从那里点 Timetable 进这家的表。
export default function FarmOutTimetablePage() {
  redirect("/settings/farm-out-partners");
}