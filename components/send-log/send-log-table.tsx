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

/** 旧页面 .log-tbl thead td / tbody td / tbody tr。 */
const TH_CLASS =
  "border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-2.5 py-2 text-left text-[11px] font-semibold whitespace-nowrap text-[#999]";
/** 字色 #444 写在 tbody 上，单元格要别的颜色时自己加（cn 不合并冲突的 class）。 */
const TD_CLASS = "px-2.5 py-2 align-middle";
const ROW_CLASS =
  "border-b-[0.5px] border-black/[.06] last:border-b-0 hover:bg-[#fafaf8]";
/** 旧页面 .err-tbl thead td / tbody td / tbody tr。 */
const ERR_TH_CLASS =
  "border-b-[0.5px] border-[#A32D2D]/10 bg-[#fff8f8] px-3 py-2 text-left text-[11px] font-semibold whitespace-nowrap text-[#999]";
const ERR_TD_CLASS = "px-3 py-2 align-top";
const ERR_ROW_CLASS = "border-b-[0.5px] border-[#A32D2D]/[.08] last:border-b-0";

/** 旧页面 .mod-badge。 */
function ModuleBadge({ module }: { module: string | null }) {
  if (!isKnownModule(module)) {
    return <span className="text-[11px] text-[#888]">{module || "—"}</span>;
  }
  const style = MODULE_STYLES[module];
  return (
    <span
      className={`inline-flex items-center gap-[5px] rounded-[10px] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${style.badgeClass}`}
    >
      {style.label}
    </span>
  );
}

/** 旧页面 .sp。 */
function Pill({ pill }: { pill: StatusPill | null }) {
  if (!pill) {
    return <span className="text-[#ccc]">—</span>;
  }
  return (
    <span
      className={`inline-block rounded-[10px] px-2 py-0.5 text-[11px] whitespace-nowrap ${TONE_CLASS[pill.tone]}`}
    >
      {pill.label}
    </span>
  );
}

export function SendLogTable({
  rows,
  onMtlvClick,
}: {
  rows: SendLogRow[];
  /** 点 MTLV 标签 = 只看 MTLV（同旧页面）。 */
  onMtlvClick: () => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="p-6 text-center text-[12px] text-[#ccc]">
        No records found.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className={TH_CLASS}>Sent At</th>
            <th className={TH_CLASS}>Module</th>
            <th className={TH_CLASS}>Order #</th>
            <th className={TH_CLASS}>Name</th>
            <th className={TH_CLASS}>Phone / Email</th>
            <th className={TH_CLASS}>Tour Date</th>
            <th className={TH_CLASS}>Tour Type</th>
            <th className={TH_CLASS}>📧 Email</th>
            <th className={TH_CLASS}>📱 SMS</th>
            <th className={TH_CLASS}>MTLV</th>
            <th className={TH_CLASS}>By</th>
          </tr>
        </thead>
        <tbody className="text-[#444]">
          {rows.map((row, i) => (
            <tr
              key={`${row.sent_at}-${row.order_number}-${i}`}
              className={ROW_CLASS}
            >
              <td className={`${TD_CLASS} text-[11px] whitespace-nowrap`}>
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
              <td className={`${TD_CLASS} text-[11px]`}>
                {row.phone ? <div>{row.phone}</div> : null}
                {row.email ? (
                  <div className="break-all">{row.email}</div>
                ) : null}
              </td>
              <td className={`${TD_CLASS} whitespace-nowrap`}>
                {row.tour_date || "—"}
              </td>
              <td className={`${TD_CLASS} text-[11px]`}>
                {row.tour_type || "—"}
              </td>
              <td className={TD_CLASS}>
                <Pill pill={emailStatus(row.email_status)} />
              </td>
              <td className={TD_CLASS}>
                <Pill pill={smsStatus(row.sms_status)} />
              </td>
              <td className={TD_CLASS}>
                {row.mtlv_eligible ? (
                  <button
                    type="button"
                    onClick={onMtlvClick}
                    title="Show only MTLV"
                    className="inline-block cursor-pointer rounded-[10px] bg-[#FEF3C7] px-2 py-0.5 text-[11px] text-[#b45309] hover:opacity-80"
                  >
                    MTLV
                  </button>
                ) : (
                  <span className="text-[#ccc]">—</span>
                )}
              </td>
              <td
                className={`${TD_CLASS} text-[11px] whitespace-nowrap text-[#888]`}
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

/** 本页里带错误信息的行，单独列出来（与旧页面一样只看当前这一页）。旧页面 .error-section。 */
export function ErrorsTable({ rows }: { rows: SendLogRow[] }) {
  const errors = rows.filter((r) => r.error_msg?.trim());
  if (errors.length === 0) {
    return null;
  }
  return (
    <section className="mt-6 overflow-hidden rounded-xl border-[0.5px] border-[#A32D2D]/20 bg-[#fff8f8]">
      <div className="flex items-center gap-2 border-b-[0.5px] border-[#A32D2D]/15 bg-[#FCEBEB] px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-[#A32D2D]">⚠️ Errors</h2>
        <span className="rounded-[10px] bg-[#A32D2D] px-[7px] py-px text-[11px] font-bold text-white tabular-nums">
          {errors.length}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <th className={ERR_TH_CLASS}>Sent At</th>
              <th className={ERR_TH_CLASS}>Module</th>
              <th className={ERR_TH_CLASS}>Order #</th>
              <th className={ERR_TH_CLASS}>Name</th>
              <th className={ERR_TH_CLASS}>Channel</th>
              <th className={ERR_TH_CLASS}>Error</th>
            </tr>
          </thead>
          <tbody className="text-[#444]">
            {errors.map((row, i) => (
              <tr
                key={`${row.sent_at}-${row.order_number}-${i}`}
                className={ERR_ROW_CLASS}
              >
                <td className={`${ERR_TD_CLASS} text-[11px] whitespace-nowrap`}>
                  {formatSentAt(row.sent_at)}
                </td>
                <td className={ERR_TD_CLASS}>
                  <ModuleBadge module={row.module} />
                </td>
                <td
                  className={`${ERR_TD_CLASS} font-medium whitespace-nowrap text-[#378ADD]`}
                >
                  {row.order_number || "—"}
                </td>
                <td className={ERR_TD_CLASS}>{fullName(row)}</td>
                <td className={`${ERR_TD_CLASS} text-[11px]`}>
                  {failedChannels(row)}
                </td>
                <td
                  className={`${ERR_TD_CLASS} text-[11px] leading-[1.4] break-words text-[#A32D2D]`}
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
