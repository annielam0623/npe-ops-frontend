import type { ReactNode } from "react";

import { formatTime } from "@/lib/farm-out-time";
import { cn } from "@/lib/utils";
import type { FarmOutView } from "@/types/farm-out";

/**
 * 客人打电话来 staff 查单时，转单订单的两套上车资料（Annie 2026-10-15，预览 ④）：
 * 后端用 lead_with 说哪套放最上面（通知发出起 → 发车后 1 小时：合作公司那套放上面、黄色），前端只管按它排版，不算时间窗。
 * 合作公司的名字永远不显示（任务包第 17 条）。我方那套由宿主页面传进来（订单详情 / 搜索浮窗 / Tour Tracking 各自的上车字段）。
 * 卡片自带浅纸色底，深色外框和浅色表格里都能看清。
 */

/** "6:50 AM" + 1 小时 → "7:50 AM"；只用来写「shown until」，窗口本身由后端算。 */
function plusOneHour(t: string | null): string {
  const m = t ? /^(\d{1,2}):(\d{2})/.exec(t) : null;
  if (!m) return "";
  return formatTime(`${(Number(m[1]) + 1) % 24}:${m[2]}`);
}

/** 通知时间：ISO 串按洛杉矶时间写成 "Oct 15, 6:12 PM"；后端已格式化好的文字原样显示。 */
function formatSentAt(value: string | null): string {
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const LABEL = "text-[11px] font-bold tracking-[.05em] uppercase";

export function FarmOutViewCard({
  farmOutView,
  ourPickup,
}: {
  farmOutView: FarmOutView;
  /** 我方（Rezdy / 主名单原样）的上车时间 + 地点。 */
  ourPickup: ReactNode;
}) {
  const { partner_pickup: p, lead_with: lead } = farmOutView;
  const sentAt = formatSentAt(farmOutView.notice_sent_at);
  const noticeSent = Boolean(farmOutView.notice_sent_at);
  const until = plusOneHour(p.depart_time);

  const partnerDetail = (
    <div>
      <b>{p.hotel || "—"}</b>
      {p.checkin_time ? (
        <>
          {" · check-in "}
          <b>{formatTime(p.checkin_time)}</b>
        </>
      ) : null}
      {p.depart_time ? (
        <>
          {" · departs "}
          <b>{formatTime(p.depart_time)}</b>
        </>
      ) : null}
    </div>
  );

  const partnerFirst = lead === "partner";
  return (
    <div
      data-farm-out-view
      data-lead={lead}
      className="rounded-[10px] bg-[#f4f3ee] px-3.5 py-3 text-left text-[13px] font-normal text-[#1a1a1a]"
    >
      <div className="mb-1 flex justify-end">
        <span
          data-farm-out-tag
          className="text-[12px] font-bold text-[#5b21b6]"
        >
          ⇄ Farmed out
        </span>
      </div>

      {partnerFirst ? (
        <>
          <div
            data-block="partner"
            className="rounded-lg border border-[#f0d080] bg-[#fff8e1] px-2.5 py-2"
          >
            <div className={cn(LABEL, "text-[#7C4A00]")}>
              Answer with this — partner pickup
            </div>
            {partnerDetail}
            <div className="text-[11.5px] text-[#7C4A00]">
              Notice sent
              {farmOutView.notice_sent_by
                ? ` by ${farmOutView.notice_sent_by}`
                : ""}
              {sentAt ? `, ${sentAt}` : ""}
              {until ? ` · shown until ${until} (1 hour after departure)` : ""}
            </div>
          </div>
          <div
            data-block="ours"
            className="mt-2.5 border-l-[3px] border-[#d6d3c8] pl-2.5 text-[#555]"
          >
            <div className={LABEL}>Our booking (not used on the day)</div>
            <div>{ourPickup}</div>
          </div>
        </>
      ) : (
        <>
          <div
            data-block="ours"
            className="border-l-[3px] border-[#1a1a1a] pl-2.5"
          >
            <div className={LABEL}>Our booking</div>
            <div>{ourPickup}</div>
          </div>
          <div
            data-block="partner"
            className="mt-2.5 border-l-[3px] border-[#c4b5fd] pl-2.5 text-[#555]"
          >
            <div className={LABEL}>Partner pickup · use on tour day</div>
            {partnerDetail}
            {!noticeSent ? (
              <div className="text-[11.5px]">Farm out notice not sent yet</div>
            ) : null}
          </div>
        </>
      )}

      <div className="mt-2 text-[11.5px] text-[#b3261e]">
        Do not tell the guest the partner&apos;s name.
      </div>
    </div>
  );
}
