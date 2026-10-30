"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  BTN_DELETE_CLASS,
  BTN_EDIT_CLASS,
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CARD_TITLE_CLASS,
  HEADER_SEARCH_CLASS,
  INLINE_INPUT_BASE,
  INLINE_INPUT_CLASS,
  LegacyHowTo,
  LegacyPageHeader,
  resultClass,
  TBODY_CLASS,
  TD_CLASS,
  TH_CLASS,
  TR_CLASS,
  TR_HOVER,
} from "@/components/pickup-locations/legacy-ui";
import { byTick } from "@/lib/by-tick";
import { usePermissions } from "@/lib/staff-permissions";
import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import { fetchActionLog } from "@/lib/action-log";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import {
  addDictionaryTerm,
  deleteAirline,
  deleteDictionaryTerm,
  deleteEvent,
  deletePlace,
  fetchTcqSettings,
  saveAirline,
  saveEvent,
  savePlace,
  saveTerms,
  saveVehicle,
} from "@/lib/tcq-api";
import { cn } from "@/lib/utils";
import type {
  TcqAirline,
  TcqDictionaryTerm,
  TcqEvent,
  TcqPlace,
  TcqSettings,
  TcqTerm,
  TcqVehicle,
  TcqVehicleInput,
} from "@/types/tcq";

import { parseDollars } from "./config";

type View =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: TcqSettings };

type Result = { tone: "ok" | "error"; text: string } | null;

/** 白卡片上的提交键（Annie 2026-10-11：蓝色只给提交）。 */
const SAVE_SMALL =
  "h-[30px] cursor-pointer rounded-[7px] bg-[#3b82f6] px-3 text-[11px] font-semibold whitespace-nowrap text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-60";
const SAVE_BIG =
  "h-9 cursor-pointer rounded-[7px] bg-[#3b82f6] px-5 text-[13px] font-semibold whitespace-nowrap text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-60";
const NOTE = "text-[11.5px] text-[#1a1a1a] night:text-white/50";
/** 价目表一行 17 格：格子窄一点，1440 宽的屏幕上 Save 不用横着拉。 */
const NUM_TD = "px-1 py-[9px] align-middle";
const NUM_TH = TH_CLASS.replace("px-3", "px-1");

const DICT_LABEL: Record<string, { title: string; hint: string }> = {
  arrival: {
    title: "Airport pickup",
    hint: "a line with one of these is a pickup",
  },
  departure: {
    title: "Airport drop-off",
    hint: "a line with one of these is a drop-off",
  },
  charter: {
    title: "Charter",
    hint: "a line with one of these is an hourly charter",
  },
  pax: { title: "People", hint: "after a number, e.g. 4 pax" },
  hours: { title: "Hours", hint: "after a number, e.g. 6 hours" },
  full_day: {
    title: "All day",
    hint: "means the full-day hours in Charges and terms",
  },
};

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Settings → Transfer & Charter（admin，后端 G66 阶段二；Annie 2026-10-15 看预览同意）：
 * 价目表（每行 Save，车型不删只停用）、活动日历、费用和条款、读取用的词、航空公司、地点。
 * 改完下一次读取 / 下一张报价立即用新的；已经生成的报价不变（W9）。版式照别的 Settings 页（白卡片 + 表格）。
 */
export function TcqSettingsView() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  // 全部按照勾选（Annie 2026-10-30 置顶 10c）：开关开着按勾（quotation.rates_edit，同后端接口），关着照旧；Super Admin 全过。
  const tickPerms = usePermissions();
  const tickPermsRef = useRef(tickPerms);
  tickPermsRef.current = tickPerms;
  useEffect(() => {
    // 权限读完再判断（开关开着时要按勾）。
    if (!tickPerms.ready) return;
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      try {
        const me = await fetchCurrentUser(signal);
        if (signal.aborted) return;
        if (
          !byTick(tickPermsRef.current, "quotation.rates_edit", {
            legacy: me.is_admin,
            superAdmin: !!me.is_superadmin,
          })
        ) {
          setView({ kind: "forbidden" });
          return;
        }
        const data = await fetchTcqSettings(signal);
        if (!signal.aborted) setView({ kind: "ready", data });
      } catch (error) {
        if (signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setView({ kind: "forbidden" });
        else setView({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [reloadKey, redirectToLogin, tickPerms.ready, tickPerms.active]);

  return (
    <main className="text-stone-800 night:text-white/90">
      <LegacyPageHeader
        title="🚐 Transfer & Charter"
        count={
          view.kind === "ready"
            ? `${view.data.vehicles.filter((v) => v.is_active).length} vehicles on the rate card`
            : null
        }
      />
      {view.kind === "loading" ? (
        <Panel>Loading…</Panel>
      ) : view.kind === "forbidden" ? (
        <Panel>
          <p className="font-medium text-stone-800 night:text-white/90">
            Admin access required
          </p>
          <p className="mt-1">
            Only admins can change the Transfer & Charter rate card and terms.
          </p>
        </Panel>
      ) : view.kind === "error" ? (
        <ErrorBanner
          actionLabel="Retry"
          onAction={() => setReloadKey((k) => k + 1)}
        >
          Could not load Transfer & Charter settings: {view.message}
        </ErrorBanner>
      ) : (
        <>
          <LegacyHowTo title="How to use">
            <li>
              These are the prices and words My Workspace uses for{" "}
              <b>Transfer & Charter Quotation</b>. A change takes effect on the
              next email read and the next quote. Quotes already generated keep
              their prices.
            </li>
            <li>
              <b>Vehicle rates</b>: dollars, hours in half hours. A vehicle is
              never deleted — untick On and it stops appearing on new quotes.
              Gratuity / day empty means that vehicle&apos;s gratuity can only
              go in the terms wording.
            </li>
            <li>
              <b>Event calendar</b>: charters on these dates use the event price
              when Rate is Auto. Minimum days only warns.
            </li>
            <li>
              <b>Charges and terms</b>: the numbers fill the {"{placeholders}"}{" "}
              in the wording. Inclusions, Not included and Pricing assumptions
              are the defaults; staff can change them on each quote.
            </li>
            <li>
              <b>Reading words</b>, <b>Airlines</b> and <b>Places</b> decide how
              an email is read. Add a word or another name, then read the email
              again — no code change.
            </li>
            <li>Each row or section has its own Save.</li>
          </LegacyHowTo>
          <nav
            aria-label="Sections"
            className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] font-semibold"
          >
            {[
              ["tcq-vehicles", "Vehicle rates"],
              ["tcq-events", "Event calendar"],
              ["tcq-terms", "Charges and terms"],
              ["tcq-words", "Reading words"],
              ["tcq-airlines", "Airlines"],
              ["tcq-places", "Places"],
            ].map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="text-[#7dd3fc] hover:text-white"
              >
                {label}
              </a>
            ))}
          </nav>
          <Vehicles
            rows={view.data.vehicles}
            onUnauthorized={redirectToLogin}
          />
          <Events rows={view.data.events} onUnauthorized={redirectToLogin} />
          <Terms rows={view.data.terms} onUnauthorized={redirectToLogin} />
          <Words
            rows={view.data.dictionary}
            kinds={view.data.dictionary_kinds}
            onUnauthorized={redirectToLogin}
          />
          <div className="grid gap-x-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Airlines
              rows={view.data.airlines}
              onUnauthorized={redirectToLogin}
            />
            <Places
              rows={view.data.places}
              kinds={view.data.place_kinds}
              onUnauthorized={redirectToLogin}
            />
          </div>
          <ActionLogPanel
            refreshKey={0}
            reloadOnOpen
            onUnauthorized={redirectToLogin}
            load={(before, signal) =>
              fetchActionLog("/api/settings/tcq/action-log", before, signal)
            }
          />
        </>
      )}
    </main>
  );
}

function useSaver(onUnauthorized: () => void) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const run = useCallback(
    async <T,>(
      call: () => Promise<T>,
      onDone: (v: T) => void,
      ok = "Saved.",
    ) => {
      setBusy(true);
      setResult(null);
      try {
        const v = await call();
        onDone(v);
        setResult({ tone: "ok", text: ok });
      } catch (error) {
        if (isStatus(error, 401)) onUnauthorized();
        else setResult({ tone: "error", text: describeError(error) });
      } finally {
        setBusy(false);
      }
    },
    [onUnauthorized],
  );
  return { busy, result, run, setResult };
}

function Head({
  id,
  title,
  note,
  aside,
}: {
  id?: string;
  title: string;
  note?: string;
  aside?: ReactNode;
}) {
  return (
    <div className={CARD_HEADER_CLASS} id={id}>
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className={CARD_TITLE_CLASS}>{title}</span>
        {note ? <span className={NOTE}>{note}</span> : null}
      </span>
      {aside}
    </div>
  );
}

// ── Vehicle rates ──

const MONEY_KEYS = [
  "arrival_intl_cents",
  "arrival_domestic_cents",
  "departure_cents",
  "airport_fee_cents",
  "charter_base_cents",
  "charter_overtime_cents",
  "event_rate_cents",
  "event_overtime_cents",
] as const;
const HOUR_KEYS = [
  "transfer_hours",
  "charter_min_hours",
  "event_min_hours",
] as const;

/** 表格的列（顺序 = 显示顺序）。 */
const VEHICLE_COLS: {
  key: keyof VehicleForm;
  label: string;
  kind: "money" | "hours" | "int";
}[] = [
  { key: "seats", label: "Seats", kind: "int" },
  { key: "arrival_intl_cents", label: "Pickup intl", kind: "money" },
  { key: "arrival_domestic_cents", label: "Pickup domestic", kind: "money" },
  { key: "departure_cents", label: "Drop-off", kind: "money" },
  { key: "airport_fee_cents", label: "Airport fee", kind: "money" },
  { key: "transfer_hours", label: "Hours incl.", kind: "hours" },
  { key: "charter_base_cents", label: "Min price", kind: "money" },
  { key: "charter_min_hours", label: "Min hours", kind: "hours" },
  { key: "charter_overtime_cents", label: "Extra hr", kind: "money" },
  { key: "event_rate_cents", label: "Event price", kind: "money" },
  { key: "event_min_hours", label: "Min hours", kind: "hours" },
  { key: "event_overtime_cents", label: "Extra hr", kind: "money" },
  { key: "gratuity_per_day_cents", label: "Gratuity / day", kind: "money" },
  { key: "sort_order", label: "Order", kind: "int" },
];

type VehicleForm = { name: string; is_active: boolean } & Record<
  | (typeof MONEY_KEYS)[number]
  | (typeof HOUR_KEYS)[number]
  | "seats"
  | "sort_order"
  | "gratuity_per_day_cents",
  string
>;

const dollarsText = (c: number | null) =>
  c == null ? "" : c % 100 ? (c / 100).toFixed(2) : String(c / 100);

function toForm(v: TcqVehicle | null): VehicleForm {
  const f = {
    name: v?.name ?? "",
    is_active: v?.is_active ?? true,
    seats: v ? String(v.seats) : "",
    sort_order: v ? String(v.sort_order) : "",
    gratuity_per_day_cents: dollarsText(v?.gratuity_per_day_cents ?? null),
  } as VehicleForm;
  for (const k of MONEY_KEYS) f[k] = v ? dollarsText(v[k]) : "";
  for (const k of HOUR_KEYS) f[k] = v ? String(v[k]) : "";
  return f;
}

/** 表单 → 接口。读不懂的格子回一句话（不发请求）。 */
function fromForm(f: VehicleForm): TcqVehicleInput | string {
  const out: Record<string, unknown> = {
    name: f.name.trim(),
    is_active: f.is_active,
  };
  for (const k of MONEY_KEYS) {
    const c = parseDollars(f[k]);
    if (c == null) return "Every price must be a number like 180 or 64.50.";
    out[k] = c;
  }
  for (const k of HOUR_KEYS) {
    const h = Number(f[k]);
    if (!f[k].trim() || !Number.isFinite(h))
      return "Hours must be numbers, in half hours.";
    out[k] = h;
  }
  if (f.gratuity_per_day_cents.trim()) {
    const c = parseDollars(f.gratuity_per_day_cents);
    if (c == null) return "Gratuity / day must be empty or a number like 115.";
    out.gratuity_per_day_cents = c;
  } else out.gratuity_per_day_cents = null;
  for (const k of ["seats", "sort_order"] as const) {
    const n = Number(f[k]);
    if (!f[k].trim() || !Number.isInteger(n))
      return `${k === "seats" ? "Seats" : "Order"} must be a whole number.`;
    out[k] = n;
  }
  return out as unknown as TcqVehicleInput;
}

function Vehicles({
  rows,
  onUnauthorized,
}: {
  rows: TcqVehicle[];
  onUnauthorized: () => void;
}) {
  const [list, setList] = useState<{ key: string; row: TcqVehicle | null }[]>(
    () => rows.map((r) => ({ key: `v${r.id}`, row: r })),
  );
  return (
    <section className={CARD_CLASS} aria-label="Vehicle rates">
      <Head
        id="tcq-vehicles"
        title="Vehicle rates"
        note="Dollars · hours in half hours"
        aside={
          <button
            type="button"
            className={BTN_EDIT_CLASS}
            onClick={() =>
              setList((l) => [...l, { key: `new${Date.now()}`, row: null }])
            }
          >
            + Add vehicle
          </button>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1190px] border-collapse">
          <thead>
            <tr className="text-[#1a1a1a] night:text-white/50">
              <td className={TH_CLASS} colSpan={2} />
              <td className={cn(TH_CLASS, "text-center uppercase")} colSpan={5}>
                Airport
              </td>
              <td className={cn(TH_CLASS, "text-center uppercase")} colSpan={3}>
                Normal charter
              </td>
              <td className={cn(TH_CLASS, "text-center uppercase")} colSpan={3}>
                Event charter
              </td>
              <td className={TH_CLASS} colSpan={4} />
            </tr>
            <tr className="text-[#1a1a1a] night:text-white/50">
              <td className={TH_CLASS}>Vehicle</td>
              {VEHICLE_COLS.map((c, i) => (
                <td key={i} className={NUM_TH}>
                  {c.label}
                </td>
              ))}
              <td className={NUM_TH}>On</td>
              <td className={NUM_TH} />
            </tr>
          </thead>
          <tbody className={TBODY_CLASS}>
            {list.map((x) => (
              <VehicleRow
                key={x.key}
                row={x.row}
                onUnauthorized={onUnauthorized}
                onCreated={(v) =>
                  setList((l) =>
                    l.map((y) =>
                      y.key === x.key ? { key: x.key, row: v } : y,
                    ),
                  )
                }
                onCancel={() =>
                  setList((l) => l.filter((y) => y.key !== x.key))
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function VehicleRow({
  row,
  onUnauthorized,
  onCreated,
  onCancel,
}: {
  row: TcqVehicle | null;
  onUnauthorized: () => void;
  onCreated: (v: TcqVehicle) => void;
  onCancel: () => void;
}) {
  const [saved, setSaved] = useState(() => toForm(row));
  const [f, setF] = useState(saved);
  const { busy, result, run, setResult } = useSaver(onUnauthorized);
  const dirty = JSON.stringify(f) !== JSON.stringify(saved);
  const isNew = row == null;
  return (
    <tr
      className={cn(TR_CLASS, TR_HOVER, !f.is_active && "text-[#8f8c82]")}
      data-vehicle-row={row?.name ?? "new"}
    >
      <td className={TD_CLASS}>
        <input
          aria-label="Vehicle name"
          value={f.name}
          maxLength={80}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          className={cn(
            INLINE_INPUT_BASE,
            "w-[168px]",
            !f.is_active && "text-[#8f8c82]",
          )}
        />
      </td>
      {VEHICLE_COLS.map((c, i) => (
        <td key={i} className={NUM_TD}>
          <input
            aria-label={c.label}
            inputMode="decimal"
            value={f[c.key] as string}
            placeholder={c.key === "gratuity_per_day_cents" ? "—" : ""}
            onChange={(e) => setF({ ...f, [c.key]: e.target.value })}
            className={cn(
              INLINE_INPUT_BASE,
              "w-[54px] text-right",
              !f.is_active && "text-[#8f8c82]",
            )}
          />
        </td>
      ))}
      <td className={TD_CLASS}>
        <input
          type="checkbox"
          aria-label="On the rate card"
          checked={f.is_active}
          onChange={(e) => setF({ ...f, is_active: e.target.checked })}
          className="size-4 accent-[#1a1a1a]"
        />
      </td>
      <td className={cn(NUM_TD, "pr-3 whitespace-nowrap")}>
        <button
          type="button"
          disabled={(!dirty && !isNew) || busy}
          onClick={() => {
            const body = fromForm(f);
            if (typeof body === "string") {
              setResult({ tone: "error", text: body });
              return;
            }
            void run(
              () => saveVehicle(row?.id ?? null, body),
              (v) => {
                const nf = toForm(v);
                setSaved(nf);
                setF(nf);
                if (isNew) onCreated(v);
              },
            );
          }}
          className={SAVE_SMALL}
        >
          {busy ? "Saving…" : isNew ? "Add" : "Save"}
        </button>{" "}
        {isNew ? (
          <button type="button" className={BTN_EDIT_CLASS} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        {result ? (
          <span
            className={cn(
              resultClass(result.tone),
              "block max-w-[220px] whitespace-normal",
            )}
          >
            {result.text}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

// ── Event calendar ──

type EventForm = {
  name: string;
  start_date: string;
  end_date: string;
  min_days: string;
  cancel_days: string;
};

const eventForm = (e: TcqEvent | null): EventForm => ({
  name: e?.name ?? "",
  start_date: e?.start_date ?? "",
  end_date: e?.end_date ?? "",
  min_days: e?.min_days == null ? "" : String(e.min_days),
  cancel_days: e ? String(e.cancel_days) : "30",
});

function Events({
  rows,
  onUnauthorized,
}: {
  rows: TcqEvent[];
  onUnauthorized: () => void;
}) {
  const [list, setList] = useState<{ key: string; row: TcqEvent | null }[]>(
    () => rows.map((r) => ({ key: `e${r.id}`, row: r })),
  );
  return (
    <section className={CARD_CLASS} aria-label="Event calendar">
      <Head
        id="tcq-events"
        title="Event calendar"
        note="Charters on these dates use the event price when Rate is Auto"
        aside={
          <button
            type="button"
            className={BTN_EDIT_CLASS}
            onClick={() =>
              setList((l) => [...l, { key: `new${Date.now()}`, row: null }])
            }
          >
            + Add event
          </button>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr className="text-[#1a1a1a] night:text-white/50">
              {[
                "Event",
                "Start",
                "End",
                "Min. consecutive days",
                "Cancellation notice (days)",
                "",
              ].map((h, i) => (
                <td key={i} className={TH_CLASS}>
                  {h}
                </td>
              ))}
            </tr>
          </thead>
          <tbody className={TBODY_CLASS}>
            {list.map((x) => (
              <EventRow
                key={x.key}
                row={x.row}
                onUnauthorized={onUnauthorized}
                onSaved={(v) =>
                  setList((l) =>
                    l.map((y) =>
                      y.key === x.key ? { key: x.key, row: v } : y,
                    ),
                  )
                }
                onGone={() => setList((l) => l.filter((y) => y.key !== x.key))}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EventRow({
  row,
  onUnauthorized,
  onSaved,
  onGone,
}: {
  row: TcqEvent | null;
  onUnauthorized: () => void;
  onSaved: (e: TcqEvent) => void;
  onGone: () => void;
}) {
  const [saved, setSaved] = useState(() => eventForm(row));
  const [f, setF] = useState(saved);
  const [asking, setAsking] = useState(false);
  const { busy, result, run, setResult } = useSaver(onUnauthorized);
  const dirty = JSON.stringify(f) !== JSON.stringify(saved);
  const isNew = row == null;
  return (
    <tr className={cn(TR_CLASS, TR_HOVER)} data-event-row={row?.name ?? "new"}>
      <td className={cn(TD_CLASS, "w-[240px]")}>
        <input
          aria-label="Event name"
          value={f.name}
          maxLength={120}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          className={INLINE_INPUT_CLASS}
        />
      </td>
      {(["start_date", "end_date"] as const).map((k) => (
        <td key={k} className={TD_CLASS}>
          <input
            type="date"
            aria-label={k === "start_date" ? "Start" : "End"}
            value={f[k]}
            onChange={(e) => setF({ ...f, [k]: e.target.value })}
            className={INLINE_INPUT_BASE}
          />
        </td>
      ))}
      <td className={TD_CLASS}>
        <input
          aria-label="Minimum days"
          inputMode="numeric"
          value={f.min_days}
          placeholder="—"
          onChange={(e) => setF({ ...f, min_days: e.target.value })}
          className={cn(INLINE_INPUT_BASE, "w-16")}
        />
      </td>
      <td className={TD_CLASS}>
        <input
          aria-label="Cancellation days"
          inputMode="numeric"
          value={f.cancel_days}
          onChange={(e) => setF({ ...f, cancel_days: e.target.value })}
          className={cn(INLINE_INPUT_BASE, "w-16")}
        />
      </td>
      <td className={cn(TD_CLASS, "whitespace-nowrap")}>
        {asking ? (
          <>
            <span className="mr-2 text-[12px]">Delete {saved.name}?</span>
            <button
              type="button"
              disabled={busy}
              className={BTN_DELETE_CLASS}
              onClick={() =>
                void run(
                  () => deleteEvent(row!.id),
                  () => onGone(),
                  "Deleted.",
                )
              }
            >
              {busy ? "Deleting…" : "Yes, delete"}
            </button>{" "}
            <button
              type="button"
              className={BTN_EDIT_CLASS}
              onClick={() => setAsking(false)}
            >
              Keep
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={(!dirty && !isNew) || busy}
              onClick={() => {
                const min = f.min_days.trim() ? Number(f.min_days) : null;
                const cancel = Number(f.cancel_days);
                if (
                  (min !== null && !Number.isInteger(min)) ||
                  !Number.isInteger(cancel) ||
                  !f.cancel_days.trim()
                ) {
                  setResult({
                    tone: "error",
                    text: "Days must be whole numbers.",
                  });
                  return;
                }
                void run(
                  () =>
                    saveEvent(row?.id ?? null, {
                      name: f.name.trim(),
                      start_date: f.start_date || null,
                      end_date: f.end_date || null,
                      min_days: min,
                      cancel_days: cancel,
                    }),
                  (v) => {
                    const nf = eventForm(v);
                    setSaved(nf);
                    setF(nf);
                    onSaved(v);
                  },
                );
              }}
              className={SAVE_SMALL}
            >
              {busy ? "Saving…" : isNew ? "Add" : "Save"}
            </button>{" "}
            {isNew ? (
              <button type="button" className={BTN_EDIT_CLASS} onClick={onGone}>
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className={BTN_DELETE_CLASS}
                onClick={() => setAsking(true)}
              >
                Delete
              </button>
            )}{" "}
            {!isNew && !saved.start_date ? (
              <span className="text-[12px] text-[#b45309]">No dates yet</span>
            ) : null}{" "}
            <span className={resultClass(result?.tone)}>{result?.text}</span>
          </>
        )}
      </td>
    </tr>
  );
}

// ── Charges and terms ──

function Terms({
  rows,
  onUnauthorized,
}: {
  rows: TcqTerm[];
  onUnauthorized: () => void;
}) {
  const initial = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.key, r.value])),
    [rows],
  );
  const [saved, setSaved] = useState<Record<string, string>>(initial);
  const [v, setV] = useState<Record<string, string>>(initial);
  const { busy, result, run } = useSaver(onUnauthorized);
  const changed = Object.keys(v).filter((k) => v[k] !== saved[k]);
  const numbers = rows.filter((r) => r.kind === "number");
  const texts = rows.filter((r) => r.kind === "text");
  // 单行就够的文字（抬头、单号前缀）和数字放一起；其余（条款句子、三段默认文字）用多行框。
  const short = texts.filter(
    (r) => r.key === "quote_header" || r.key === "quote_prefix",
  );
  const long = texts.filter((r) => !short.includes(r));
  const placeholders = (s: string) =>
    [...new Set(s.match(/\{\w+\}/g) ?? [])].join(" ");
  return (
    <section className={CARD_CLASS} aria-label="Charges and terms">
      <Head
        id="tcq-terms"
        title="Charges and terms"
        note="The numbers fill the {placeholders} in the wording"
        aside={
          <span className="flex items-center gap-2">
            <span className={resultClass(result?.tone)}>{result?.text}</span>
            <button
              type="button"
              disabled={!changed.length || busy}
              onClick={() =>
                void run(
                  () =>
                    saveTerms(
                      Object.fromEntries(changed.map((k) => [k, v[k]])),
                    ),
                  (after) => {
                    const next = { ...saved, ...after };
                    setSaved(next);
                    setV((cur) => ({ ...cur, ...after }));
                  },
                )
              }
              className={SAVE_BIG}
            >
              {busy
                ? "Saving…"
                : changed.length
                  ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}`
                  : "Save"}
            </button>
          </span>
        }
      />
      <div className="px-4 py-4 text-[12px] text-[#1a1a1a] night:text-white/70">
        <div className="grid [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))] gap-x-4 gap-y-3">
          {[...short, ...numbers].map((r) => (
            <label
              key={r.key}
              className="flex flex-col gap-1 font-semibold"
              data-term={r.key}
            >
              {r.label}
              <input
                value={v[r.key] ?? ""}
                inputMode={r.kind === "number" ? "decimal" : undefined}
                onChange={(e) => setV({ ...v, [r.key]: e.target.value })}
                className={cn(INLINE_INPUT_CLASS, "font-normal")}
              />
            </label>
          ))}
        </div>
        <div className="mt-4 grid [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))] gap-x-4 gap-y-3">
          {long.map((r) => (
            <label
              key={r.key}
              className="flex flex-col gap-1 font-semibold"
              data-term={r.key}
            >
              <span>
                {r.label}{" "}
                <span className="font-normal text-[#4a5568] night:text-white/40">
                  {placeholders(saved[r.key] ?? "")}
                </span>
              </span>
              <textarea
                rows={
                  r.key.endsWith("_text") &&
                  /inclusions|not_included|assumptions/.test(r.key)
                    ? 3
                    : 2
                }
                value={v[r.key] ?? ""}
                onChange={(e) => setV({ ...v, [r.key]: e.target.value })}
                className={cn(
                  INLINE_INPUT_CLASS,
                  "resize-y leading-[1.5] font-normal",
                )}
              />
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Reading words ──

function Words({
  rows,
  kinds,
  onUnauthorized,
}: {
  rows: TcqDictionaryTerm[];
  kinds: string[];
  onUnauthorized: () => void;
}) {
  const [list, setList] = useState(rows);
  return (
    <section className={CARD_CLASS} aria-label="Reading words">
      <Head
        id="tcq-words"
        title="Reading words"
        note="What the system looks for when it reads an email"
      />
      <div className="grid [grid-template-columns:repeat(auto-fill,minmax(270px,1fr))] gap-3 px-4 py-4">
        {kinds.map((k) => (
          <WordKind
            key={k}
            kind={k}
            words={list.filter((w) => w.kind === k)}
            onAdded={(w) => setList((l) => [...l, w])}
            onRemoved={(id) => setList((l) => l.filter((w) => w.id !== id))}
            onUnauthorized={onUnauthorized}
          />
        ))}
      </div>
    </section>
  );
}

function WordKind({
  kind,
  words,
  onAdded,
  onRemoved,
  onUnauthorized,
}: {
  kind: string;
  words: TcqDictionaryTerm[];
  onAdded: (w: TcqDictionaryTerm) => void;
  onRemoved: (id: number) => void;
  onUnauthorized: () => void;
}) {
  const [term, setTerm] = useState("");
  const { busy, result, run } = useSaver(onUnauthorized);
  const label = DICT_LABEL[kind] ?? {
    title: capital(kind.replace(/_/g, " ")),
    hint: "",
  };
  return (
    <div
      className="rounded-[9px] border border-black/[.1] px-3 py-2.5 text-[12px] text-[#1a1a1a] night:border-white/10 night:text-white/80"
      data-word-kind={kind}
    >
      <b className="text-[12.5px]">{label.title}</b>{" "}
      {label.hint ? (
        <span className="text-[11px] text-[#4a5568] night:text-white/40">
          {label.hint}
        </span>
      ) : null}
      <div className="my-2 flex flex-wrap gap-1.5">
        {words.length === 0 ? (
          <span className="text-[#4a5568]">No words yet.</span>
        ) : null}
        {words.map((w) => (
          <span
            key={w.id}
            className="inline-flex items-center gap-1 rounded-[6px] border border-black/15 bg-white py-px pr-1 pl-2 night:border-white/15 night:bg-white/[.04]"
            data-word={w.term}
          >
            {w.term}
            <button
              type="button"
              aria-label={`Remove ${w.term}`}
              disabled={busy}
              onClick={() =>
                void run(
                  () => deleteDictionaryTerm(w.id),
                  () => onRemoved(w.id),
                  "Removed.",
                )
              }
              className="px-1 text-[13px] leading-none text-[#8f8c82] hover:text-[#A32D2D]"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!term.trim()) return;
          void run(
            () => addDictionaryTerm({ kind, term: term.trim() }),
            (w) => {
              onAdded(w);
              setTerm("");
            },
            "Added.",
          );
        }}
      >
        <input
          aria-label={`Add a word to ${label.title}`}
          value={term}
          maxLength={60}
          placeholder="Add a word"
          onChange={(e) => setTerm(e.target.value)}
          className={cn(INLINE_INPUT_CLASS, "min-w-0 flex-1")}
        />
        <button
          type="submit"
          disabled={busy || !term.trim()}
          className={SAVE_SMALL}
        >
          Add
        </button>
      </form>
      <span className={resultClass(result?.tone)}>{result?.text}</span>
    </div>
  );
}

// ── Airlines ──

function Airlines({
  rows,
  onUnauthorized,
}: {
  rows: TcqAirline[];
  onUnauthorized: () => void;
}) {
  const [list, setList] = useState(rows);
  const [code, setCode] = useState("");
  const [intl, setIntl] = useState(true);
  const { busy, result, run } = useSaver(onUnauthorized);
  const upsert = (a: TcqAirline) =>
    setList((l) =>
      [...l.filter((x) => x.code !== a.code), a].sort((x, y) =>
        x.code.localeCompare(y.code),
      ),
    );
  return (
    <section className={CARD_CLASS} aria-label="Airlines">
      <Head
        id="tcq-airlines"
        title="Airlines"
        note="International or domestic pickup price; codes not here are flagged"
      />
      <div className="px-4 pt-3 text-[12px] text-[#1a1a1a] night:text-white/70">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => saveAirline(code.trim().toUpperCase(), intl),
              (a) => {
                upsert(a);
                setCode("");
              },
              "Added.",
            );
          }}
        >
          <input
            aria-label="Airline code"
            value={code}
            maxLength={3}
            placeholder="Code, e.g. KE"
            onChange={(e) => setCode(e.target.value)}
            className={cn(INLINE_INPUT_BASE, "w-[110px] uppercase")}
          />
          <select
            aria-label="New airline type"
            value={intl ? "intl" : "dom"}
            onChange={(e) => setIntl(e.target.value === "intl")}
            className={INLINE_INPUT_BASE}
          >
            <option value="intl">International</option>
            <option value="dom">Domestic</option>
          </select>
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className={SAVE_SMALL}
          >
            Add
          </button>
          <span className={resultClass(result?.tone)}>{result?.text}</span>
        </form>
        <p className={cn(NOTE, "mt-1.5")}>Changing a type saves right away.</p>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-[#1a1a1a] night:text-white/50">
              {["Code", "Type", ""].map((h, i) => (
                <td key={i} className={TH_CLASS}>
                  {h}
                </td>
              ))}
            </tr>
          </thead>
          <tbody className={TBODY_CLASS}>
            {list.map((a) => (
              <AirlineRow
                key={a.code}
                row={a}
                onUnauthorized={onUnauthorized}
                onSaved={upsert}
                onGone={() =>
                  setList((l) => l.filter((x) => x.code !== a.code))
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AirlineRow({
  row,
  onUnauthorized,
  onSaved,
  onGone,
}: {
  row: TcqAirline;
  onUnauthorized: () => void;
  onSaved: (a: TcqAirline) => void;
  onGone: () => void;
}) {
  const { busy, result, run } = useSaver(onUnauthorized);
  return (
    <tr className={cn(TR_CLASS, TR_HOVER)} data-airline={row.code}>
      <td className={cn(TD_CLASS, "font-semibold")}>{row.code}</td>
      <td className={TD_CLASS}>
        <select
          aria-label={`${row.code} type`}
          value={row.is_international ? "intl" : "dom"}
          disabled={busy}
          onChange={(e) =>
            void run(
              () => saveAirline(row.code, e.target.value === "intl"),
              onSaved,
            )
          }
          className={INLINE_INPUT_BASE}
        >
          <option value="intl">International</option>
          <option value="dom">Domestic</option>
        </select>
      </td>
      <td className={cn(TD_CLASS, "whitespace-nowrap")}>
        <button
          type="button"
          disabled={busy}
          className={BTN_DELETE_CLASS}
          onClick={() =>
            void run(
              () => deleteAirline(row.code),
              () => onGone(),
              "Deleted.",
            )
          }
        >
          Delete
        </button>{" "}
        <span className={resultClass(result?.tone)}>{result?.text}</span>
      </td>
    </tr>
  );
}

// ── Places ──

function Places({
  rows,
  kinds,
  onUnauthorized,
}: {
  rows: TcqPlace[];
  kinds: string[];
  onUnauthorized: () => void;
}) {
  const [list, setList] = useState<{ key: string; row: TcqPlace | null }[]>(
    () => rows.map((r) => ({ key: `p${r.id}`, row: r })),
  );
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = list.filter(
    (x) =>
      !x.row ||
      !needle ||
      x.row.name.toLowerCase().includes(needle) ||
      x.row.aliases.some((a) => a.toLowerCase().includes(needle)),
  );
  return (
    <section className={CARD_CLASS} aria-label="Places">
      <Head
        id="tcq-places"
        title="Places"
        note="Hotels, venues and airports the system recognizes"
        aside={
          <span className="flex items-center gap-2">
            <input
              aria-label="Search places"
              value={q}
              placeholder="Search places"
              onChange={(e) => setQ(e.target.value)}
              className={HEADER_SEARCH_CLASS}
            />
            <button
              type="button"
              className={BTN_EDIT_CLASS}
              onClick={() =>
                setList((l) => [{ key: `new${Date.now()}`, row: null }, ...l])
              }
            >
              + Add place
            </button>
          </span>
        }
      />
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[620px] border-collapse">
          <thead>
            <tr className="text-[#1a1a1a] night:text-white/50">
              {["Name", "Kind", "Other names (comma between)", ""].map(
                (h, i) => (
                  <td key={i} className={TH_CLASS}>
                    {h}
                  </td>
                ),
              )}
            </tr>
          </thead>
          <tbody className={TBODY_CLASS}>
            {shown.map((x) => (
              <PlaceRow
                key={x.key}
                row={x.row}
                kinds={kinds}
                onUnauthorized={onUnauthorized}
                onSaved={(p) =>
                  setList((l) =>
                    l.map((y) =>
                      y.key === x.key ? { key: x.key, row: p } : y,
                    ),
                  )
                }
                onGone={() => setList((l) => l.filter((y) => y.key !== x.key))}
              />
            ))}
          </tbody>
        </table>
        {needle && !shown.length ? (
          <p className="px-4 py-3 text-[12px] text-[#1a1a1a]">
            No place matches “{q}”.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function PlaceRow({
  row,
  kinds,
  onUnauthorized,
  onSaved,
  onGone,
}: {
  row: TcqPlace | null;
  kinds: string[];
  onUnauthorized: () => void;
  onSaved: (p: TcqPlace) => void;
  onGone: () => void;
}) {
  const form = (p: TcqPlace | null) => ({
    name: p?.name ?? "",
    kind: p?.kind ?? kinds[0] ?? "hotel",
    aliases: (p?.aliases ?? []).join(", "),
  });
  const [saved, setSaved] = useState(() => form(row));
  const [f, setF] = useState(saved);
  const [asking, setAsking] = useState(false);
  const { busy, result, run } = useSaver(onUnauthorized);
  const dirty = JSON.stringify(f) !== JSON.stringify(saved);
  const isNew = row == null;
  return (
    <tr className={cn(TR_CLASS, TR_HOVER)} data-place-row={row?.name ?? "new"}>
      <td className={cn(TD_CLASS, "w-[260px]")}>
        <input
          aria-label="Place name"
          value={f.name}
          maxLength={200}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          className={INLINE_INPUT_CLASS}
        />
      </td>
      <td className={TD_CLASS}>
        <select
          aria-label="Kind"
          value={f.kind}
          onChange={(e) => setF({ ...f, kind: e.target.value })}
          className={INLINE_INPUT_BASE}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {capital(k)}
            </option>
          ))}
        </select>
      </td>
      <td className={TD_CLASS}>
        <input
          aria-label="Other names"
          value={f.aliases}
          onChange={(e) => setF({ ...f, aliases: e.target.value })}
          className={INLINE_INPUT_CLASS}
        />
      </td>
      <td className={cn(TD_CLASS, "w-[230px] whitespace-nowrap")}>
        {asking ? (
          <>
            <span className="mr-2 text-[12px]">Delete?</span>
            <button
              type="button"
              disabled={busy}
              className={BTN_DELETE_CLASS}
              onClick={() =>
                void run(
                  () => deletePlace(row!.id),
                  () => onGone(),
                  "Deleted.",
                )
              }
            >
              {busy ? "Deleting…" : "Yes, delete"}
            </button>{" "}
            <button
              type="button"
              className={BTN_EDIT_CLASS}
              onClick={() => setAsking(false)}
            >
              Keep
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={(!dirty && !isNew) || busy}
              onClick={() =>
                void run(
                  () =>
                    savePlace(row?.id ?? null, {
                      name: f.name.trim(),
                      kind: f.kind,
                      aliases: f.aliases
                        .split(",")
                        .map((a) => a.trim())
                        .filter(Boolean),
                    }),
                  (p) => {
                    const nf = form(p);
                    setSaved(nf);
                    setF(nf);
                    onSaved(p);
                  },
                )
              }
              className={SAVE_SMALL}
            >
              {busy ? "Saving…" : isNew ? "Add" : "Save"}
            </button>{" "}
            {isNew ? (
              <button type="button" className={BTN_EDIT_CLASS} onClick={onGone}>
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className={BTN_DELETE_CLASS}
                onClick={() => setAsking(true)}
              >
                Delete
              </button>
            )}{" "}
            <span className={resultClass(result?.tone)}>{result?.text}</span>
          </>
        )}
      </td>
    </tr>
  );
}
