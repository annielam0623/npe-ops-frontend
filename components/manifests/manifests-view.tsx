"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { HowToUse } from "@/components/ui/how-to-use";
import { ErrorBanner } from "@/components/ui/panel";
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

// 样子照旧后台 manifests.html / base.html（Annie 2026-10-07：和旧版一模一样）。
/** base.html 的 .btn：深色底上的半透明按钮。 */
const LEGACY_BTN_CLASS =
  "inline-flex h-9 items-center justify-center gap-2 rounded-[10px] border border-white/10 bg-white/[.04] px-3.5 text-[13px] font-[650] whitespace-nowrap text-white transition hover:bg-white/[.08] disabled:cursor-not-allowed disabled:opacity-50";
/** manifests.html 的 .btn-nav（‹ ›）。 */
const NAV_BTN_CLASS =
  "flex h-7 w-7 items-center justify-center rounded-[7px] border-[0.5px] border-black/15 bg-white text-[15px] text-[#555] hover:bg-[#f5f5f3] disabled:opacity-50";
/** 旧页「No bookings for this date / filter.」：直接写在深色底上。 */
const EMPTY_CLASS = "p-8 text-center text-[13px] text-[#aaa]";
/** ops 才有的提示条，用旧页 .sp-onhold 的配色。 */
const NOTE_CLASS =
  "mb-4 rounded-[10px] border-[0.5px] border-[#ba7517]/30 bg-[#faeeda] px-3.5 py-2 text-[13px] text-[#854f0b]";

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
    <main className="text-stone-800">
      {state?.kind === "forbidden" ? (
        <div className={EMPTY_CLASS}>
          <p className="font-medium">Staff access required</p>
          <p className="mt-1">This page is for office staff.</p>
        </div>
      ) : (
        <>
          {/* 照旧页 .date-nav：‹ 日期 › Today；Columns / Export CSV / Upload 是 ops 才有的，同样用旧版 .btn。 */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label="Previous day"
              onClick={() => changeDate(shiftYmd(date, -1))}
              disabled={!date}
              className={NAV_BTN_CLASS}
            >
              ‹
            </button>
            <input
              type="date"
              aria-label="Manifest date"
              value={date}
              onChange={(e) => changeDate(e.target.value)}
              className="h-7 min-w-[120px] rounded-[7px] border-[0.5px] border-black/15 bg-white px-3.5 text-center text-[13px] font-medium text-[#1a1a1a] focus:outline-none"
            />
            <button
              type="button"
              aria-label="Next day"
              onClick={() => changeDate(shiftYmd(date, 1))}
              disabled={!date}
              className={NAV_BTN_CLASS}
            >
              ›
            </button>
            <button
              type="button"
              aria-pressed={!!date && date === today}
              onClick={() => changeDate(laToday())}
              className={LEGACY_BTN_CLASS}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setPicking(true)}
              disabled={!shown}
              className={LEGACY_BTN_CLASS}
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
              className={LEGACY_BTN_CLASS}
            >
              ↓ Export CSV
            </button>
            <button
              type="button"
              onClick={() => setUploadingCfm(true)}
              disabled={!date}
              className={LEGACY_BTN_CLASS}
            >
              ↑ Upload confirmation #s
            </button>
            <span className="text-[12px] text-[#94a3b8]">
              {loading ? "Loading…" : null}
            </span>
          </div>

          <div className="mb-3 text-[17px] font-medium text-[#f8fafc]">
            Manifest
          </div>

          <div
            role="tablist"
            aria-label="Manifest type"
            className="mb-3.5 flex border-b-[0.5px] border-white/10"
          >
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={t.key === tab}
                onClick={() => changeTab(t.key)}
                className={cn(
                  "-mb-[0.5px] border-b-2 px-5 py-[7px] text-[13px]",
                  t.key === tab
                    ? "border-[#f8fafc] font-medium text-[#f8fafc]"
                    : "border-transparent text-[#888] hover:text-[#f8fafc]",
                )}
              >
                {t.label}{" "}
                <span className="ml-[3px] text-[11px] font-normal text-[#94a3b8] tabular-nums">
                  {data ? `${t.orders} · ${t.pax} pax` : ""}
                </span>
              </button>
            ))}
          </div>

          {prefNote ? <p className={NOTE_CLASS}>{prefNote}</p> : null}

          {state?.kind === "error" ? (
            <div className="mb-4">
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => {
                  satisfiedRef.current = "";
                  setReloadKey((k) => k + 1);
                }}
              >
                Could not load manifests: {state.message}
              </ErrorBanner>
            </div>
          ) : null}

          {shown && shown.pills.length ? (
            <div
              role="group"
              aria-label={tab === "bus" ? "Group" : "Tour type"}
              className="mb-4 flex flex-wrap gap-1.5"
            >
              {shown.pills.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={p.key === shown.pill}
                  onClick={() => p.key !== shown.pill && setPill(p.key)}
                  className={cn(
                    "rounded-[20px] border-[0.5px] bg-white px-3 py-[3px] text-[12px] whitespace-nowrap",
                    p.key === shown.pill
                      ? "border-[#1a1a1a] font-medium text-[#1a1a1a]"
                      : "border-black/15 text-[#555] hover:border-black/30 hover:text-[#1a1a1a]",
                    p.key.endsWith(":none") &&
                      p.key !== shown.pill &&
                      "border-dashed",
                  )}
                >
                  {p.label}{" "}
                  <span
                    className={cn(
                      "ml-[3px] text-[11px] font-normal tabular-nums",
                      p.key === shown.pill ? "text-[#666]" : "text-[#aaa]",
                    )}
                  >
                    {p.orders} · {p.pax} pax
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {shown && (shown.denied.length || shown.unknown.length) ? (
            <p className="mb-3 text-[12px] text-[#94a3b8]">
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
            <p className={NOTE_CLASS}>
              ⚠️ {plural(legacyCount, "row")} on this page{" "}
              {legacyCount === 1 ? "comes" : "come"} from data frozen before Aug
              16, 2026 (marked <span className="font-medium">Legacy</span>
              ). Booking questions and most Trip / Booking fields are empty for
              {legacyCount === 1 ? " it" : " them"}.
            </p>
          ) : null}

          {state?.kind === "loading" && !shown ? (
            <div className={EMPTY_CLASS}>Loading…</div>
          ) : null}

          {shown && shown.rows.length === 0 && state === null ? (
            <div className={EMPTY_CLASS}>
              No live {TAB_FALLBACK_LABEL[tab]} orders for this date.
            </div>
          ) : null}

          {shown && shown.rows.length ? (
            <section
              className={cn(
                "mb-4 overflow-hidden rounded-[10px] border-[0.5px] border-black/10 bg-white transition-opacity",
                loading && "opacity-50",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-3.5 py-[9px]">
                <h2 className="text-[13px] font-medium text-[#1a1a1a]">
                  {currentPill?.label ?? ""}
                </h2>
                <span className="text-[11px] text-[#aaa] tabular-nums">
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
      <table className="w-full min-w-[800px] border-collapse text-[12px]">
        <thead className="border-b-[0.5px] border-black/[.08] text-left text-[11px] font-medium text-[#999]">
          <tr>
            {data.fields.map((k) => {
              const f = byKey.get(k);
              const numeric = f?.type === "number" || f?.type === "money";
              return (
                <th
                  key={k}
                  className={cn(
                    "bg-white px-2.5 py-[7px] font-medium whitespace-nowrap hover:bg-[#f9f9f7]",
                    numeric && "text-right",
                  )}
                >
                  {f?.label ?? k}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr
              key={r.row_key}
              className="border-b-[0.5px] border-black/[.06] align-middle last:border-b-0 hover:bg-[#fafaf8]"
            >
              {data.fields.map((k, i) => (
                <td
                  key={k}
                  className={cn(
                    "px-2.5 py-2",
                    k === "order_number" ? "text-[#378ADD]" : "text-[#444]",
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
                      className="ml-1.5 inline-block rounded-[10px] bg-[#faeeda] px-2 py-0.5 text-[11px] text-[#ba7517]"
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
  if (!text) return <span className="text-[#ccc]">—</span>;
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
    <div className="flex flex-col gap-0.5">
      <input
        type="text"
        aria-label={`Cfm # for ${row.order_number} ${row.product_code}`}
        value={text}
        maxLength={100}
        placeholder="Add #"
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
          // 旧页 .inline-edit：无框、底下一条虚线；存的状态用底线和底色表示。
          "w-[90px] border-b bg-transparent px-0.5 py-px font-[inherit] text-[12px] text-[#1a1a1a] placeholder:text-[#ccc] focus:border-solid focus:outline-none",
          status === "saving" && "border-amber-400 bg-amber-50",
          status === "saved" && "border-emerald-500 bg-emerald-50",
          status === "failed" && "border-red-400 bg-red-50",
          !status && "border-dashed border-black/20 focus:border-black/50",
        )}
      />
      {error ? (
        <span role="alert" className="text-[11px] text-[#a32d2d]">
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
          <b>↓ Export CSV</b> downloads the rows and columns you see right now
          (this tab and pill only).
        </>,
        <>
          <b>↑ Upload confirmation #s</b>: upload a vendor&apos;s spreadsheet
          with an order number column and a confirmation number column. Matched
          by order number against this date only, across every tab and group —
          not just the one you&apos;re viewing. Rows that match cleanly get the
          Cfm # written in; a pax mismatch, more than one system row for the
          same order, or a duplicate in the file are left red for you to check
          by hand instead of guessing.
        </>,
      ]}
    />
  );
}
