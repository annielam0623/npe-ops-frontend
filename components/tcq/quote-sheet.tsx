import type { TcqQuoteBlock, TcqQuoteTerms } from "@/types/tcq";

import { money, qtyLabel, sheetDate } from "./config";

/**
 * 报价单，版式照后端 PDF（`app/services/tcq_pdf.py`，Annie 10-15 在公司看过的样张 NPE-2026-0001）：
 * 抬头、Transportation Quotation、单号和日期、客户；每块一条浅蓝标题带、五栏表、Subtotal / 税 / Total；
 * 各块是同一份行程的选项时写「Please choose one」；最后 Inclusions / Not included / Pricing assumptions / Terms。
 * `staffNotes`：每行下面的算式（灰）和改过的价（橙），只在审核页上显示，PDF 不印。
 */
export function QuoteSheet({
  header,
  quoteNo,
  date,
  client,
  blocks,
  taxOn,
  taxLabel,
  alternatives,
  terms,
  staffNotes,
}: {
  header: string;
  /** null = 还没 Generate（预览）。 */
  quoteNo: string | null;
  date: string;
  client: string;
  blocks: TcqQuoteBlock[];
  taxOn: boolean;
  taxLabel: string;
  alternatives: boolean;
  terms: TcqQuoteTerms;
  staffNotes: boolean;
}) {
  const sections: [string, string[]][] = [
    ["Inclusions", terms.inclusions],
    ["Not included", terms.not_included],
    ["Pricing assumptions", terms.assumptions],
    ["Terms", terms.conditions],
  ];
  return (
    <div
      data-quote-sheet
      className="min-w-0 rounded-[6px] bg-white px-5 py-6 font-[Helvetica,Arial,sans-serif] text-[12.5px] text-[#111] sm:px-8"
    >
      <div className="text-[24px] leading-tight font-bold">{header}</div>
      <div className="mt-1.5 text-[15px] font-bold">
        Transportation Quotation
      </div>
      <div className="mt-1 leading-[1.7]">
        Quote no.:{" "}
        {quoteNo ?? <i className="text-[#6b7280]">given when you generate</i>}
        <span className="ml-4">Date: {date}</span>
      </div>
      {client ? <div className="leading-[1.7]">Client: {client}</div> : null}

      {blocks.map((b) => (
        <div key={b.key} className="mt-[18px]" data-quote-block={b.title}>
          <div className="bg-[#e6ecf5] px-1.5 py-[5px] text-[14px] font-bold">
            {b.title}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr className="text-[12px]">
                  <th className="border-b border-[#111] px-1.5 pt-1.5 pb-[3px] text-left font-bold">
                    Date
                  </th>
                  <th className="border-b border-[#111] px-1.5 pt-1.5 pb-[3px] text-left font-bold">
                    Description
                  </th>
                  {["Qty", "Unit price", "Amount"].map((h) => (
                    <th
                      key={h}
                      className="border-b border-[#111] px-1.5 pt-1.5 pb-[3px] text-right font-bold"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.lines.map((l, i) => (
                  <tr key={i} className="align-top" data-quote-line>
                    <td className="w-[112px] px-1.5 py-[5px] whitespace-nowrap">
                      {sheetDate(l.date)}
                    </td>
                    <td className="px-1.5 py-[5px]">
                      {l.description}
                      {staffNotes && l.overridden ? (
                        <span
                          className="block text-[11px] text-[#b45309]"
                          data-overridden
                        >
                          Changed by staff · rate card{" "}
                          {money(l.original_cents ?? 0)}
                        </span>
                      ) : staffNotes && l.calc ? (
                        <span
                          className="block text-[11px] text-[#6b7280]"
                          data-calc
                        >
                          {l.calc}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-1.5 py-[5px] text-right tabular-nums">
                      {qtyLabel(l.qty)}
                    </td>
                    <td className="px-1.5 py-[5px] text-right tabular-nums">
                      {money(l.unit_cents)}
                    </td>
                    <td className="px-1.5 py-[5px] text-right tabular-nums">
                      {money(l.amount_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <table className="w-full border-collapse border-t border-[#111] tabular-nums">
            <tbody>
              <tr>
                <td className="px-1.5 py-[3px] text-right">Subtotal</td>
                <td className="w-[112px] px-1.5 py-[3px] text-right">
                  {money(b.subtotal_cents)}
                </td>
              </tr>
              {taxOn ? (
                <tr data-tax-row>
                  <td className="px-1.5 py-[3px] text-right">{taxLabel}</td>
                  <td className="px-1.5 py-[3px] text-right">
                    {money(b.tax_cents)}
                  </td>
                </tr>
              ) : null}
              <tr className="text-[13.5px] font-bold">
                <td className="px-1.5 py-[3px] text-right">Total</td>
                <td className="px-1.5 py-[3px] text-right" data-block-total>
                  {money(b.total_cents)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      {alternatives ? (
        <p className="mt-3 text-[12px] italic">
          Each vehicle option above is priced on its own. Please choose one.
        </p>
      ) : null}

      <div className="mt-5">
        {sections.map(([title, items]) =>
          items.length ? (
            <div key={title} className="mt-3">
              <div className="text-[13.5px] font-bold">{title}</div>
              <ul className="mt-1 leading-[1.6]">
                {items.map((t, i) => (
                  <li key={i}>- {t}</li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
