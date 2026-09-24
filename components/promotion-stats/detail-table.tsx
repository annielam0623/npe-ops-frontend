import type { ReactNode } from "react";

import { env } from "@/lib/env";
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

const COLUMNS = [
  "Order #",
  "Name",
  "Email",
  "Tour Date",
  "Tour Type",
  "Quantities",
  "Confirmation",
  "MTLV Qty",
  "MTLV Ticket Status",
] as const;

function legacyOrderHref(orderNumber: string): string {
  return `${env.legacyAdminBaseUrl}/admin/operations/orders?q=${encodeURIComponent(orderNumber)}`;
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
    <section className="rounded-lg border border-stone-200 bg-white">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-200 px-4 py-3">
        <h2 className="text-base font-semibold text-stone-800">{title}</h2>
        {!loading && !error && records ? (
          <span className="text-xs text-stone-500">
            {records.length.toLocaleString("en-US")} records
          </span>
        ) : null}
      </header>

      {truncated ? (
        <p className="border-b border-[#BA7517]/30 bg-[#FAEEDA] px-4 py-2 text-sm text-[#7A4C0F]">
          仅显示前 {PROMOTION_DETAIL_LIMIT}{" "}
          条记录，结果可能被截断，请缩小日期范围后再查看。
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-stone-50 text-xs tracking-wide text-stone-500 uppercase">
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-4 py-2.5 font-medium whitespace-nowrap"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 text-stone-700">
            {body}
          </tbody>
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
    <tr className="align-top hover:bg-stone-50">
      <td className="px-4 py-2.5 whitespace-nowrap">
        <a
          href={legacyOrderHref(record.order_number)}
          className="font-mono font-medium text-[#185FA5] hover:underline"
        >
          {record.order_number}
        </a>
      </td>
      <td className="px-4 py-2.5">
        <div className="font-medium whitespace-nowrap text-stone-800">
          {name || "—"}
        </div>
        {record.phone ? (
          <div className="text-xs whitespace-nowrap text-stone-500">
            {record.phone}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        {orDash(record.customer_email)}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
        {formatDate(record.tour_date)}
      </td>
      <td className="px-4 py-2.5">{orDash(record.tour_type)}</td>
      <td className="px-4 py-2.5">{orDash(record.quantities)}</td>
      <td className="px-4 py-2.5">
        <ConfirmationBadge value={record.confirmation} />
      </td>
      <td className="px-4 py-2.5 tabular-nums">{record.mtlv_qty}</td>
      <td className="px-4 py-2.5">
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
        className="px-4 py-10 text-center text-sm text-stone-500"
      >
        {children}
      </td>
    </tr>
  );
}
