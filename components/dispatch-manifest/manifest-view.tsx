"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorBanner, Panel } from "@/components/ui/panel";
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
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-6 sm:px-6">
        <Link href={backHref} className="text-sm text-sky-700 hover:underline">
          ‹ Back to Dispatch
        </Link>

        {view.kind === "bad-link" ? (
          <Panel>
            <p className="font-medium text-stone-800">
              This link is missing the day or the tour.
            </p>
            <p className="mt-1">
              Open the manifest from{" "}
              <Link href="/dispatch" className="text-sky-700 underline">
                Dispatch
              </Link>
              .
            </p>
          </Panel>
        ) : view.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">Staff access required</p>
          </Panel>
        ) : view.kind === "error" ? (
          <ErrorBanner
            actionLabel="Retry"
            onAction={() => setReloadKey((k) => k + 1)}
          >
            Could not load this manifest: {view.message}
          </ErrorBanner>
        ) : view.kind === "loading" || !data || !params ? (
          <p className="py-10 text-center text-sm text-stone-500">Loading…</p>
        ) : (
          <>
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
                  Dispatch · Tour manifest
                </span>
                <h1 className="text-2xl font-semibold text-stone-900">
                  {data.tour.name}
                </h1>
                <p className="text-sm text-stone-500">
                  {data.date_label} ·{" "}
                  {data.manifest
                    ? `${data.totals.guests} orders, ${data.totals.pax} pax · file ${data.manifest.file_name}`
                    : "no CSV uploaded yet"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.manifest && data.blocks.length > 0 ? (
                  <a
                    href={manifestPrintUrl(params.date, params.tour)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md bg-[#185FA5] px-4 py-2 text-sm font-medium text-white hover:bg-[#134c85]"
                  >
                    Print all buses
                  </a>
                ) : null}
                <form method="post" action={MANIFEST_DOWNLOAD_URL}>
                  <input type="hidden" name="date" value={params.date} />
                  <input type="hidden" name="tour" value={params.tour} />
                  <button
                    type="submit"
                    disabled={!data.manifest}
                    className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
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
              <ErrorBanner
                actionLabel="Dismiss"
                onAction={() => setActionError(null)}
              >
                {actionError}
              </ErrorBanner>
            ) : null}

            {data.blocks.map((block) => (
              <section
                key={block.bus.id}
                aria-label={`Bus ${block.bus_number}`}
                className="overflow-hidden rounded-lg border border-stone-300 bg-white font-[Arial,Helvetica,sans-serif]"
              >
                <div
                  className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5"
                  style={{ background: data.tour.band_color }}
                >
                  <span className="text-[22px] font-extrabold">
                    {data.tour.name}
                  </span>
                  <Person label="Driver" value={block.bus.driver} />
                  <Person label="Guide" value={block.bus.guide} />
                  <span className="ml-auto text-sm font-semibold">
                    {data.date_label}
                  </span>
                  <span className="text-sm font-extrabold">
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
                      className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-stone-800 hover:bg-stone-100"
                    >
                      Print
                    </a>
                  ) : null}
                  {/* 导游看到的样子（导游还没账号时 staff 从这里看，同旧页面）：后端渲染的页面，新标签页打开。 */}
                  <a
                    href={manifestGuideUrl(block.bus.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-stone-800 hover:bg-stone-100"
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
              <section
                aria-label="Not on a bus yet"
                className="overflow-hidden rounded-lg border border-orange-300 bg-white font-[Arial,Helvetica,sans-serif]"
              >
                <div className="bg-orange-100 px-4 py-2.5 text-lg font-extrabold text-orange-900">
                  Not on a bus yet · {data.unplaced.totals.pax} pax
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
  return (
    <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      {children}
    </p>
  );
}

function Person({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-xs font-semibold uppercase">{label}:</span>
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
      <p className="px-4 py-6 text-sm text-stone-500">
        No guests on this bus yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse text-[13.5px]">
        <thead>
          <tr className="bg-[#e6eaee] text-left text-[11px] font-bold">
            {COLUMNS.map((c) => (
              <th key={c} className="border border-stone-300 px-2 py-1.5">
                {c}
              </th>
            ))}
            {lettered ? (
              <th className="border border-stone-300 px-2 py-1.5">Bus</th>
            ) : null}
            <th className="border border-stone-300 px-2 py-1.5">✓</th>
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
          className="border border-stone-300 px-2 py-1 text-center text-sm font-bold"
          style={{ background: color }}
        >
          {s.heading}
        </td>
      </tr>
      {s.guests.map((g) => (
        <tr key={g.id} data-guest={g.order_number}>
          <td className="border border-stone-300 px-2 py-1 font-mono text-[13px]">
            {g.order_number}
          </td>
          <td className="border border-stone-300 px-2 py-1">{g.pickup_time}</td>
          <td className="border border-stone-300 px-2 py-1">
            {g.pickup_location}
          </td>
          <td className="border border-stone-300 px-2 py-1">{g.last_name}</td>
          <td className="border border-stone-300 px-2 py-1">{g.first_name}</td>
          <td className="border border-stone-300 px-2 py-1">{g.phone}</td>
          <td className="border border-stone-300 px-2 py-1 text-center text-[15px] font-extrabold">
            {g.pax}
          </td>
          <td
            className={cn(
              "border border-stone-300 px-2 py-1",
              g.ticket_hl && "bg-[#fff200]",
            )}
          >
            {g.ticket}
            {s.kind !== "tour" &&
            !g.ticket.toUpperCase().includes(SHUTTLE_WORD[s.kind]) ? (
              <b className="text-red-600"> {SHUTTLE_WORD[s.kind]}</b>
            ) : null}
          </td>
          <td
            className={cn(
              "border border-stone-300 px-2 py-1",
              g.notes && "bg-[#fff200]",
              g.notes_check &&
                "min-w-[220px] text-xs whitespace-pre-wrap text-red-600",
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
            <td className="border border-stone-300 px-1 py-1">
              <BusSelect
                guest={g}
                labels={data.bus_labels}
                onChange={onBusChange}
              />
            </td>
          ) : null}
          <td className="border border-stone-300 px-1 py-1 text-center">
            {g.boarding === "boarded" ? (
              <span className="rounded-full bg-emerald-100 px-1.5 text-xs font-semibold text-emerald-800">
                ✓
              </span>
            ) : g.boarding === "no_show" ? (
              <span className="rounded-full bg-red-100 px-1.5 text-xs font-semibold text-red-700">
                No show
              </span>
            ) : null}
          </td>
        </tr>
      ))}
      {attraction && s.kind === "tour" && s.attraction ? (
        <tr>
          <td colSpan={cols} className="border border-stone-300 p-0">
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
        "rounded border px-1 py-0.5 text-sm",
        unset ? "border-orange-400 bg-orange-50" : "border-stone-300",
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
      className="flex flex-wrap items-end gap-3 px-3 py-2"
      style={{ background: color }}
      onBlur={(e) => {
        // 焦点还在这个框里（换到下一格）就先不存。
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          void save();
        }
      }}
    >
      <span className="self-center text-sm font-bold">
        {section.title} Confirmation Information
      </span>
      {ATTR_FIELDS.map(([k, label]) => (
        <label key={k} className="flex flex-col text-[11px] font-semibold">
          {label}
          <input
            value={values[k]}
            maxLength={ATTR_LEN[k]}
            onChange={(e) => setValues({ ...values, [k]: e.target.value })}
            className="w-32 rounded border border-stone-400 bg-white/80 px-1.5 py-0.5 text-sm font-normal"
          />
        </label>
      ))}
      <span role="status" className="self-center text-xs font-semibold">
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
      </span>
    </div>
  );
}

function Footer({ cells }: { cells: ManifestFooterCell[] }) {
  if (!cells.length) return null;
  return (
    <div className="flex flex-wrap gap-1 border-t border-stone-300 p-2">
      {cells.map((c) => (
        <div
          key={c.label}
          className="flex min-w-[90px] flex-col overflow-hidden rounded border border-stone-300 text-center"
        >
          <span
            className={cn(
              "px-2 py-1 text-[11px] font-extrabold uppercase",
              c.custom ? "bg-[#ddd0f0]" : "bg-[#c9d3dc]",
            )}
          >
            {c.label}
          </span>
          <span className="py-1 text-[22px] font-extrabold">
            {c.value ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function HowToUse() {
  return (
    <details className="max-w-3xl rounded-lg border border-sky-200 bg-sky-50 px-5 py-4 text-sm leading-relaxed text-stone-700">
      <summary className="cursor-pointer font-semibold text-sky-900">
        📖 How to use — Tour manifest
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
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
          To change the guest list, go back to Dispatch and click Re-upload CSV
          on this tour.
        </li>
      </ol>
    </details>
  );
}
