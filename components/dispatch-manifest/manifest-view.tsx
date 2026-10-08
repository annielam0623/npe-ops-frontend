"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { fmtShort } from "@/components/dispatch/config";
import { hasInAppHistory } from "@/components/nav/in-app-history";
import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  ATTR_LEN,
  fetchManifest,
  MANIFEST_DOWNLOAD_URL,
  manifestGuideUrl,
  manifestPrintUrl,
  saveAttraction,
  setGuestBus,
} from "@/lib/dispatch-manifest-api";
import { isYmd } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type {
  ManifestFooterCell,
  ManifestGuest,
  ManifestSection,
  ManifestView as ManifestData,
} from "@/types";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "bad-link" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ManifestData };

const COLUMNS = [
  "Order Number",
  "Pick-up Time",
  "Pick-up Location",
  "Last Name",
  "First Name",
  "Customer Phone",
  "#",
  "Quantities",
  "Special Requirements",
] as const;

// 样子照旧后台 admin/tour_manifest.html（Annie 2026-10-07：和旧版一模一样）。
/** .mf-nav a.back */
const NAV_LINK =
  "inline-flex h-7 items-center rounded-lg border border-[rgba(147,197,253,.35)] px-[11px] text-[13px] text-[#93c5fd] no-underline hover:bg-white/[.07]";
/** .mf-warn */
const WARN =
  "mb-3.5 rounded-[10px] border border-[rgba(251,191,36,.34)] bg-[rgba(251,191,36,.10)] px-3.5 py-2.5 text-[13px] text-[#fde68a]";
/** .mf-card */
const CARD =
  "mb-[22px] overflow-hidden rounded-[10px] bg-white px-3 pt-2.5 pb-3 font-[Arial,'Helvetica_Neue',Helvetica,sans-serif] text-[#111]";
/** .mf-band a.print */
const BAND_LINK =
  "inline-flex h-7 items-center rounded-[7px] border border-black/25 bg-white px-3 text-[12px] font-bold text-[#111] no-underline";
/** .mf-card th / td */
const TH =
  "border border-[#9aa] bg-[#e6eaee] px-1.5 py-1 text-left text-[10.5px] font-bold whitespace-nowrap";
const TD =
  "border border-[#c8ced2] px-[7px] py-[3px] align-middle text-[13.5px] whitespace-nowrap";

/**
 * 一个团、一天的 manifest，照纸本版式（同旧页面 /admin/dispatch/manifest）。
 * 车来自排车页已保存的排车，客人来自上传的 Rezdy CSV。
 */
export function ManifestView() {
  const [params, setParams] = useState<{ date: string; tour: number } | null>(
    null,
  );
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const redirectingRef = useRef(false);
  const router = useRouter();

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const date = q.get("date");
    const tour = Number(q.get("tour"));
    if (!isYmd(date) || !Number.isInteger(tour) || tour <= 0) {
      setView({ kind: "bad-link" });
      return;
    }
    setParams({ date, tour });
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!params) return;
      try {
        const data = await fetchManifest(params.date, params.tour, signal);
        if (!signal?.aborted) setView({ kind: "ready", data });
      } catch (error) {
        if (signal?.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setView({ kind: "forbidden" });
        else setView({ kind: "error", message: describeError(error) });
      }
    },
    [params, redirectToLogin],
  );

  useEffect(() => {
    if (!params) return;
    const controller = new AbortController();
    setView((v) => (v.kind === "ready" ? v : { kind: "loading" }));
    void load(controller.signal);
    return () => controller.abort();
  }, [params, reloadKey, load]);

  function onActionError(error: unknown) {
    if (isStatus(error, 401)) redirectToLogin();
    else setActionError(describeError(error));
  }

  async function changeBus(guest: ManifestGuest, label: string) {
    setActionError(null);
    try {
      await setGuestBus(guest.id, label || null);
    } catch (error) {
      onActionError(error);
      throw error;
    }
    // 已经存好了；重读失败只提示，不把整页换成错误。
    if (!params) return;
    try {
      const data = await fetchManifest(params.date, params.tour);
      setView({ kind: "ready", data });
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else
        setActionError(
          `The bus was saved, but the page could not be refreshed: ${describeError(error)} Reload the page.`,
        );
    }
  }

  const data = view.kind === "ready" ? view.data : null;
  const backHref = params ? `/dispatch?date=${params.date}` : "/dispatch";

  return (
    <main className="text-stone-800">
      <div>
        {/* 后端 G29 第 5 条（2026-10-05）：‹ Back 回到点进来的那一页（排车页回去还是那一天、原来的位置）；
            直接打开的 ⇒ 去排车页的这一天。Dispatch · <日子> 不管从哪来都打开排车页的这一天。 */}
        <nav aria-label="Back" className="flex flex-wrap gap-2">
          <Link
            href={backHref}
            onClick={(e) => {
              if (!hasInAppHistory()) return;
              e.preventDefault();
              router.back();
            }}
            className={NAV_LINK}
          >
            ‹ Back
          </Link>
          <Link href={backHref} className={NAV_LINK}>
            {params ? `Dispatch · ${fmtShort(params.date)}` : "Dispatch"}
          </Link>
        </nav>

        {view.kind === "bad-link" ? (
          <div className={cn(WARN, "mt-3.5")}>
            <p className="font-medium">
              This link is missing the day or the tour.
            </p>
            <p className="mt-1">
              Open the manifest from{" "}
              <Link href="/dispatch" className="text-[#93c5fd] underline">
                Dispatch
              </Link>
              .
            </p>
          </div>
        ) : view.kind === "forbidden" ? (
          <p className="mt-3.5 text-[13px] text-[#94a3b8]">
            Staff access required
          </p>
        ) : view.kind === "error" ? (
          <div className="mt-3.5">
            <ErrorBanner
              actionLabel="Retry"
              onAction={() => setReloadKey((k) => k + 1)}
            >
              Could not load this manifest: {view.message}
            </ErrorBanner>
          </div>
        ) : view.kind === "loading" || !data || !params ? (
          <p className="py-10 text-center text-[13px] text-[#94a3b8]">
            Loading…
          </p>
        ) : (
          <>
            {/* .mf-head：标题和返回键在左、Print all / Download 在右 */}
            <header className="mt-1 mb-3.5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="m-0 text-[24px] font-bold tracking-[-.02em] text-white">
                  {data.tour.name}
                </h1>
                <p className="mt-1 text-[13px] text-[#94a3b8]">
                  {data.date_label} ·{" "}
                  {data.manifest
                    ? `${data.totals.guests} orders, ${data.totals.pax} pax · file ${data.manifest.file_name}`
                    : "no CSV uploaded yet"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {data.manifest && data.blocks.length > 0 ? (
                  <a
                    href={manifestPrintUrl(params.date, params.tour)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-[15px] text-[12.5px] font-semibold text-white no-underline"
                  >
                    Print all buses
                  </a>
                ) : null}
                <form
                  method="post"
                  action={MANIFEST_DOWNLOAD_URL}
                  className="m-0"
                >
                  <input type="hidden" name="date" value={params.date} />
                  <input type="hidden" name="tour" value={params.tour} />
                  <button
                    type="submit"
                    disabled={!data.manifest}
                    className="inline-flex h-8 cursor-pointer items-center rounded-[9px] border border-white/[.18] bg-transparent px-[13px] text-[12.5px] text-[#cbd5e1] hover:bg-white/[.07] disabled:cursor-default disabled:opacity-50"
                  >
                    Download
                  </button>
                </form>
              </div>
            </header>

            {!data.manifest ? (
              <Warn>
                No Rezdy CSV has been uploaded for this tour on this day. Go
                back to Dispatch and click Upload Rezdy CSV.
              </Warn>
            ) : null}
            {data.mode === "none" ? (
              <Warn>
                No bus is scheduled for this tour on this day yet. Add one on
                the Dispatch page and click Save schedule.
              </Warn>
            ) : data.mode === "unlettered" ? (
              <Warn>
                This tour has more than one bus, but not every bus has its own
                letter. Give each bus a letter (A, B ...) on the Dispatch page
                and click Save schedule. Until then no guest can be put on a
                bus.
              </Warn>
            ) : null}

            {actionError ? (
              // .mf-err
              <div
                role="alert"
                className="mb-3.5 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[rgba(239,68,68,.35)] bg-[rgba(239,68,68,.12)] px-3.5 py-2.5 text-[13px] text-[#fecaca]"
              >
                <span>{actionError}</span>
                <button
                  type="button"
                  onClick={() => setActionError(null)}
                  className="text-[12px] text-[#fecaca] underline"
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            {data.blocks.map((block) => (
              <section
                key={block.bus.id}
                aria-label={`Bus ${block.bus_number}`}
                className={CARD}
              >
                {/* .mf-band */}
                <div
                  className="flex flex-wrap items-end gap-[22px] rounded-[3px] px-3 py-1.5"
                  style={{ background: data.tour.band_color }}
                >
                  <span className="text-[22px] font-extrabold">
                    {data.tour.name}
                  </span>
                  <Person label="Driver" value={block.bus.driver} />
                  <Person label="Guide" value={block.bus.guide} />
                  <span className="ml-auto text-[15px] font-bold">
                    {data.date_label}
                  </span>
                  <span className="text-[14px] font-extrabold">
                    BUS #: {block.bus_number}
                  </span>
                  {data.manifest ? (
                    <a
                      href={manifestPrintUrl(
                        params.date,
                        params.tour,
                        block.bus.id,
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={BAND_LINK}
                    >
                      Print
                    </a>
                  ) : null}
                  {/* 导游看到的样子（导游还没账号时 staff 从这里看，同旧页面）：后端渲染的页面，新标签页打开。 */}
                  <a
                    href={manifestGuideUrl(block.bus.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={BAND_LINK}
                  >
                    Guide view
                  </a>
                </div>
                <GuestTable
                  data={data}
                  sections={block.sections}
                  onBusChange={changeBus}
                  attraction={
                    data.manifest
                      ? {
                          tourManifestId: data.manifest.id,
                          busKey: block.bus_key,
                          onError: onActionError,
                        }
                      : null
                  }
                />
                <Footer cells={block.footer} />
              </section>
            ))}

            {data.unplaced.sections.length > 0 ? (
              <section aria-label="Not on a bus yet" className={CARD}>
                {/* 旧页同样是一个 .mf-card + 团色条，标题写 Not on a bus yet。 */}
                <div
                  className="flex flex-wrap items-end gap-[22px] rounded-[3px] px-3 py-1.5"
                  style={{ background: data.tour.band_color }}
                >
                  <span className="text-[22px] font-extrabold">
                    Not on a bus yet · {data.unplaced.totals.pax} pax
                  </span>
                  <span className="ml-auto text-[15px] font-bold">
                    {data.date_label}
                  </span>
                </div>
                <GuestTable
                  data={data}
                  sections={data.unplaced.sections}
                  onBusChange={changeBus}
                  attraction={null}
                />
              </section>
            ) : null}

            <HowToUse />
          </>
        )}
      </div>
    </main>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return <p className={WARN}>{children}</p>;
}

function Person({ label, value }: { label: string; value: string }) {
  return (
    // .mf-band .kv：小字标签在上、斜体名字在下
    <span className="flex flex-col">
      <span className="text-[10px] opacity-75">{label}:</span>
      <span className="text-[17px] font-bold italic">{value || "—"}</span>
    </span>
  );
}

const SHUTTLE_WORD: Record<string, string> = {
  outbound: "OUTBOUND",
  inbound: "INBOUND",
};

function sectionColor(data: ManifestData, s: ManifestSection): string {
  if (s.color) return s.color;
  if (s.kind === "tour") return data.tour.section_color;
  return data.shuttle_colors[s.kind];
}

function GuestTable({
  data,
  sections,
  onBusChange,
  attraction,
}: {
  data: ManifestData;
  sections: ManifestSection[];
  onBusChange: (guest: ManifestGuest, label: string) => Promise<void>;
  /** 有车、有 manifest 时才有黄框。 */
  attraction: {
    tourManifestId: number;
    busKey: string;
    onError: (e: unknown) => void;
  } | null;
}) {
  const lettered = data.mode === "lettered";
  const cols = COLUMNS.length + (lettered ? 1 : 0) + 1;
  if (sections.length === 0) {
    return (
      <p className="px-1 py-3.5 text-[13px] text-[#4a5568]">
        No guests on this bus yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="mt-1.5 w-full min-w-[980px] border-collapse">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c} className={TH}>
                {c}
              </th>
            ))}
            {lettered ? <th className={TH}>Bus</th> : null}
            <th className={TH}>✓</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((s) => (
            <SectionRows
              key={s.key}
              data={data}
              section={s}
              cols={cols}
              lettered={lettered}
              onBusChange={onBusChange}
              attraction={attraction}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionRows({
  data,
  section: s,
  cols,
  lettered,
  onBusChange,
  attraction,
}: {
  data: ManifestData;
  section: ManifestSection;
  cols: number;
  lettered: boolean;
  onBusChange: (guest: ManifestGuest, label: string) => Promise<void>;
  attraction: {
    tourManifestId: number;
    busKey: string;
    onError: (e: unknown) => void;
  } | null;
}) {
  const color = sectionColor(data, s);
  return (
    <>
      <tr>
        <td
          colSpan={cols}
          className={cn(TD, "text-center text-[14px] font-extrabold")}
          style={{ background: color }}
        >
          {s.heading}
        </td>
      </tr>
      {s.guests.map((g) => (
        <tr key={g.id} data-guest={g.order_number}>
          <td className="border border-[#c8ced2] px-[7px] py-[3px] align-middle font-['Courier_New',monospace] text-[13px] whitespace-nowrap">
            {g.order_number}
          </td>
          <td className={TD}>{g.pickup_time}</td>
          <td className={TD}>{g.pickup_location}</td>
          <td className={TD}>{g.last_name}</td>
          <td className={TD}>{g.first_name}</td>
          <td className={TD}>{g.phone}</td>
          <td className="border border-[#c8ced2] px-[7px] py-[3px] text-center align-middle text-[15px] font-extrabold whitespace-nowrap">
            {g.pax}
          </td>
          <td className={cn(TD, g.ticket_hl && "bg-[#fff200] font-bold")}>
            {g.ticket}
            {s.kind !== "tour" &&
            !g.ticket.toUpperCase().includes(SHUTTLE_WORD[s.kind]) ? (
              <b className="font-extrabold text-[#d00000]">
                {" "}
                {SHUTTLE_WORD[s.kind]}
              </b>
            ) : null}
          </td>
          <td
            className={cn(
              "border border-[#c8ced2] px-[7px] py-[3px] align-middle text-[13.5px]",
              g.notes && "bg-[#fff200] font-bold",
              g.notes_check
                ? "min-w-[220px] whitespace-pre-wrap text-[#d00000]"
                : "whitespace-nowrap",
            )}
            title={
              g.notes_check
                ? "Sandwiches could not be read: this is the full Rezdy text. Check the booking."
                : undefined
            }
          >
            {g.notes}
          </td>
          {lettered ? (
            <td className={TD}>
              <BusSelect
                guest={g}
                labels={data.bus_labels}
                onChange={onBusChange}
              />
            </td>
          ) : null}
          <td className={TD}>
            {g.boarding === "boarded" ? (
              <span className="rounded-full bg-[#e6f4ec] px-[7px] py-px text-[11px] font-bold whitespace-nowrap text-[#1e6b43]">
                ✓
              </span>
            ) : g.boarding === "no_show" ? (
              <span className="rounded-full bg-[#fdeceb] px-[7px] py-px text-[11px] font-bold whitespace-nowrap text-[#b3261e]">
                No show
              </span>
            ) : null}
          </td>
        </tr>
      ))}
      {attraction && s.kind === "tour" && s.attraction ? (
        <tr>
          <td colSpan={cols} className="border-0 px-0 py-0.5">
            <AttractionBox
              section={s}
              color={color}
              tourManifestId={attraction.tourManifestId}
              busKey={attraction.busKey}
              onError={attraction.onError}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function BusSelect({
  guest,
  labels,
  onChange,
}: {
  guest: ManifestGuest;
  labels: string[];
  onChange: (guest: ManifestGuest, label: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const value = guest.bus_label ?? "";
  const unset = !value || !labels.includes(value);
  return (
    <select
      aria-label={`Bus for ${guest.name}`}
      value={value}
      disabled={busy}
      onChange={async (e) => {
        setBusy(true);
        try {
          await onChange(guest, e.target.value);
        } catch {
          // 原因已经显示在上面；下拉回到原值（数据没变）。
        } finally {
          setBusy(false);
        }
      }}
      className={cn(
        // .mf-card select.bus（.unset 橙框）
        "h-[26px] rounded-md px-1 font-[inherit] text-[12px] text-[#111]",
        unset
          ? "border border-[#e0a63a] bg-[#fffaf0]"
          : "border-[0.5px] border-black/25 bg-white",
      )}
    >
      <option value="">—</option>
      {value && !labels.includes(value) ? (
        <option value={value}>{value}</option>
      ) : null}
      {labels.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );
}

const ATTR_FIELDS = [
  ["checkin_time", "Check-in Time"],
  ["pax_text", "# of Pax"],
  ["tour_time", "Tour Time"],
  ["confirmation_no", "Confirmation"],
] as const;

type AttrKey = (typeof ATTR_FIELDS)[number][0];

/** 黄框：离开框时有改动才存（旧页面每次失焦都存，没改也存）。 */
function AttractionBox({
  section,
  color,
  tourManifestId,
  busKey,
  onError,
}: {
  section: ManifestSection;
  color: string;
  tourManifestId: number;
  busKey: string;
  onError: (e: unknown) => void;
}) {
  const initial = section.attraction!;
  const [values, setValues] = useState<Record<AttrKey, string>>({
    checkin_time: initial.checkin_time,
    pax_text: initial.pax_text,
    tour_time: initial.tour_time,
    confirmation_no: initial.confirmation_no,
  });
  const savedRef = useRef(values);
  const [status, setStatus] = useState<"" | "saving" | "saved">("");

  async function save() {
    const same = ATTR_FIELDS.every(
      ([k]) => values[k].trim() === savedRef.current[k].trim(),
    );
    if (same) return;
    setStatus("saving");
    try {
      await saveAttraction({
        tourManifestId,
        busKey,
        section: section.key,
        ...values,
      });
      savedRef.current = values;
      setStatus("saved");
    } catch (error) {
      setStatus("");
      onError(error);
    }
  }

  return (
    <div
      role="group"
      aria-label={`${section.title} Confirmation Information`}
      // .mf-attr：旧页只在节有自己的颜色时才换底色，否则是黄色 #fff27a。
      className="my-0.5 grid max-w-[820px] grid-cols-[repeat(auto-fit,minmax(140px,1fr))] items-end gap-x-3 gap-y-1.5 rounded border border-[#c9b200] bg-[#fff27a] px-2.5 py-1.5"
      style={section.color ? { background: color } : undefined}
      onBlur={(e) => {
        // 焦点还在这个框里（换到下一格）就先不存。
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          void save();
        }
      }}
    >
      <div className="col-span-full text-[11px] font-extrabold">
        {section.title} Confirmation Information
      </div>
      {ATTR_FIELDS.map(([k, label]) => (
        <label
          key={k}
          className="flex flex-col gap-0.5 text-[10.5px] font-bold"
        >
          {label}
          <input
            value={values[k]}
            maxLength={ATTR_LEN[k]}
            onChange={(e) => setValues({ ...values, [k]: e.target.value })}
            className="h-7 rounded-[5px] border-[0.5px] border-black/30 bg-white px-2 font-[inherit] text-[13px] font-normal text-[#111]"
          />
        </label>
      ))}
      <span role="status" className="text-[11px] text-[#1e6b43]">
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
      </span>
    </div>
  );
}

function Footer({ cells }: { cells: ManifestFooterCell[] }) {
  if (!cells.length) return null;
  return (
    // .mf-foot：一排连在一起的格子
    <div className="mt-2.5 flex overflow-x-auto border border-[#9aa]">
      {cells.map((c) => (
        <div
          key={c.label}
          className="flex min-w-[92px] flex-[1_1_0] flex-col items-center border-r border-[#9aa] last:border-r-0"
        >
          <span
            className={cn(
              "flex h-8 w-full items-center justify-center px-[3px] py-0.5 text-center text-[11px] leading-[1.2] font-extrabold text-[#222] uppercase",
              c.custom ? "bg-[#ddd0f0]" : "bg-[#c9d3dc]",
            )}
          >
            {c.label}
          </span>
          <span className="py-[3px] text-[22px] font-extrabold">
            {c.value ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function HowToUse() {
  return (
    // .howto-d（旧页的蓝框，默认收起）
    <details className="group mt-6 mb-8 max-w-[760px] rounded-[10px] border border-[#b5d4f4] bg-[#e8f3fc] px-5 py-3 text-[12px] leading-[1.9] text-[#0c3a6b]">
      <summary className="cursor-pointer font-semibold text-[#185FA5] group-open:mb-1.5">
        📖 How to use — Tour manifest
      </summary>
      <ol className="list-decimal pl-[18px]">
        <li>
          This page shows one tour for one day, laid out like the paper
          manifest. Each bus on the Dispatch schedule gets its own block.
        </li>
        <li>
          If the tour has two or more buses, pick a bus for every guest in the
          Bus column. Guests without a bus are marked orange and listed under
          Not on a bus yet.
        </li>
        <li>
          Fill in the yellow box under a section (Check-in time, # of Pax, Tour
          time, Confirmation). It saves when you leave the box. Only sections
          with something filled in print a yellow box.
        </li>
        <li>
          Red text under Special Requirements means the sandwiches could not be
          read, so the full Rezdy text is shown. Check the booking in Rezdy and
          tell the lunch place.
        </li>
        <li>
          Click Print on a bus (or Print all buses), then Print in the new tab.
          It prints on A4 landscape and goes onto more pages when needed. The
          lunch sheet prints after it for tours that have one. Guests not on a
          bus yet are not printed; the print tab says how many.
        </li>
        <li>Click Download for an Excel copy with the same columns.</li>
        <li>
          Sections, colours and the boxes at the bottom come from Settings →
          Products (Manifest setup). Seats come from Settings → Vehicles.
        </li>
        <li>
          Back returns to the page you came from. The Dispatch button opens
          Dispatch on this manifest&rsquo;s day.
        </li>
        <li>
          To change the guest list, go back to Dispatch and click Re-upload CSV
          on this tour.
        </li>
      </ol>
    </details>
  );
}
