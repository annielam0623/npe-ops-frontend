import type { ReactNode } from "react";

import { PROMOTION_DETAIL_LIMIT } from "@/lib/promotion-stats-api";
import type { PromotionDetailRecord } from "@/types";

import { ConfirmationBadge, TicketStatusBadge } from "./badges";
import { RetryButton } from "./retry-button";

interface DetailTableProps {
  title: string;
  records: PromotionDetailRecord[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

/** 表头文字照旧页面；Email 一列旧页面没有（ops 多的）。 */
const COLUMNS = [
  "Order #",
  "Guest",
  "Email",
  "Tour Date",
  "Tour",
  "Party",
  "Confirmation",
  "MTLV Qty",
  "Ticket Status",
] as const;

/** 旧页面 table.ps-table td */
const TD = "border-b-[0.5px] border-black/5 px-3 py-[7px] whitespace-nowrap";

/** 订单页已迁到 ops：带 ?q= 搜这一单（查全部日期）。 */
function legacyOrderHref(orderNumber: string): string {
  return `/orders?q=${encodeURIComponent(orderNumber)}`;
}

function formatDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "—";
}

function orDash(value: string | null | undefined): string {
  return value?.trim() ? value : "—";
}

export function DetailTable({
  title,
  records,
  loading,
  error,
  onRetry,
}: DetailTableProps) {
  const truncated =
    !loading && !error && (records?.length ?? 0) >= PROMOTION_DETAIL_LIMIT;

  let body: ReactNode;
  if (loading) {
    body = <MessageRow>Loading...</MessageRow>;
  } else if (error) {
    body = (
      <MessageRow>
        <div className="flex flex-col items-center gap-2">
          <span className="text-[#A32D2D]">{error}</span>
          <RetryButton onClick={onRetry} />
        </div>
      </MessageRow>
    );
  } else if (!records || records.length === 0) {
    body = <MessageRow>No records</MessageRow>;
  } else {
    body = records.map((record, index) => (
      <DetailRow key={`${record.order_number}-${index}`} record={record} />
    ));
  }

  return (
    <section className="overflow-hidden rounded-[10px] border-[0.5px] border-black/10 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b-[0.5px] border-black/[.08] px-4 py-3">
        <h2 className="text-[13px] font-semibold text-[#555]">{title}</h2>
        {!loading && !error && records ? (
          <span className="text-[12px] text-[#aaa]">
            {records.length.toLocaleString("en-US")} records
          </span>
        ) : null}
      </header>

      {truncated ? (
        <p className="border-b-[0.5px] border-[#BA7517]/30 bg-[#FAEEDA] px-4 py-2 text-[12px] text-[#7A4C0F]">
          仅显示前 {PROMOTION_DETAIL_LIMIT}{" "}
          条记录，结果可能被截断，请缩小日期范围后再查看。
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] border-collapse text-left text-[13px]">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="border-b border-black/[.08] bg-[#fafaf8] px-3 py-2 font-semibold whitespace-nowrap text-[#555]"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-[#1a1a1a]">{body}</tbody>
        </table>
      </div>
    </section>
  );
}

function DetailRow({ record }: { record: PromotionDetailRecord }) {
  const name = [record.first_name, record.last_name]
    .filter((part) => part?.trim())
    .join(" ");

  return (
    <tr className="[&:last-child>td]:border-b-0">
      <td className={TD}>
        <a
          href={legacyOrderHref(record.order_number)}
          className="text-[#185FA5] underline"
        >
          {record.order_number}
        </a>
      </td>
      <td className={TD}>
        <div>{name || "—"}</div>
        {record.phone ? (
          <div className="text-[11px] text-[#aaa]">{record.phone}</div>
        ) : null}
      </td>
      <td className={TD}>{orDash(record.customer_email)}</td>
      <td className={TD + " tabular-nums"}>{formatDate(record.tour_date)}</td>
      <td className={TD + " max-w-[160px] overflow-hidden text-ellipsis"}>
        {orDash(record.tour_type)}
      </td>
      <td className={TD}>{orDash(record.quantities)}</td>
      <td className={TD}>
        <ConfirmationBadge value={record.confirmation} />
      </td>
      <td className={TD + " font-medium tabular-nums"}>{record.mtlv_qty}</td>
      <td className={TD}>
        <TicketStatusBadge value={record.mtlv_ticket_status} />
      </td>
    </tr>
  );
}

function MessageRow({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td
        colSpan={COLUMNS.length}
        className="px-4 py-5 text-left text-[13px] text-[#aaa]"
      >
        {children}
      </td>
    </tr>
  );
}
