import type { SendLogRow } from "@/types";

import {
  emailStatus,
  failedChannels,
  formatSentAt,
  fullName,
  isKnownModule,
  MODULE_STYLES,
  smsStatus,
  type StatusPill,
  TONE_CLASS,
} from "./config";

const TH_CLASS =
  "px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-stone-500";
const TD_CLASS = "px-3 py-2 align-top";

function ModuleBadge({ module }: { module: string | null }) {
  if (!isKnownModule(module)) {
    return <span className="text-xs text-stone-500">{module || "—"}</span>;
  }
  const style = MODULE_STYLES[module];
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${style.badgeClass}`}
    >
      {style.label}
    </span>
  );
}

function Pill({ pill }: { pill: StatusPill | null }) {
  if (!pill) {
    return <span className="text-stone-300">—</span>;
  }
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_CLASS[pill.tone]}`}
    >
      {pill.label}
    </span>
  );
}

export function SendLogTable({ rows }: { rows: SendLogRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-stone-400">
        No records found.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-stone-200 bg-stone-50">
          <tr>
            <th className={TH_CLASS}>Sent At</th>
            <th className={TH_CLASS}>Module</th>
            <th className={TH_CLASS}>Order #</th>
            <th className={TH_CLASS}>Name</th>
            <th className={TH_CLASS}>Phone / Email</th>
            <th className={TH_CLASS}>Tour Date</th>
            <th className={TH_CLASS}>Tour Type</th>
            <th className={TH_CLASS}>Email</th>
            <th className={TH_CLASS}>SMS</th>
            <th className={TH_CLASS}>By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((row, i) => (
            <tr key={`${row.sent_at}-${row.order_number}-${i}`}>
              <td className={`${TD_CLASS} text-xs whitespace-nowrap`}>
                {formatSentAt(row.sent_at)}
              </td>
              <td className={TD_CLASS}>
                <ModuleBadge module={row.module} />
              </td>
              <td
                className={`${TD_CLASS} font-medium whitespace-nowrap text-[#378ADD]`}
              >
                {row.order_number || "—"}
              </td>
              <td className={TD_CLASS}>{fullName(row)}</td>
              <td className={`${TD_CLASS} text-xs`}>
                {row.phone ? <div>{row.phone}</div> : null}
                {row.email ? (
                  <div className="break-all">{row.email}</div>
                ) : null}
              </td>
              <td className={`${TD_CLASS} whitespace-nowrap`}>
                {row.tour_date || "—"}
              </td>
              <td className={`${TD_CLASS} text-xs`}>{row.tour_type || "—"}</td>
              <td className={TD_CLASS}>
                <Pill pill={emailStatus(row.email_status)} />
              </td>
              <td className={TD_CLASS}>
                <Pill pill={smsStatus(row.sms_status)} />
              </td>
              <td
                className={`${TD_CLASS} text-xs whitespace-nowrap text-stone-500`}
              >
                {row.sent_by || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 本页里带错误信息的行，单独列出来（与旧页面一样只看当前这一页）。 */
export function ErrorsTable({ rows }: { rows: SendLogRow[] }) {
  const errors = rows.filter((r) => r.error_msg?.trim());
  if (errors.length === 0) {
    return null;
  }
  return (
    <section className="overflow-hidden rounded-lg border border-[#A32D2D]/25 bg-white">
      <div className="flex items-center gap-2 border-b border-[#A32D2D]/15 bg-[#fff8f8] px-4 py-3">
        <h2 className="text-sm font-semibold text-[#A32D2D]">⚠️ Errors</h2>
        <span className="rounded-full bg-[#A32D2D] px-2 py-0.5 text-xs font-bold text-white tabular-nums">
          {errors.length}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-stone-100">
            <tr>
              <th className={TH_CLASS}>Sent At</th>
              <th className={TH_CLASS}>Module</th>
              <th className={TH_CLASS}>Order #</th>
              <th className={TH_CLASS}>Name</th>
              <th className={TH_CLASS}>Channel</th>
              <th className={TH_CLASS}>Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {errors.map((row, i) => (
              <tr key={`${row.sent_at}-${row.order_number}-${i}`}>
                <td className={`${TD_CLASS} text-xs whitespace-nowrap`}>
                  {formatSentAt(row.sent_at)}
                </td>
                <td className={TD_CLASS}>
                  <ModuleBadge module={row.module} />
                </td>
                <td
                  className={`${TD_CLASS} font-medium whitespace-nowrap text-[#378ADD]`}
                >
                  {row.order_number || "—"}
                </td>
                <td className={TD_CLASS}>{fullName(row)}</td>
                <td className={`${TD_CLASS} text-xs`}>{failedChannels(row)}</td>
                <td
                  className={`${TD_CLASS} text-xs leading-snug break-words text-[#A32D2D]`}
                >
                  {row.error_msg}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
