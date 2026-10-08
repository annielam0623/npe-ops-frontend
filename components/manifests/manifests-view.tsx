"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  FILTER_BAR_CLASS,
  FILTER_BUTTON_CLASS,
  FILTER_COUNT_CLASS,
  FILTER_INPUT_CLASS,
  FILTER_TEXT_BUTTON_CLASS,
  FilterDivider,
} from "@/components/ui/filter-bar";
import { HowToUse } from "@/components/ui/how-to-use";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { downloadCsv } from "@/lib/csv";
import { isYmd, laToday, shiftYmd } from "@/lib/la-date";
import { fetchManifestPage, saveManifestCfm } from "@/lib/manifests-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { fetchUserPref, saveUserPref } from "@/lib/user-prefs-api";
import { cn } from "@/lib/utils";
import type {
  ManifestField,
  ManifestPage,
  ManifestRow,
  ManifestTabKey,
} from "@/types";

import { CfmUploadPanel } from "./cfm-upload-panel";
import {
  buildCsv,
  csvFilename,
  formatValue,
  isLegacy,
  isTabKey,
  parseSavedFields,
  plural,
  PREF_KEY,
  STAFF_CFM_KEY,
  TAB_KEYS,
} from "./config";
import { FieldPicker } from "./field-picker";

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

/** 账号里存的列：undefined = 还没拉；null = 没存过（用后端默认列）。 */
type SavedFields = Record<ManifestTabKey, string[] | null | undefined>;

const TAB_FALLBACK_LABEL: Record<ManifestTabKey, string> = {
  bus: "Bus Tour",
  tickets: "Tickets - SelfDrive",
};

export function ManifestsView() {
  const [date, setDate] = useState("");
  const [tab, setTab] = useState<ManifestTabKey>("bus");
  /** 请求的胶囊；空串 = 让后端挑 A→Z 第一颗。显示以返回的 data.pill 为准。 */
  const [pill, setPill] = useState("");
  const [saved, setSaved] = useState<SavedFields>({
    bus: undefined,
    tickets: undefined,
  });
  const [prefNote, setPrefNote] = useState("");
  const [data, setData] = useState<ManifestPage | null>(null);
  const [state, setState] = useState<LoadState | null>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [picking, setPicking] = useState(false);
  const [uploadingCfm, setUploadingCfm] = useState(false);
  const redirectingRef = useRef(false);
  /** 上一次返回已经满足的请求：后端换了胶囊（我们没指定 / 指定的当天不存在）时不再重拉一次。 */
  const satisfiedRef = useRef("");

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  // 地址栏的 ?date= &tab= &pill= 是打开页面时的起点；没有 / 不合法时用洛杉矶今天、Bus Tour、第一颗胶囊。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("date");
    const tabFromUrl = params.get("tab");
    setDate(isYmd(fromUrl) ? fromUrl : laToday());
    if (isTabKey(tabFromUrl)) setTab(tabFromUrl);
    setPill(params.get("pill") ?? "");
  }, []);

  // 这个标签存的列（每个标签只拉一次）。
  const savedHere = saved[tab];
  useEffect(() => {
    if (savedHere !== undefined) return;
    const controller = new AbortController();
    fetchUserPref(PREF_KEY[tab], controller.signal)
      .then((value) =>
        setSaved((s) => ({ ...s, [tab]: parseSavedFields(value) })),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) {
          redirectToLogin();
          return;
        }
        // 拉不到不挡页面：先用默认列，并说明。
        setPrefNote(
          `Could not load your saved columns (${describeError(error)}), showing the default columns.`,
        );
        setSaved((s) => ({ ...s, [tab]: null }));
      });
    return () => controller.abort();
  }, [tab, savedHere, redirectToLogin]);

  const fieldsKey = savedHere ? savedHere.join(",") : "";
  useEffect(() => {
    if (!date || savedHere === undefined) return;
    const requestKey = `${date}|${tab}|${pill}|${fieldsKey}|${reloadKey}`;
    if (requestKey === satisfiedRef.current) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchManifestPage({ date, tab, pill, fields: savedHere }, controller.signal)
      .then((page) => {
        setData(page);
        setState(null);
        const url = new URL(window.location.href);
        url.searchParams.set("date", page.date);
        url.searchParams.set("tab", page.tab);
        if (page.pill) url.searchParams.set("pill", page.pill);
        else url.searchParams.delete("pill");
        window.history.replaceState(null, "", url);
        if ((page.pill ?? "") !== pill) {
          satisfiedRef.current = `${date}|${tab}|${page.pill ?? ""}|${fieldsKey}|${reloadKey}`;
          setPill(page.pill ?? "");
        } else {
          satisfiedRef.current = requestKey;
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setState({ kind: "forbidden" });
        else setState({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [date, tab, pill, fieldsKey, savedHere, reloadKey, redirectToLogin]);

  function changeDate(next: string) {
    if (!isYmd(next) || next === date) return;
    setDate(next);
  }

  function changeTab(next: ManifestTabKey) {
    if (next === tab) return;
    setTab(next);
    setPill("");
  }

  async function applyFields(fields: string[] | null) {
    try {
      await saveUserPref(PREF_KEY[tab], JSON.stringify(fields ?? []));
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      throw new Error(describeError(error));
    }
    setSaved((s) => ({ ...s, [tab]: fields }));
    setPrefNote("");
    setPicking(false);
  }

  function onCfmSaved(rowKey: string, values: ManifestRow["values"]) {
    setData((d) =>
      d
        ? {
            ...d,
            rows: d.rows.map((r) =>
              r.row_key === rowKey
                ? { ...r, values: { ...r.values, ...values } }
                : r,
            ),
          }
        : d,
    );
  }

  const today = date ? laToday() : "";
  const loading = state?.kind === "loading";
  // 换了标签还没回来时，旧标签的数据不当成这个标签的。
  const shown = data && data.tab === tab ? data : null;
  const legacyCount = shown ? shown.rows.filter(isLegacy).length : 0;
  const tabs =
    data?.tabs ??
    TAB_KEYS.map((key) => ({
      key,
      label: TAB_FALLBACK_LABEL[key],
      rows: 0,
      orders: 0,
      pax: 0,
    }));
  const currentPill = shown?.pills.find((p) => p.key === shown.pill);

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
            Operations
          </span>
          <h1 className="text-2xl font-semibold text-stone-900">Manifests</h1>
          <p className="text-sm text-stone-500">
            Live Rezdy orders for one day, one group or tour type at a time.
          </p>
        </header>

        {state?.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">Staff access required</p>
            <p className="mt-1">This page is for office staff.</p>
          </Panel>
        ) : (
          <>
            <div className={FILTER_BAR_CLASS}>
              <button
                type="button"
                aria-label="Previous day"
                onClick={() => changeDate(shiftYmd(date, -1))}
                disabled={!date}
                className={cn(FILTER_BUTTON_CLASS, "px-2")}
              >
                ‹
              </button>
              <input
                type="date"
                aria-label="Manifest date"
                value={date}
                onChange={(e) => changeDate(e.target.value)}
                className={FILTER_INPUT_CLASS}
              />
              <button
                type="button"
                aria-label="Next day"
                onClick={() => changeDate(shiftYmd(date, 1))}
                disabled={!date}
                className={cn(FILTER_BUTTON_CLASS, "px-2")}
              >
                ›
              </button>
              <button
                type="button"
                aria-pressed={!!date && date === today}
                onClick={() => changeDate(laToday())}
                className={cn(
                  FILTER_BUTTON_CLASS,
                  !!date &&
                    date === today &&
                    "border-stone-800 bg-stone-800 text-white hover:bg-stone-700",
                )}
              >
                Today
              </button>
              <FilterDivider />
              <button
                type="button"
                onClick={() => setPicking(true)}
                disabled={!shown}
                className={FILTER_BUTTON_CLASS}
              >
                ☰ Columns
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!shown) return;
                  const csv = buildCsv(shown);
                  downloadCsv(csvFilename(shown), csv.headers, csv.rows);
                }}
                disabled={!shown?.rows.length}
                className={FILTER_TEXT_BUTTON_CLASS}
              >
                ⬇ Export CSV
              </button>
              <button
                type="button"
                onClick={() => setUploadingCfm(true)}
                disabled={!date}
                className={FILTER_TEXT_BUTTON_CLASS}
              >
                ⬆ Upload confirmation #s
              </button>
              <span className={FILTER_COUNT_CLASS}>
                {loading ? "Loading…" : null}
              </span>
            </div>

            <div
              role="tablist"
              aria-label="Manifest type"
              className="flex gap-1 border-b border-stone-300"
            >
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={t.key === tab}
                  onClick={() => changeTab(t.key)}
                  className={cn(
                    "-mb-px rounded-t-md border px-4 py-2 text-sm font-medium",
                    t.key === tab
                      ? "border-stone-300 border-b-white bg-white text-stone-900"
                      : "border-transparent text-stone-500 hover:text-stone-800",
                  )}
                >
                  {t.label}{" "}
                  <span className="text-xs font-normal text-stone-400 tabular-nums">
                    {data ? `${t.orders} · ${t.pax} pax` : ""}
                  </span>
                </button>
              ))}
            </div>

            {prefNote ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                {prefNote}
              </p>
            ) : null}

            {state?.kind === "error" ? (
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => {
                  satisfiedRef.current = "";
                  setReloadKey((k) => k + 1);
                }}
              >
                Could not load manifests: {state.message}
              </ErrorBanner>
            ) : null}

            {shown && shown.pills.length ? (
              <div
                role="group"
                aria-label={tab === "bus" ? "Group" : "Tour type"}
                className="flex flex-wrap gap-1.5"
              >
                {shown.pills.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={p.key === shown.pill}
                    onClick={() => p.key !== shown.pill && setPill(p.key)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs whitespace-nowrap",
                      p.key === shown.pill
                        ? "border-stone-800 bg-stone-800 font-medium text-white"
                        : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50",
                      p.key.endsWith(":none") &&
                        p.key !== shown.pill &&
                        "border-dashed text-stone-500",
                    )}
                  >
                    {p.label}{" "}
                    <span
                      className={cn(
                        "tabular-nums",
                        p.key === shown.pill
                          ? "text-white/70"
                          : "text-stone-400",
                      )}
                    >
                      {p.orders} · {p.pax} pax
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {shown && (shown.denied.length || shown.unknown.length) ? (
              <p className="text-xs text-stone-500">
                {shown.denied.length
                  ? `${plural(shown.denied.length, "saved column")} need admin access and ${shown.denied.length === 1 ? "is" : "are"} hidden. `
                  : ""}
                {shown.unknown.length
                  ? `${plural(shown.unknown.length, "saved column")} ${shown.unknown.length === 1 ? "doesn't" : "don't"} appear on this day and ${shown.unknown.length === 1 ? "is" : "are"} hidden. `
                  : ""}
                They stay in your column choice.
              </p>
            ) : null}

            {legacyCount > 0 ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                ⚠️ {plural(legacyCount, "row")} on this page{" "}
                {legacyCount === 1 ? "comes" : "come"} from data frozen before
                Aug 16, 2026 (marked <span className="font-medium">Legacy</span>
                ). Booking questions and most Trip / Booking fields are empty
                for
                {legacyCount === 1 ? " it" : " them"}.
              </p>
            ) : null}

            {state?.kind === "loading" && !shown ? (
              <Panel>Loading…</Panel>
            ) : null}

            {shown && shown.rows.length === 0 && state === null ? (
              <Panel>
                <p className="text-sm text-stone-500">
                  No live {TAB_FALLBACK_LABEL[tab]} orders for this date.
                </p>
              </Panel>
            ) : null}

            {shown && shown.rows.length ? (
              <section
                className={cn(
                  "overflow-hidden rounded-lg border border-stone-200 bg-white transition-opacity",
                  loading && "opacity-50",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-200 bg-stone-50 px-4 py-2.5">
                  <h2 className="text-sm font-semibold text-stone-900">
                    {currentPill?.label ?? ""}
                  </h2>
                  <span className="text-xs text-stone-500 tabular-nums">
                    {currentPill
                      ? `${plural(currentPill.orders, "order")} · ${currentPill.pax} pax · ${plural(shown.rows.length, "row")}`
                      : plural(shown.rows.length, "row")}
                  </span>
                </div>
                <ManifestTable
                  data={shown}
                  onCfmSaved={onCfmSaved}
                  onUnauthorized={redirectToLogin}
                />
              </section>
            ) : null}

            <ManifestsHowToUse />
          </>
        )}
      </div>

      {picking && shown ? (
        <FieldPicker
          tabLabel={
            shown.tabs.find((t) => t.key === tab)?.label ??
            TAB_FALLBACK_LABEL[tab]
          }
          catalog={shown.catalog}
          groups={shown.groups}
          selected={savedHere ?? shown.default_fields}
          defaults={shown.default_fields}
          onApply={applyFields}
          onClose={() => setPicking(false)}
        />
      ) : null}

      {uploadingCfm && date ? (
        <CfmUploadPanel
          date={date}
          onClose={() => setUploadingCfm(false)}
          onInserted={() => setReloadKey((k) => k + 1)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}
    </main>
  );
}

function ManifestTable({
  data,
  onCfmSaved,
  onUnauthorized,
}: {
  data: ManifestPage;
  onCfmSaved: (rowKey: string, values: ManifestRow["values"]) => void;
  onUnauthorized: () => void;
}) {
  const byKey = new Map(data.catalog.map((f) => [f.key, f]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-stone-200 bg-stone-50 text-left text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
          <tr>
            {data.fields.map((k) => {
              const f = byKey.get(k);
              const numeric = f?.type === "number" || f?.type === "money";
              return (
                <th
                  key={k}
                  className={cn(
                    "px-3 py-2 whitespace-nowrap",
                    numeric && "text-right",
                  )}
                >
                  {f?.label ?? k}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {data.rows.map((r) => (
            <tr key={r.row_key} className="align-top">
              {data.fields.map((k, i) => (
                <td
                  key={k}
                  className={cn(
                    "px-3 py-2",
                    (byKey.get(k)?.type === "number" ||
                      byKey.get(k)?.type === "money") &&
                      "text-right tabular-nums",
                  )}
                >
                  {k === STAFF_CFM_KEY ? (
                    <CfmInput
                      row={r}
                      onSaved={onCfmSaved}
                      onUnauthorized={onUnauthorized}
                    />
                  ) : (
                    <Cell field={byKey.get(k)} row={r} fieldKey={k} />
                  )}
                  {i === 0 && isLegacy(r) ? (
                    <span
                      title="From data frozen before Aug 16, 2026 — booking questions and most Trip / Booking fields are empty"
                      className="ml-1.5 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-700"
                    >
                      Legacy
                    </span>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  field,
  row,
  fieldKey,
}: {
  field: ManifestField | undefined;
  row: ManifestRow;
  fieldKey: string;
}) {
  const text = formatValue(field, row.values[fieldKey], row);
  if (!text) return <span className="text-stone-300">—</span>;
  const long = text.length > 40;
  return (
    <span
      className={cn(
        long
          ? "block max-w-xs min-w-48 [overflow-wrap:anywhere] whitespace-pre-line"
          : "whitespace-nowrap",
      )}
    >
      {text}
    </span>
  );
}

type CfmState = "saving" | "saved" | "failed";

/** staff 的确认号：离开输入框或按 Enter 存，Esc 放弃；失败写原因、保留输入。 */
function CfmInput({
  row,
  onSaved,
  onUnauthorized,
}: {
  row: ManifestRow;
  onSaved: (rowKey: string, values: ManifestRow["values"]) => void;
  onUnauthorized: () => void;
}) {
  const stored = row.values[STAFF_CFM_KEY];
  const storedText =
    stored === null || stored === undefined ? "" : String(stored);
  const [text, setText] = useState(storedText);
  const [status, setStatus] = useState<CfmState | null>(null);
  const [error, setError] = useState("");
  useEffect(() => setText(storedText), [storedText]);

  async function save() {
    const next = text.trim();
    if (next === storedText) {
      setText(storedText);
      return;
    }
    setStatus("saving");
    setError("");
    try {
      const result = await saveManifestCfm({
        order_number: row.order_number,
        product_code: row.product_code,
        tour_date: row.tour_date,
        confirmation_no: next,
      });
      // 清空后列表里 by / at 也是空的（后端契约 C 补充），这里同样清掉，和刷新后一致。
      const cleared = !result.confirmation_no;
      onSaved(row.row_key, {
        [STAFF_CFM_KEY]: cleared ? null : result.confirmation_no,
        staff_cfm_by: cleared ? null : result.updated_by,
        staff_cfm_at: cleared ? null : result.updated_at,
      });
      setText(result.confirmation_no);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? null : s)), 1400);
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setStatus("failed");
      setError(
        isStatus(e, 404)
          ? "This order / product / date is no longer in Rezdy."
          : describeError(e),
      );
    }
  }

  return (
    <div className="flex min-w-36 flex-col gap-0.5">
      <input
        type="text"
        aria-label={`Cfm # for ${row.order_number} ${row.product_code}`}
        value={text}
        maxLength={100}
        placeholder="—"
        disabled={status === "saving"}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(storedText);
            setStatus(null);
            setError("");
          }
        }}
        className={cn(
          "w-full rounded-md border bg-white px-2 py-1 text-sm focus:ring-1 focus:ring-stone-500 focus:outline-none",
          status === "saving" && "border-amber-400 bg-amber-50",
          status === "saved" && "border-emerald-500 bg-emerald-50",
          status === "failed" && "border-red-400 bg-red-50",
          !status && "border-stone-300",
        )}
      />
      {error ? (
        <span role="alert" className="text-xs text-red-700">
          Not saved: {error}
        </span>
      ) : null}
    </div>
  );
}

function ManifestsHowToUse() {
  return (
    <HowToUse
      title="How to use — Manifests"
      items={[
        <>
          Pick a day with ‹ › or the date box, or click <b>Today</b>. Cancelled
          orders are left out.
        </>,
        <>
          <b>Bus Tour</b> shows one group at a time (the groups from Settings →
          Products). <b>Tickets - SelfDrive</b> shows one tour type at a time
          (the Tour type column in Settings → Products). Click a pill to switch;
          each pill shows its orders and pax. &ldquo;No group yet&rdquo; /
          &ldquo;No tour type yet&rdquo; collects products that haven&apos;t
          been set up in Settings → Products.
        </>,
        <>
          Click <b>☰ Columns</b> to choose which fields to show. Every field
          Rezdy sends is there, grouped (Guest, Trip, Booking, Our records,
          Booking questions…). Your choice is saved to your account, separately
          for each tab. Booking questions only appear on days when an order on
          that tab asked them.
        </>,
        <>
          <b>Cfm #</b>: if the Cfm # column is shown, type the confirmation
          number in the box and click out of it (or press Enter) to save. The
          box turns green when saved. Rezdy&apos;s own confirmation number is a
          separate, read-only column.
        </>,
        <>
          A row marked <b>Legacy</b> comes from data frozen before Aug 16, 2026.
          Booking questions and most Trip / Booking fields are empty for it.
        </>,
        <>
          <b>⬇ Export CSV</b> downloads the rows and columns you see right now
          (this tab and pill only).
        </>,
        <>
          <b>⬆ Upload confirmation #s</b>: upload a vendor&apos;s spreadsheet
          with an order number column and a confirmation number column.
          Matched by order number against this date only, across every tab
          and group — not just the one you&apos;re viewing. Rows that match
          cleanly get the Cfm # written in; a pax mismatch, more than one
          system row for the same order, or a duplicate in the file are left
          red for you to check by hand instead of guessing.
        </>,
      ]}
    />
  );
}
