"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { ManifestSetupGroup } from "@/types";

/**
 * Bus Manifest setup 的「地图」（Annie 2026-10-12 同意照后端 preview v4 做，旧页面没有）：
 * 左边每项设置一个橙色编号，右边缩小的印刷页（Bus Manifest、午餐单）和不打印的 Dispatch / 60 Days Forecast 上
 * 同一个编号标出它出现在哪；指到（或 Tab 到）左边某项，右边那块亮起来，反过来也一样。
 * 右边只是示意：客人、订单号、数字都是编的，节名、颜色、Extra、午餐行、Guests per bus 跟着左边现在的值。
 */
export type MapZone =
  "color" | "sections" | "extras" | "lunch" | "perBus" | "split";

/** 左右对应的编号（preview v4 的 3「Section order」等后端 G50 上 main 再插进来）。 */
export const PIN: Record<MapZone, number> = {
  color: 1,
  sections: 2,
  extras: 3,
  lunch: 4,
  perBus: 5,
  split: 6,
};

const PIN_CLASS =
  "inline-grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-[#e8590c] text-[12px] font-bold text-white";

export function Pin({
  zone,
  className,
}: {
  zone: MapZone;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn(PIN_CLASS, className)}>
      {PIN[zone]}
    </span>
  );
}

/** 右边印刷页上的编号：压在那块的角上，白边隔开。 */
function Mark({ zone, className }: { zone: MapZone; className: string }) {
  return (
    <span className={cn("absolute z-[2]", className)}>
      <Pin zone={zone} className="shadow-[0_0_0_2px_#fff]" />
    </span>
  );
}

/** 一块会亮的区域：左边指到对应设置时（或鼠标指到它自己时）描橙色虚线框。 */
function Zone({
  zones,
  active,
  onHover,
  className,
  style,
  children,
}: {
  zones: MapZone[];
  active: MapZone | null;
  onHover: (z: MapZone | null) => void;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  const on = active !== null && zones.includes(active);
  return (
    <div
      data-zone={zones.join(" ")}
      data-on={on ? "" : undefined}
      onMouseEnter={() => onHover(zones[0])}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "outline-2 -outline-offset-1 transition-[outline-color,background-color] duration-150 motion-reduce:transition-none",
        on
          ? "shadow-[inset_0_0_0_999px_rgba(232,89,12,.18)] outline-[#e8590c] outline-dashed"
          : "outline-transparent",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

// 编的客人（同 preview v4）。
const SAMPLE_GUESTS = [
  ["EX10421", "4:50 AM", "The STRAT", "Larsen", "Maja", 2],
  ["EX10458", "5:05 AM", "Bellagio", "Silva", "Marta", 2],
  ["EX10495", "4:50 AM", "MGM Grand", "Powell", "Faye", 2],
  ["EX10532", "5:14 AM", "Treasure Island", "Rossi", "Luca", 1],
  ["EX10577", "5:00 AM", "Excalibur", "Okafor", "Ada", 3],
] as const;

const SEC_TOUR = "#ece0f5";
const SEC_SHUTTLE = "#f8c9a0";
const ROW_SHADE = "#f6cfb0";

interface SheetSection {
  name: string;
  shuttle: "outbound" | "inbound" | null;
  /** 这一节里挂了 Extra 的产品代码（示意行用）。 */
  extraCodes: { code: string; extra: string }[];
}

/** 产品的节 ⇒ 印出来的节：默认节在前，其余 A–Z，班车排最后（真正的顺序以印出来的为准）。 */
function sheetSections(
  group: ManifestSetupGroup,
  defaultSection: string,
): SheetSection[] {
  const byKey = new Map<string, SheetSection>();
  const extraName = new Map(group.extras.map((e) => [e.id, e.name]));
  for (const p of group.products) {
    if (!p.is_active) continue;
    const name = (p.manifest_section || defaultSection).toUpperCase();
    const shuttle =
      p.manifest_section_kind === "tour" ? null : p.manifest_section_kind;
    const key = `${shuttle ?? "tour"}:${name}`;
    const s = byKey.get(key) ?? { name, shuttle, extraCodes: [] };
    const extra =
      p.manifest_extra_id !== null ? extraName.get(p.manifest_extra_id) : null;
    if (extra) s.extraCodes.push({ code: p.product_code, extra });
    byKey.set(key, s);
  }
  const def = defaultSection.toUpperCase();
  return [...byKey.values()].sort((a, b) => {
    if (!a.shuttle !== !b.shuttle) return a.shuttle ? 1 : -1;
    if (a.name === def) return -1;
    if (b.name === def) return 1;
    return a.name.localeCompare(b.name);
  });
}

const H5 =
  "m-0 text-[11px] font-semibold tracking-[.06em] text-[#5f6b7a] uppercase night:text-white/55";
const SHEET =
  "relative border border-[#c7ccd3] bg-white text-[8.5px] text-[#222] shadow-[0_2px_8px_rgba(0,0,0,.12)]";
const ROW =
  "grid grid-cols-[1.1fr_.8fr_1.5fr_1fr_1fr_.4fr_1.4fr] border-b border-[#e4e6ea]";
const CELL = "overflow-hidden px-1 py-[2.5px] text-ellipsis whitespace-nowrap";

export function ManifestMap({
  group,
  defaultSection,
  color,
  lunch,
  perBus,
  split,
  active,
  onHover,
}: {
  group: ManifestSetupGroup;
  defaultSection: string;
  /** 下面这些都是左边输入框现在的值（还没存的也跟着变）。 */
  color: string;
  lunch: string;
  perBus: string;
  split: string[];
  active: MapZone | null;
  onHover: (z: MapZone | null) => void;
}) {
  const sections = sheetSections(group, defaultSection);
  const tourSections = sections.filter((s) => !s.shuttle);
  const shuttles = sections.filter((s) => s.shuttle);
  const perBusNumber =
    /^\d+$/.test(perBus.trim()) && +perBus >= 1 && +perBus <= 99
      ? +perBus
      : group.guests_per_bus;
  const dispatchGuests =
    perBusNumber + Math.max(1, Math.round(perBusNumber / 3));
  let guest = 0;
  const nextGuest = () => SAMPLE_GUESTS[guest++ % SAMPLE_GUESTS.length];
  const zone = { active, onHover };
  const title = group.display_name.toUpperCase();
  const band = (
    <Zone
      zones={["color"]}
      {...zone}
      className="flex flex-wrap gap-3.5 px-[7px] py-[5px] text-[9.5px] font-extrabold"
      style={{ background: color }}
    >
      {title}
      <span className="font-normal">Driver: —&nbsp; Guide: —</span>
      <span className="font-normal">Sat, Oct 10, 2026</span>
      <span className="font-normal">BUS #: 2056=A</span>
    </Zone>
  );
  const foot = [
    ["Total # of pax", "56"],
    ["Bus seats left", "33"],
    ...group.extras.map((e) => [
      `${e.name} seats left`,
      String(Math.max(0, e.seats - 2)),
      "x",
    ]),
    ["Inbound", "0"],
    ["Outbound", "1"],
    ["Bus seats used", "23"],
    ["No lunch (incl. shuttle)", "1"],
    ["Lunch", "22"],
  ];

  return (
    <div
      aria-label="Where each setting shows"
      className="grid min-w-0 content-start gap-3"
    >
      <p className="m-0 text-[12px] text-[#5f6b7a] night:text-white/55">
        What prints for one bus (Bus A), then the two screens that are not
        printed. Guests and numbers are examples; the rest follows the settings
        on the left.
      </p>

      <h5 className={H5}>Bus Manifest</h5>
      <div className={SHEET}>
        <Mark zone="color" className="-top-[9px] -left-[9px]" />
        {band}
        <div className={cn(ROW, "font-semibold text-[#777]")}>
          {[
            "Order #",
            "Pick-up",
            "Location",
            "Last",
            "First",
            "#",
            "Quantities",
          ].map((h) => (
            <span key={h} className={CELL}>
              {h}
            </span>
          ))}
        </div>
        {tourSections.map((s, i) => {
          const rows = [nextGuest(), nextGuest()];
          return (
            <div key={`t:${s.name}`}>
              <Zone
                zones={["sections"]}
                {...zone}
                className="relative px-[5px] py-[3px] text-[9px] font-extrabold"
                style={{ background: SEC_TOUR }}
              >
                {s.name} {"{"}
                {rows.reduce((n, r) => n + r[5], 0) + s.extraCodes.length * 2}
                {"}"}
                {i === 0 ? (
                  <Mark zone="sections" className="-top-2 -right-[9px]" />
                ) : null}
              </Zone>
              {rows.map((r) => (
                <div key={r[0]} className={ROW}>
                  {r.map((c, j) => (
                    <span key={j} className={CELL}>
                      {c}
                    </span>
                  ))}
                  <span className={CELL}>Adult (2 or older)</span>
                </div>
              ))}
              {s.extraCodes.map(({ code, extra }) => {
                const r = nextGuest();
                return (
                  <Zone
                    key={code}
                    zones={["extras"]}
                    {...zone}
                    className={ROW}
                    style={{ background: ROW_SHADE }}
                  >
                    {r.slice(0, 5).map((c, j) => (
                      <span key={j} className={CELL}>
                        {c}
                      </span>
                    ))}
                    <span className={CELL}>2</span>
                    <span className={CELL}>
                      {extra} · {code}
                    </span>
                  </Zone>
                );
              })}
            </div>
          );
        })}
        {shuttles.map((s) => {
          const r = nextGuest();
          return (
            <div key={`s:${s.shuttle}:${s.name}`}>
              <Zone
                zones={["sections"]}
                {...zone}
                className="px-[5px] py-[3px] text-[9px] font-extrabold"
                style={{ background: SEC_SHUTTLE }}
              >
                {`SHUTTLE: ${s.name} // ${s.shuttle === "outbound" ? "OUTBOUND" : "INBOUND"} 1 PAX`}
              </Zone>
              <div className={ROW}>
                {r.slice(0, 5).map((c, j) => (
                  <span key={j} className={CELL}>
                    {c}
                  </span>
                ))}
                <span className={CELL}>1</span>
                <span className={CELL}>Adult (2 or older)</span>
              </div>
            </div>
          );
        })}
        <div
          className="relative grid border-t-2 border-[#222]"
          style={{
            gridTemplateColumns: `repeat(${foot.length}, minmax(0, 1fr))`,
          }}
        >
          {foot.map(([label, n, x]) =>
            x ? (
              <Zone
                key={label}
                zones={["extras"]}
                {...zone}
                className="border-r border-[#e4e6ea] bg-[#f1f2f4] px-[3px] py-[3px] text-[6.8px] text-[#666] uppercase"
              >
                {label}
                <b className="block text-[10px] text-[#222]">{n}</b>
              </Zone>
            ) : (
              <div
                key={label}
                className="border-r border-[#e4e6ea] px-[3px] py-[3px] text-[6.8px] text-[#666] uppercase"
              >
                {label}
                <b className="block text-[10px] text-[#222]">{n}</b>
              </div>
            ),
          )}
          {group.extras.length ? (
            <Mark zone="extras" className="-top-[11px] left-[30%]" />
          ) : null}
        </div>
      </div>
      <p className="-mt-1 mb-0 text-[11.5px] text-[#5f6b7a] night:text-white/55">
        The top bar and the bottom row print on every Bus Manifest page.
        Shuttles print last.
        {group.extras.length
          ? ""
          : " With an extra, its guests' rows are shaded and the bottom row shows NAME SEATS LEFT."}
      </p>

      <h5 className={H5}>
        Lunch sheet (only if the Lunch sheet line is filled in)
      </h5>
      {lunch.trim() ? (
        <div className={SHEET}>
          <div className="pt-[5px] text-center text-[10px] font-extrabold">
            Sat, Oct 10, 2026
          </div>
          <div className="pb-1 text-center text-[9px]">NPE Lunch Box</div>
          <div className="grid grid-cols-[1.4fr_.4fr_.6fr_.6fr_.8fr] border-b border-[#e4e6ea] px-1.5 py-1 font-semibold text-[#777]">
            <span>Lead Guest Name</span>
            <span>#</span>
            <span>Turkey</span>
            <span>Veggie</span>
            <span>Roast Beef</span>
          </div>
          <div
            className="px-[5px] py-[3px] text-[9px] font-extrabold"
            style={{ background: SEC_TOUR }}
          >
            {tourSections[0]?.name ?? defaultSection.toUpperCase()} {"{20}"}
          </div>
          <div className="grid grid-cols-[1.4fr_.4fr_.6fr_.6fr_.8fr] border-b border-[#e4e6ea] px-1.5 py-1">
            <span className="bg-[#fff3a3]">Maja Larsen</span>
            <span>2</span>
            <span>2</span>
            <span />
            <span />
          </div>
          <div className="grid grid-cols-[1.4fr_.4fr_.6fr_.6fr_.8fr] border-b border-[#e4e6ea] px-1.5 py-1">
            <span>Marta Silva</span>
            <span>2</span>
            <span>1</span>
            <span>1</span>
            <span />
          </div>
          <div className="px-1.5 py-1 text-[7.5px] font-bold">
            ALL GUESTS HIGHLIGHTED IN YELLOW WILL BE RECEIVING A TURKEY SANDWICH
            NO EXCEPTIONS.
          </div>
          <div className="px-1.5 pt-0.5 pb-1 text-[8px] text-[#555]">
            Bus # 2056=A · Tour Guide — · Driver —
          </div>
          <Zone
            zones={["lunch"]}
            {...zone}
            className="relative overflow-hidden border-t border-[#c7ccd3] p-1.5 text-center text-[9px] font-bold text-ellipsis whitespace-nowrap"
            style={{ background: "#fff27a" }}
          >
            {lunch}
          </Zone>
          <Mark zone="lunch" className="-right-[9px] -bottom-[9px]" />
        </div>
      ) : (
        <Zone
          zones={["lunch"]}
          {...zone}
          className="relative rounded-[8px] border border-dashed border-[#9aa5b3] bg-[#fbfcfd] px-2.5 py-2 text-[11.5px] text-[#555]"
        >
          <Mark zone="lunch" className="-top-[9px] -right-[9px]" />
          The Lunch sheet line is empty, so this tour prints no lunch sheet.
        </Zone>
      )}

      <h5 className={H5}>Dispatch page (not printed)</h5>
      <Zone
        zones={["perBus"]}
        {...zone}
        className="relative rounded-[8px] border border-dashed border-[#9aa5b3] bg-[#fbfcfd] px-2.5 py-2 text-[11.5px] text-[#333]"
      >
        <Mark zone="perBus" className="-top-[9px] -right-[9px]" />
        {group.display_name} · {dispatchGuests} guests at {perBusNumber} per bus
        →{" "}
        <span className="mt-1 mr-1 inline-block rounded-[5px] border border-[#c7ccd3] bg-white px-2 py-0.5">
          Bus A · {perBusNumber}
        </span>
        <span className="mt-1 mr-1 inline-block rounded-[5px] border border-[#c7ccd3] bg-white px-2 py-0.5">
          Bus B · {dispatchGuests - perBusNumber}
        </span>
      </Zone>

      <h5 className={H5}>60 Days Forecast (not printed)</h5>
      <div className="relative rounded-[8px] border border-dashed border-[#9aa5b3] bg-[#fbfcfd] px-2.5 py-2 text-[11.5px] text-[#333]">
        <Mark zone="split" className="-top-[9px] -right-[9px]" />
        <div className="text-[11px] text-[#555]">Sat, Oct 10</div>
        <div className="mt-1 text-[11px] tabular-nums">
          <div className="flex justify-between bg-[#f1f2f4] px-1.5 py-0.5 font-bold">
            <span>{group.display_name}</span>
            <span>56</span>
          </div>
          {tourSections
            .filter((s) => !split.some((x) => x.toUpperCase() === s.name))
            .map((s) => (
              <Zone
                key={s.name}
                zones={["sections", "extras"]}
                {...zone}
                className="flex justify-between border-b border-[#eef0f3] py-0.5 pr-1.5 pl-[18px]"
              >
                <span>
                  {s.name}
                  {s.extraCodes.length
                    ? ` (${[...new Set(s.extraCodes.map((x) => x.extra))].join(", ")} guests counted here)`
                    : ""}
                </span>
                <span>—</span>
              </Zone>
            ))}
          {shuttles.length ? (
            <div className="flex justify-between border-b border-[#eef0f3] py-0.5 pr-1.5 pl-[18px]">
              <span>Shuttle</span>
              <span>—</span>
            </div>
          ) : null}
          {split.map((s) => (
            <Zone
              key={s}
              zones={["split"]}
              {...zone}
              className="flex justify-between px-1.5 py-0.5 font-bold"
              style={{ background: "#fde7d6" }}
            >
              <span>
                {group.display_name} · {s.toUpperCase()} (own block)
              </span>
              <span>—</span>
            </Zone>
          ))}
        </div>
        {split.length ? null : (
          <Zone
            zones={["split"]}
            {...zone}
            className="mt-1 text-[10.5px] text-[#777]"
          >
            No own block for this tour (most tours leave it empty). A section
            typed in {PIN.split} gets its own block and Total here, like SUNSET
            on West Rim.
          </Zone>
        )}
      </div>
    </div>
  );
}
