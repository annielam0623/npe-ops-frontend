"use client";

import { cn } from "@/lib/utils";
import type { DispatchRow } from "@/types";

import { EditMenu } from "./vehicle-row";
import {
  timetableHasTour,
  usePartnerTimetable,
  type Loaded,
} from "./use-farm-out";
import type { FarmOutPartner } from "@/types/farm-out";

/**
 * Farm out 车（G40，Annie 2026-10-15 定：第二台车才有键；灰蓝色 #475569，不用淡紫）。
 * 不要司机 / 车号 / 导游 / 酒店；这台车上选一次合作公司，车上所有订单都算这家。
 * Edit ▾：Back to our bus（变回普通车）、Remove vehicle。
 */
export function FarmOutBlock({
  row,
  partners,
  needHotel,
  disabled = false,
  onChange,
  onRemove,
}: {
  row: DispatchRow;
  partners: Loaded<FarmOutPartner[]>;
  /** 这台车上还没选酒店的订单数（名单没读到 = undefined）。 */
  needHotel?: number;
  disabled?: boolean;
  onChange: (next: DispatchRow) => void;
  onRemove: () => void;
}) {
  const list = partners.state === "ready" ? partners.data : [];
  const active = list.filter((p) => p.is_active || p.id === row.partner_id);
  const tt = usePartnerTimetable(row.partner_id);
  const noTimes =
    row.partner_id != null &&
    row.manifest_id != null &&
    tt.state === "ready" &&
    !timetableHasTour(tt.data, row.manifest_id);
  const partnerName =
    row.partner_name ?? list.find((p) => p.id === row.partner_id)?.name ?? null;
  return (
    <fieldset
      data-farm-out-bus={row.bus_label ?? ""}
      disabled={disabled}
      className="vrow m-0 mt-3 grid min-w-0 grid-cols-[92px_minmax(0,1fr)] items-stretch rounded-[10px] border border-[#94a3b8] bg-[#f1f5f9] p-0 max-[860px]:grid-cols-1"
    >
      <div className="flex flex-col items-center justify-center gap-1.5 rounded-l-[10px] bg-[#475569] px-2 py-3 text-center text-white max-[860px]:flex-row max-[860px]:justify-start max-[860px]:rounded-t-[10px] max-[860px]:rounded-bl-none">
        <span className="text-[11px] font-bold tracking-[.06em] uppercase">
          Farm out
        </span>
        <span aria-hidden className="text-[24px] leading-none">
          ⇄
        </span>
        {row.bus_label ? (
          <span className="text-[11px] opacity-80">Bus {row.bus_label}</span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col px-3.5 pt-2.5 pb-3">
        <div className="flex flex-wrap items-center gap-2 border-b-[0.5px] border-black/[.07] pb-[9px] text-[13px] text-[#1a1a1a]">
          <span>
            {partnerName ? (
              <>
                Farmed out to <b>{partnerName}</b>
              </>
            ) : (
              "Farmed out"
            )}{" "}
            · no driver or vehicle needed
          </span>
          {row.partner_id == null ? (
            <span className="rounded-full border border-[#e7b75a] bg-[#fdf6e7] px-[9px] py-[3px] text-[11px] font-bold whitespace-nowrap text-[#8a5a00]">
              Pick a partner
            </span>
          ) : needHotel ? (
            <span
              data-need-hotel
              className="rounded-full border border-[#e7b75a] bg-[#fdf6e7] px-[9px] py-[3px] text-[11px] font-bold whitespace-nowrap text-[#8a5a00]"
            >
              Needs hotel for {needHotel} {needHotel === 1 ? "order" : "orders"}
            </span>
          ) : null}
          <div className="ml-auto">
            <EditMenu
              clearLabel="Back to our bus"
              onClear={() =>
                onChange({
                  ...row,
                  farm_out: false,
                  partner_id: null,
                  partner_name: null,
                })
              }
              onRemove={onRemove}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 pt-[9px] text-[13px]">
          <label
            htmlFor={`fo-partner-${row.bus_label ?? "x"}`}
            className="font-semibold"
          >
            Farm out to
          </label>
          <select
            id={`fo-partner-${row.bus_label ?? "x"}`}
            value={row.partner_id ?? ""}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              onChange({
                ...row,
                partner_id: id,
                partner_name: list.find((p) => p.id === id)?.name ?? null,
              });
            }}
            className={cn(
              "min-h-[34px] w-[220px] max-w-full rounded-[7px] border bg-paper px-[9px] text-[13.5px] text-[#111827]",
              row.partner_id == null
                ? "border-dashed border-[#e7b75a] bg-[#fdf6e7]"
                : "border-[#cbd2dc]",
            )}
          >
            <option value="">Choose a partner…</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {partners.state === "ready" && active.length === 0 ? (
          <p
            data-no-partners
            className="mt-2 mb-0 text-[12.5px] text-[#8a5a00]"
          >
            No partners yet. An admin adds them in Supplier → Partners.
          </p>
        ) : null}
        {noTimes ? (
          <p
            data-no-timetable
            className="mt-2 mb-0 text-[12.5px] text-[#8a5a00]"
          >
            This tour has no timetable at {partnerName ?? "this partner"} — pick
            a hotel and type the departure time on each order below.
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
