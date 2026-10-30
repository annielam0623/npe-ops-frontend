"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { DARK_PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { byTick } from "@/lib/by-tick";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchQuotes,
  fetchRateCard,
  generateQuote,
  previewQuote,
  quotePdfUrl,
} from "@/lib/tcq-api";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/staff-permissions";
import { fetchItem, updateItem } from "@/lib/workspace-api";
import type { WorkspaceItem } from "@/types";
import type {
  TcqOption,
  TcqQuotePreview,
  TcqQuoteSummary,
  TcqRate,
  TcqServiceKind,
  TcqVehicle,
} from "@/types/tcq";

import {
  blankManualLine,
  blankService,
  buildProbe,
  buildRequest,
  type DraftManualLine,
  type DraftService,
  goneSelected,
  hasQuoteContent,
  initialDraft,
  money,
  parseDollars,
  paxOf,
  priceChanged,
  readProbe,
  SERVICE_COLOR,
  SERVICE_LABEL,
  serviceProblem,
  shortDate,
  shownVehicles,
  type TcqDraft,
} from "./config";
import { QuoteSheet } from "./quote-sheet";

const FIELD =
  "rounded-[8px] border border-white/15 bg-[#081624] px-2 py-[5px] text-[13px] text-[#f8fafc] outline-none focus:border-white/35 disabled:opacity-50";
const PLAIN_BUTTON =
  "rounded-[9px] border border-white/15 px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap text-white/85 hover:bg-white/[.07] disabled:opacity-50";
const SMALL_BUTTON =
  "rounded-[8px] border border-white/15 px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap text-white/85 hover:bg-white/[.07] disabled:opacity-50";
const DEBOUNCE_MS = 450;

const LA_TODAY = () =>
  new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });

function Card({
  title,
  note,
  aside,
  label,
  children,
}: {
  title: string;
  note?: ReactNode;
  aside?: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="rounded-[16px] border border-white/10 bg-white/[.032] p-[18px]"
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {note ? <span className="text-white/62">{note}</span> : null}
        {aside ? (
          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            {aside}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Flag({ children }: { children: ReactNode }) {
  return (
    <p className="text-[12.5px] text-[#fde68a]" data-flag>
      ⚠ {children}
    </p>
  );
}

type Msg = { ok: boolean; text: string } | null;

/**
 * Transfer & Charter Quotation 的审核 + 报价（后端 G66 阶段二；Annie 2026-10-15 看预览
 * https://claude.ai/artifact/VFKkNAZ1mHVA6yuW1CEyQz 同意）。放在工作项页原来的「Review」那一块。
 * - 1 Services：每项服务坐得下的车、价（按价目表，staff 可改）、算式；包车 Hours / Rate；读取时的黄字；Edit / Remove；没读出来的行。
 * - 2 Extra lines and quote options：手动行、客户名、小费、税、三段条款（这张单自己的）。
 * - 3 Quote：一改就调 preview（不存），版式同 PDF；Save draft 存 `edited`；Generate quote 取单号、锁价、状态 → Quote sent。
 * - 4 Quotes generated：历次单号 + PDF。
 * 价一律由服务端按当时的价目表算，前端只传 staff 的选择和改过的价。
 */
export function TcqReview({
  item,
  isAdmin,
  onItem,
  onUnauthorized,
}: {
  item: WorkspaceItem;
  isAdmin: boolean;
  onItem: (item: WorkspaceItem) => void;
  onUnauthorized: () => void;
}) {
  // 「Rate card settings →」链接：那一页要 quotation.rates_edit（全部按照勾选，置顶 10c；开关关着照旧按 admin）。
  // Super Admin：开关对他不生效（perms.active 为 false），走 legacy，admin 本来就是 true。
  const showRates = byTick(usePermissions(), "quotation.rates_edit", {
    legacy: isAdmin,
    superAdmin: false,
  });
  const [draft, setDraft] = useState<TcqDraft>(() =>
    initialDraft(item.parsed, item.edited, item.title),
  );
  // 刚打开、什么都没改 = 和工作项上的一样（读取结果本来就存着），不算没存的改动。
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(draft));
  const [rateCard, setRateCard] = useState<TcqVehicle[] | null>(null);
  const [rateErr, setRateErr] = useState<string | null>(null);
  const [probe, setProbe] = useState<Map<string, Map<number, TcqOption>>>(
    () => new Map(),
  );
  const [preview, setPreview] = useState<TcqQuotePreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [quotes, setQuotes] = useState<TcqQuoteSummary[] | null>(null);
  const [quotesErr, setQuotesErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "generate">(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [lastQuote, setLastQuote] = useState<{ id: number; no: string } | null>(
    null,
  );
  const [openEdit, setOpenEdit] = useState<Set<string>>(
    () =>
      new Set(
        draft.services.filter((s) => serviceProblem(s)).map((s) => s.key),
      ),
  );

  const draftJson = JSON.stringify(draft);
  const dirty = draftJson !== savedJson;
  const built = useMemo(
    () =>
      buildRequest(draft, rateCard ? new Set(rateCard.map((v) => v.id)) : null),
    [draft, rateCard],
  );
  const canQuote = hasQuoteContent(built.request);

  // 价目表（坐得下的车）和历次报价。
  useEffect(() => {
    const c = new AbortController();
    fetchRateCard(c.signal)
      .then(setRateCard)
      .catch((e) => {
        if (c.signal.aborted) return;
        if (isStatus(e, 401)) onUnauthorized();
        else setRateErr(describeError(e));
      });
    fetchQuotes(item.id, c.signal)
      .then(setQuotes)
      .catch((e) => {
        if (c.signal.aborted) return;
        if (isStatus(e, 401)) onUnauthorized();
        else setQuotesErr(describeError(e));
      });
    return () => c.abort();
  }, [item.id, onUnauthorized]);

  // 一改就重算：probe（每辆坐得下的车的价）+ preview（报价单）。都不存。
  useEffect(() => {
    if (!rateCard) return;
    const c = new AbortController();
    const t = window.setTimeout(() => {
      const probeReq = buildProbe(draft, rateCard);
      const req = built.request;
      setPreviewBusy(true);
      Promise.all([
        probeReq
          ? previewQuote(item.id, probeReq, c.signal).then(readProbe)
          : Promise.resolve(new Map<string, Map<number, TcqOption>>()),
        hasQuoteContent(req)
          ? previewQuote(item.id, req, c.signal)
          : Promise.resolve(null),
      ])
        .then(([p, q]) => {
          setProbe(p);
          setPreview(q);
          setPreviewErr(null);
        })
        .catch((e) => {
          if (c.signal.aborted) return;
          if (isStatus(e, 401)) onUnauthorized();
          else setPreviewErr(describeError(e));
        })
        .finally(() => {
          if (!c.signal.aborted) setPreviewBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(t);
      c.abort();
    };
    // draftJson 代表 draft 的内容；built 由 draft 算出。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJson, rateCard, item.id, onUnauthorized]);

  // 有没存的改动时离开页面先问。
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty]);

  function patchService(key: string, patch: Partial<DraftService>) {
    setDraft((d) => ({
      ...d,
      services: d.services.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    }));
  }
  function patchLine(key: string, patch: Partial<DraftManualLine>) {
    setDraft((d) => ({
      ...d,
      manual_lines: d.manual_lines.map((m) =>
        m.key === key ? { ...m, ...patch } : m,
      ),
    }));
  }
  function addService(line = "", unreadIndex?: number) {
    const s = blankService(line);
    setDraft((d) => ({
      ...d,
      services: [...d.services, s],
      unread:
        unreadIndex == null
          ? d.unread
          : d.unread.filter((_, i) => i !== unreadIndex),
    }));
    setOpenEdit((o) => new Set(o).add(s.key));
  }
  function toggleEdit(key: string) {
    setOpenEdit((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  async function saveDraft(): Promise<boolean> {
    const snapshot = draft;
    const next = await updateItem(item.id, { edited: snapshot });
    setSavedJson(JSON.stringify(snapshot));
    onItem(next);
    return true;
  }

  async function onSave() {
    setBusy("save");
    setMsg(null);
    try {
      await saveDraft();
      setMsg({ ok: true, text: "Draft saved." });
    } catch (e) {
      if (isStatus(e, 401)) onUnauthorized();
      else setMsg({ ok: false, text: describeError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function onGenerate() {
    setBusy("generate");
    setMsg(null);
    try {
      // 先存草稿：之后打开工作项看到的就是出单时的样子。
      await saveDraft();
      const q = await generateQuote(item.id, built.request);
      setLastQuote({ id: q.id, no: q.quote_no });
      setMsg({
        ok: true,
        text: `${q.quote_no} is ready. Download the PDF and email it to the client.`,
      });
      const [fresh, list] = await Promise.all([
        fetchItem(item.id),
        fetchQuotes(item.id),
      ]);
      onItem(fresh);
      setQuotes(list);
    } catch (e) {
      if (isStatus(e, 401)) onUnauthorized();
      else setMsg({ ok: false, text: describeError(e) });
    } finally {
      setBusy(null);
    }
  }

  const pdfProblems = preview?.pdf_problems ?? [];
  const generateBlocked =
    !canQuote ||
    built.problems.length > 0 ||
    pdfProblems.length > 0 ||
    previewBusy ||
    !!previewErr ||
    !preview;
  const flaggedCount = draft.services.filter((s) => s.flags.length).length;

  return (
    <>
      {/* ── 1 Services ── */}
      <Card
        label="Services"
        title="1 · Services"
        note={
          <>
            {draft.services.length} service
            {draft.services.length === 1 ? "" : "s"}
            {flaggedCount ? (
              <>
                {" · "}
                <span className="font-semibold text-[#fbbf24]">
                  {flaggedCount} to check
                </span>
              </>
            ) : null}
          </>
        }
        aside={
          <>
            {showRates ? (
              <Link
                href="/settings/transfer-charter"
                className="font-semibold text-[#7dd3fc] hover:text-white"
              >
                Rate card settings →
              </Link>
            ) : null}
            <button
              type="button"
              className={SMALL_BUTTON}
              onClick={() => addService()}
            >
              + Add a service
            </button>
          </>
        }
      >
        <p className="-mt-1 mb-3 text-[12px] text-white/50">
          Only vehicles that fit the group are listed. Tick the ones to show on
          the quote; each ticked vehicle gets its own block so the client can
          choose. Every price can be changed.
        </p>
        {rateErr ? (
          <p className="mb-3 text-[#f87171]">
            Could not load the rate card: {rateErr}
          </p>
        ) : null}
        <div className="flex flex-col gap-2.5">
          {draft.services.length === 0 ? (
            <p className="text-white/50" data-no-services>
              No services yet. Add one, or add a line from “Not read” below.
            </p>
          ) : null}
          {draft.services.map((s, i) => (
            <ServiceCard
              key={s.key}
              index={i}
              s={s}
              rateCard={rateCard}
              prices={probe.get(s.key)}
              editing={openEdit.has(s.key)}
              onEdit={() => toggleEdit(s.key)}
              onChange={(patch) => patchService(s.key, patch)}
              onRemove={() =>
                setDraft((d) => ({
                  ...d,
                  services: d.services.filter((x) => x.key !== s.key),
                }))
              }
            />
          ))}
          {draft.unread.length ? (
            <div
              className="rounded-[12px] border border-dashed border-[rgba(251,191,36,.45)] bg-[rgba(251,191,36,.08)] px-3.5 py-3"
              data-unread
            >
              <b className="text-[#fde68a]">
                Not read from the email ({draft.unread.length})
              </b>
              <span className="text-[12px] text-white/50">
                {" "}
                — these lines had no date the system could use. Add one as a
                service if it is a trip.
              </span>
              <ul className="mt-2 flex flex-col gap-1.5">
                {draft.unread.map((line, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2.5">
                    <span className="min-w-0 rounded-[6px] border border-white/10 bg-[#081624] px-2 py-[3px] [overflow-wrap:anywhere] text-white/85">
                      {line}
                    </span>
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      onClick={() => addService(line, i)}
                    >
                      + Add as a service
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Card>

      {/* ── 2 Extra lines and quote options ── */}
      <Card
        label="Extra lines and quote options"
        title="2 · Extra lines and quote options"
        note="Tickets, day tours, out-of-town trips — anything the rate card does not price."
        aside={
          <button
            type="button"
            className={SMALL_BUTTON}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                manual_lines: [...d.manual_lines, blankManualLine()],
              }))
            }
          >
            + Add a line
          </button>
        }
      >
        {draft.manual_lines.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="text-left text-[11.5px] text-white/62">
                  {[
                    "Put it in",
                    "Group name",
                    "Date",
                    "Description",
                    "Qty",
                    "Unit price",
                    "Taxed",
                    "",
                  ].map((h, i) => (
                    <th
                      key={i}
                      className={cn(
                        "border-b border-white/10 px-2 py-1.5 font-semibold",
                        (h === "Qty" || h === "Unit price") && "text-right",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draft.manual_lines.map((m) => (
                  <tr key={m.key} data-manual-line className="align-middle">
                    <td className="px-2 py-1.5">
                      <select
                        aria-label="Put it in"
                        value={m.vehicle_id}
                        onChange={(e) =>
                          patchLine(m.key, { vehicle_id: e.target.value })
                        }
                        className={FIELD}
                      >
                        <option value="">Its own block</option>
                        {(rateCard ?? []).map((v) => (
                          <option key={v.id} value={String(v.id)}>
                            {v.name} block
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        aria-label="Group name"
                        value={m.group}
                        disabled={!!m.vehicle_id}
                        placeholder={
                          m.vehicle_id ? "—" : "e.g. Admission tickets"
                        }
                        maxLength={80}
                        onChange={(e) =>
                          patchLine(m.key, { group: e.target.value })
                        }
                        className={cn(FIELD, "w-[150px]")}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        aria-label="Date"
                        value={m.date}
                        onChange={(e) =>
                          patchLine(m.key, { date: e.target.value })
                        }
                        className={cn(FIELD, "w-[140px] [color-scheme:dark]")}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        aria-label="Description"
                        value={m.description}
                        maxLength={300}
                        onChange={(e) =>
                          patchLine(m.key, { description: e.target.value })
                        }
                        className={cn(FIELD, "w-full min-w-[200px]")}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        aria-label="Quantity"
                        inputMode="decimal"
                        value={m.qty}
                        onChange={(e) =>
                          patchLine(m.key, { qty: e.target.value })
                        }
                        className={cn(FIELD, "w-[56px] text-right")}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        aria-label="Unit price"
                        inputMode="decimal"
                        placeholder="$0.00"
                        value={m.unit}
                        onChange={(e) =>
                          patchLine(m.key, { unit: e.target.value })
                        }
                        className={cn(FIELD, "w-[90px] text-right")}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        aria-label="Taxed"
                        checked={m.taxable}
                        onChange={(e) =>
                          patchLine(m.key, { taxable: e.target.checked })
                        }
                        className="size-4 accent-[#fbbf24]"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        className={SMALL_BUTTON}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            manual_lines: d.manual_lines.filter(
                              (x) => x.key !== m.key,
                            ),
                          }))
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-white/50">No extra lines.</p>
        )}

        <div className="mt-4 grid [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))] gap-4">
          <label className="flex flex-col gap-1.5 text-[11.5px] font-semibold text-white/72">
            Client (printed on the quote)
            <input
              id="tcq-client"
              value={draft.client}
              maxLength={200}
              onChange={(e) =>
                setDraft((d) => ({ ...d, client: e.target.value }))
              }
              className={cn(FIELD, "font-normal")}
            />
          </label>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[11.5px] font-semibold text-white/72">
              Driver gratuity
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-white/85">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="tcq-gratuity"
                  checked={draft.gratuity === "line"}
                  onChange={() => setDraft((d) => ({ ...d, gratuity: "line" }))}
                  className="accent-[#fbbf24]"
                />
                A line per day (rate card amount)
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="tcq-gratuity"
                  checked={draft.gratuity === "terms"}
                  onChange={() =>
                    setDraft((d) => ({ ...d, gratuity: "terms" }))
                  }
                  className="accent-[#fbbf24]"
                />
                Terms wording only
              </label>
            </div>
            <span className="text-[12px] text-white/50">
              Vehicles with no gratuity per day on the rate card always use the
              wording.
            </span>
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[11.5px] font-semibold text-white/72">
              State excise tax
            </legend>
            <label className="flex items-center gap-1.5 text-white/85">
              <input
                type="checkbox"
                id="tcq-tax"
                checked={draft.tax}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, tax: e.target.checked }))
                }
                className="size-4 accent-[#fbbf24]"
              />
              Add {preview?.tax_pct && draft.tax ? `${preview.tax_pct}% ` : ""}
              tax to each block
            </label>
            <span className="text-[12px] text-white/50">
              The rate comes from settings.
            </span>
          </fieldset>
        </div>

        <div className="mt-4 grid [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))] gap-4">
          {(
            [
              ["inclusions", "Inclusions"],
              ["not_included", "Not included"],
              ["assumptions", "Pricing assumptions"],
            ] as const
          ).map(([k, label]) => {
            const fallback = preview?.terms[k]?.join("\n");
            return (
              <label
                key={k}
                className="flex flex-col gap-1.5 text-[11.5px] font-semibold text-white/72"
              >
                <span>
                  {label}{" "}
                  <span className="font-normal text-white/50">
                    · one per line · this quote only
                    {draft[k] === null ? " · default" : ""}
                  </span>
                </span>
                <textarea
                  id={`tcq-${k}`}
                  rows={4}
                  // 默认文字来自设置（preview 带回来）；还没回来时不能改，免得存成空的。
                  readOnly={draft[k] === null && fallback === undefined}
                  value={draft[k] ?? fallback ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [k]: e.target.value }))
                  }
                  className={cn(FIELD, "resize-y leading-[1.5] font-normal")}
                />
              </label>
            );
          })}
        </div>
        {draft.inclusions !== null ||
        draft.not_included !== null ||
        draft.assumptions !== null ? (
          <button
            type="button"
            className={cn(SMALL_BUTTON, "mt-2")}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                inclusions: null,
                not_included: null,
                assumptions: null,
              }))
            }
          >
            Reset the three to the defaults
          </button>
        ) : null}
      </Card>

      {/* ── 3 Quote ── */}
      <Card
        label="Quote"
        title="3 · Quote"
        note={
          previewBusy
            ? "Updating…"
            : "Updates as you change things above. Nothing is saved and no quote number is taken until you click Generate quote."
        }
      >
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
          <div className="flex min-w-0 flex-col gap-2.5">
            {built.problems.length ? (
              <div
                className="rounded-[10px] border border-[rgba(248,113,113,.5)] bg-[rgba(248,113,113,.08)] px-3 py-2 text-[12.5px] text-[#fecaca]"
                data-problems
              >
                <b>Fix these before generating:</b>
                <ul className="mt-1 list-disc pl-5">
                  {built.problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {pdfProblems.length ? (
              <div
                className="rounded-[10px] border border-[rgba(248,113,113,.5)] bg-[rgba(248,113,113,.08)] px-3 py-2 text-[12.5px] text-[#fecaca]"
                data-pdf-problems
              >
                The PDF can only print English letters. Replace these first:{" "}
                <b>{pdfProblems.join(" ")}</b>
              </div>
            ) : null}
            {previewErr ? (
              <p className="text-[#f87171]" data-preview-error>
                Could not work out the quote: {previewErr}
              </p>
            ) : null}
            {preview?.flags.length
              ? preview.flags.map((f, i) => <Flag key={i}>{f}</Flag>)
              : null}
            {!canQuote ? (
              <p className="text-white/50" data-quote-empty>
                Tick a vehicle or add a line to see the quote.
              </p>
            ) : preview ? (
              <QuoteSheet
                header={preview.terms.header}
                quoteNo={null}
                date={LA_TODAY()}
                client={preview.client}
                blocks={preview.blocks}
                taxOn={preview.tax_on}
                taxLabel={preview.terms.tax_label}
                alternatives={preview.alternatives}
                terms={preview.terms}
                staffNotes
              />
            ) : !previewErr ? (
              <p className="text-white/50">Working out the quote…</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={busy !== null || !dirty}
              onClick={onSave}
              className={cn(DARK_PRIMARY_BUTTON_CLASS, "w-full py-2.5")}
            >
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
            <p className="text-[12px] text-white/62">
              {dirty
                ? "Unsaved changes. Save keeps your ticks and prices on this work item."
                : "Saved. Open this work item later and carry on."}
            </p>
            <button
              type="button"
              disabled={busy !== null || generateBlocked}
              onClick={onGenerate}
              className={cn(DARK_PRIMARY_BUTTON_CLASS, "mt-1.5 w-full py-2.5")}
            >
              {busy === "generate" ? "Generating…" : "Generate quote"}
            </button>
            <p className="text-[12px] text-white/62">
              Takes a quote number, locks today&apos;s prices and terms, and
              sets the status to Quote sent. Then download the PDF and email it
              yourself.
            </p>
            {msg ? (
              <p
                role="status"
                className={msg.ok ? "text-[#4ade80]" : "text-[#f87171]"}
                data-msg
              >
                {msg.text}
              </p>
            ) : null}
            {lastQuote ? (
              <a
                href={quotePdfUrl(lastQuote.id)}
                className={cn(PLAIN_BUTTON, "text-center")}
                data-last-pdf
              >
                ⬇ {lastQuote.no} PDF
              </a>
            ) : null}
          </div>
        </div>
      </Card>

      {/* ── 4 Quotes generated ── */}
      <Card
        label="Quotes generated"
        title="4 · Quotes generated"
        note="Newest first. Each one keeps the prices from the day it was made; generate again for a new number at today's prices."
      >
        {quotesErr ? (
          <p className="text-[#f87171]">
            Could not load the quotes: {quotesErr}
          </p>
        ) : quotes === null ? (
          <p className="text-white/50">Loading…</p>
        ) : quotes.length === 0 ? (
          <p className="text-white/50" data-no-quotes>
            No quotes yet.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr className="text-left text-[11.5px] text-white/62">
                    {[
                      "Quote #",
                      "Client",
                      "Made by",
                      "When",
                      "All blocks added up",
                      "",
                    ].map((h, i) => (
                      <th
                        key={i}
                        className={cn(
                          "border-b border-white/10 px-2 py-1.5 font-semibold",
                          i === 4 && "text-right",
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => (
                    <tr key={q.id} data-quote={q.quote_no}>
                      <td className="border-b border-white/[.06] px-2 py-1.5 font-semibold">
                        {q.quote_no}
                      </td>
                      <td className="border-b border-white/[.06] px-2 py-1.5">
                        {q.client || "—"}
                      </td>
                      <td className="border-b border-white/[.06] px-2 py-1.5">
                        {q.created_by_name || "—"}
                      </td>
                      <td className="border-b border-white/[.06] px-2 py-1.5 whitespace-nowrap">
                        {new Date(q.created_at).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: "America/Los_Angeles",
                        })}
                      </td>
                      <td className="border-b border-white/[.06] px-2 py-1.5 text-right tabular-nums">
                        {money(q.total_cents)}
                      </td>
                      <td className="border-b border-white/[.06] px-2 py-1.5">
                        <a
                          href={quotePdfUrl(q.id)}
                          className="font-semibold text-[#7dd3fc] hover:text-white"
                        >
                          ⬇ PDF
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] text-white/50">
              “All blocks added up” is for staff only — the quote and PDF only
              print each block&apos;s own total.
            </p>
          </>
        )}
      </Card>
    </>
  );
}

function ServiceCard({
  index,
  s,
  rateCard,
  prices,
  editing,
  onEdit,
  onChange,
  onRemove,
}: {
  index: number;
  s: DraftService;
  rateCard: TcqVehicle[] | null;
  prices: Map<number, TcqOption> | undefined;
  editing: boolean;
  onEdit: () => void;
  onChange: (patch: Partial<DraftService>) => void;
  onRemove: () => void;
}) {
  const problem = serviceProblem(s);
  const kind = s.service || null;
  const pax = paxOf(s);
  const fit = rateCard ? shownVehicles(rateCard, s) : [];
  const gone = goneSelected(rateCard, s);
  const first = fit.length ? prices?.get(fit[0].id) : undefined;
  const facts: string[] = [];
  if (s.pax) facts.push(`${s.pax} pax`);
  if (s.flight || s.time)
    facts.push(
      [
        s.flight,
        kind === "departure" ? "departs" : kind === "arrival" ? "lands" : "",
        s.time,
      ]
        .filter(Boolean)
        .join(" "),
    );
  if (s.places.length) facts.push(s.places.join(" → "));

  function setPrice(vid: number, raw: string) {
    const prices = { ...s.prices, [String(vid)]: raw };
    onChange({ prices });
  }
  function resetPrice(vid: number) {
    const { [String(vid)]: _drop, ...rest } = s.prices;
    void _drop;
    onChange({ prices: rest });
  }
  function toggleVehicle(vid: number, on: boolean) {
    onChange({
      selected: on
        ? [...s.selected.filter((x) => x !== vid), vid]
        : s.selected.filter((x) => x !== vid),
    });
  }

  return (
    <div
      data-service={index + 1}
      className={cn(
        "flex flex-col gap-2.5 rounded-[12px] border bg-white/[.015] px-3.5 py-3",
        s.flags.length || problem
          ? "border-[rgba(251,191,36,.45)]"
          : "border-white/10",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
        <span className="min-w-[78px] text-[14px] font-bold">
          {s.date ? shortDate(s.date) : "No date"}
        </span>
        {kind ? (
          <span
            className="text-[11.5px] font-bold tracking-[.05em] uppercase"
            style={{ color: SERVICE_COLOR[kind] }}
          >
            {SERVICE_LABEL[kind]}
          </span>
        ) : (
          <span className="text-[11.5px] font-bold tracking-[.05em] text-[#fbbf24] uppercase">
            Pick a service type
          </span>
        )}
        <span className="min-w-0 [overflow-wrap:anywhere] text-white/85">
          {facts.join(" · ")}
        </span>
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            className={SMALL_BUTTON}
            aria-expanded={editing}
            onClick={onEdit}
          >
            {editing ? "Done" : "Edit"}
          </button>
          <button type="button" className={SMALL_BUTTON} onClick={onRemove}>
            Remove
          </button>
        </span>
      </div>

      {editing ? (
        <div
          className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[10px] border border-dashed border-white/15 px-3 py-2.5 text-[12px] text-white/72"
          data-edit-row
        >
          <label className="flex items-center gap-1.5">
            Date
            <input
              type="date"
              aria-label="Date"
              value={s.date}
              onChange={(e) => onChange({ date: e.target.value })}
              className={cn(FIELD, "[color-scheme:dark]")}
            />
          </label>
          <label className="flex items-center gap-1.5">
            Service
            <select
              aria-label="Service"
              value={s.service}
              onChange={(e) =>
                onChange({ service: e.target.value as TcqServiceKind | "" })
              }
              className={FIELD}
            >
              <option value="">Pick…</option>
              <option value="arrival">Airport pickup</option>
              <option value="departure">Airport drop-off</option>
              <option value="charter">Hourly charter</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            Pax
            <input
              aria-label="Pax"
              inputMode="numeric"
              value={s.pax}
              onChange={(e) => onChange({ pax: e.target.value })}
              className={cn(FIELD, "w-[56px]")}
            />
          </label>
          {kind !== "charter" ? (
            <>
              <label className="flex items-center gap-1.5">
                Flight
                <input
                  aria-label="Flight"
                  value={s.flight}
                  maxLength={20}
                  onChange={(e) => onChange({ flight: e.target.value })}
                  className={cn(FIELD, "w-[80px]")}
                />
              </label>
              <label className="flex items-center gap-1.5">
                Time
                <input
                  aria-label="Time"
                  value={s.time}
                  maxLength={20}
                  placeholder="16:20"
                  onChange={(e) => onChange({ time: e.target.value })}
                  className={cn(FIELD, "w-[72px]")}
                />
              </label>
            </>
          ) : null}
          <label className="flex items-center gap-1.5">
            Places
            <input
              aria-label="Places"
              value={s.places.join(", ")}
              placeholder="Comma between places"
              onChange={(e) =>
                onChange({
                  places: e.target.value.split(",").map((p) => p.trimStart()),
                })
              }
              className={cn(FIELD, "w-[260px]")}
            />
          </label>
          <label className="flex items-center gap-1.5">
            Description on the quote
            <input
              aria-label="Description on the quote"
              value={s.description}
              maxLength={300}
              placeholder="Empty = standard wording"
              onChange={(e) => onChange({ description: e.target.value })}
              className={cn(FIELD, "w-[260px]")}
            />
          </label>
          {s.line ? (
            <span className="w-full [overflow-wrap:anywhere] text-white/50">
              From the email: “{s.line}”
            </span>
          ) : null}
        </div>
      ) : null}

      {kind === "arrival" || kind === "charter" ? (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[12px] text-white/62">
          {kind === "arrival" ? (
            <label className="flex items-center gap-1.5">
              Price
              <select
                aria-label="International or domestic"
                value={
                  s.international === null
                    ? ""
                    : s.international
                      ? "intl"
                      : "dom"
                }
                onChange={(e) =>
                  onChange({
                    international:
                      e.target.value === "" ? null : e.target.value === "intl",
                  })
                }
                className={cn(
                  FIELD,
                  s.international === null && "border-[rgba(251,191,36,.6)]",
                )}
              >
                <option value="">Airline not known — domestic price</option>
                <option value="intl">International flight</option>
                <option value="dom">Domestic flight</option>
              </select>
            </label>
          ) : (
            <>
              <label className="flex items-center gap-1.5">
                Hours
                <input
                  aria-label="Hours"
                  inputMode="decimal"
                  value={s.hours}
                  placeholder="min"
                  onChange={(e) => onChange({ hours: e.target.value })}
                  className={cn(FIELD, "w-[56px]")}
                />
              </label>
              <span className="flex items-center gap-1.5">
                Rate
                <span
                  className="inline-flex overflow-hidden rounded-[8px] border border-white/15"
                  role="group"
                  aria-label="Rate"
                >
                  {(["auto", "normal", "event"] as TcqRate[]).map((r, ri) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={s.rate === r}
                      onClick={() => onChange({ rate: r })}
                      className={cn(
                        "px-2.5 py-1 text-[12px] font-semibold capitalize",
                        ri > 0 && "border-l border-white/15",
                        s.rate === r
                          ? "bg-[#fbbf24] text-[#111]"
                          : "text-white/62 hover:bg-white/[.07]",
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </span>
              </span>
              {first ? (
                <span data-rate-used>
                  {s.rate === "auto" ? "Auto → " : ""}
                  {first.rate_used === "event"
                    ? `event rate${first.event ? ` (${first.event})` : ""}`
                    : "normal rate"}
                  {s.hours.trim()
                    ? ""
                    : ` · ${first.included_hours} hr minimum assumed`}
                </span>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {problem ? (
        <p className="text-[12.5px] text-[#fbbf24]" data-service-problem>
          This service {problem} before it can be priced.
        </p>
      ) : !rateCard ? null : fit.length === 0 ? (
        <p className="text-[12.5px] text-[#fbbf24]">
          No vehicle on the rate card seats {s.pax} guests. Change the number,
          or add an extra line instead.
        </p>
      ) : (
        <div className="grid [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))] gap-2">
          {fit.map((v) => {
            const opt = prices?.get(v.id);
            const on = s.selected.includes(v.id);
            const raw = s.prices[String(v.id)];
            const changed = priceChanged(raw, opt?.price_cents);
            const invalid = raw !== undefined && parseDollars(raw) == null;
            return (
              <div
                key={v.id}
                data-vehicle={v.name}
                data-on={on || undefined}
                className={cn(
                  "grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5 rounded-[10px] border px-2.5 py-2",
                  on
                    ? "border-[#fbbf24] bg-[rgba(251,191,36,.06)]"
                    : "border-white/10",
                )}
              >
                <input
                  type="checkbox"
                  aria-label={`Quote ${v.name}`}
                  checked={on}
                  onChange={(e) => toggleVehicle(v.id, e.target.checked)}
                  className="size-[15px] accent-[#fbbf24]"
                />
                <span className="font-semibold">{v.name}</span>
                <input
                  aria-label={`${v.name} price`}
                  inputMode="decimal"
                  value={raw ?? (opt ? money(opt.price_cents) : "")}
                  placeholder="…"
                  onChange={(e) => setPrice(v.id, e.target.value)}
                  onBlur={() => {
                    // 改回和价目表一样 ⇒ 不算改过。
                    if (
                      raw !== undefined &&
                      opt &&
                      parseDollars(raw) === opt.price_cents
                    )
                      resetPrice(v.id);
                  }}
                  className={cn(
                    FIELD,
                    "w-[90px] text-right tabular-nums",
                    invalid && "border-[#f87171]",
                  )}
                />
                {changed && opt ? (
                  <span
                    className="col-span-2 col-start-2 text-[11.5px] text-[#fbbf24]"
                    data-changed
                  >
                    Changed · rate card {money(opt.price_cents)}{" "}
                    <button
                      type="button"
                      className="underline hover:text-white"
                      onClick={() => resetPrice(v.id)}
                    >
                      undo
                    </button>
                  </span>
                ) : (
                  <span
                    className="col-span-2 col-start-2 text-[11.5px] text-white/45"
                    data-calc
                  >
                    {opt?.calc ?? "Working out the price…"}
                  </span>
                )}
                {pax && v.seats < pax ? (
                  <span
                    className="col-span-2 col-start-2 text-[11.5px] text-[#fbbf24]"
                    data-too-small
                  >
                    Only {v.seats} seats for {pax} guests
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {gone.length ? (
        <Flag>
          {gone.length === 1 ? "A vehicle" : `${gone.length} vehicles`} you
          ticked {gone.length === 1 ? "is" : "are"} no longer on the rate card,
          so {gone.length === 1 ? "it is" : "they are"} left out of the quote.
        </Flag>
      ) : null}

      {s.flags.length ? (
        <div className="flex flex-col gap-0.5">
          {s.flags.map((f, i) => (
            <Flag key={i}>{f}</Flag>
          ))}
        </div>
      ) : null}
    </div>
  );
}
