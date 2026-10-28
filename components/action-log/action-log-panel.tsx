"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { formatLogTime } from "@/components/pickup-locations/config";
import { CARD_CLASS, LogToggle } from "@/components/pickup-locations/legacy-ui";
import { describeError, isStatus } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import type { ActionLogPage, ActionLogRow } from "@/types";

/** 小标签的颜色：.log-badge.create（绿）/ .update（蓝）/ .delete（红）。 */
export type VerbTone = "add" | "change" | "delete";
export interface ActionVerb {
  label: string;
  tone: VerbTone;
}

const TONE_CLASS: Record<VerbTone, string> = {
  add: "bg-[#e8f5e9] night:bg-emerald-400/10 text-[#2e7d32] night:text-emerald-300",
  change: "bg-[#e3f2fd] night:bg-sky-400/[.08] text-[#1565c0] night:text-sky-300",
  delete: "bg-[#fdecea] night:bg-red-500/10 text-[#c0392b] night:text-red-300",
};

const DEFAULT_VERBS: Record<string, ActionVerb> = {
  create: { label: "Added", tone: "add" },
  update: { label: "Changed", tone: "change" },
  delete: { label: "Deleted", tone: "delete" },
  deactivate: { label: "Deactivated", tone: "change" },
  reactivate: { label: "Reactivated", tone: "change" },
};

type FirstPage =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      rows: ActionLogRow[];
      cursor: string | null;
      capped: number | null;
      /** 按过 Show more（翻到底时写「That's everything.」）。 */
      paged: boolean;
    };

/**
 * G203 共用 Action Log：放在可编辑页面最底下。默认收起，第一次展开才拉；列 When / Who / What / From → To，
 * 新的在上，每次 50 条，Show more 用上一页的 next_cursor 往前翻。
 * refreshKey 变了（页面上刚存了一处）：展开着就立刻重拉第一页，收起着就等下次展开再拉。
 */
export function ActionLogPanel({
  load,
  refreshKey,
  onUnauthorized,
  note,
  emptyText = "No changes recorded yet.",
  missingText = "No before / after recorded",
  verbs,
}: {
  load: (before: string | null, signal: AbortSignal) => Promise<ActionLogPage>;
  refreshKey: number | string;
  /** 401 时跳登录页；不给就当普通错误显示。 */
  onUnauthorized?: () => void;
  /** 展开后表上面的一行说明（例如 HR 只记字段名、不记值）。 */
  note?: ReactNode;
  emptyText?: string;
  /** from / to 都是 null 的行（只有一句话的旧记录）在 From → To 一格写什么。 */
  missingText?: string;
  /** 各页自己的动作名（例如车辆的 Renumbered）；没列的照 action 原样写、蓝色。 */
  verbs?: Record<string, ActionVerb>;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<FirstPage>({ kind: "idle" });
  const [more, setMore] = useState<{ loading: boolean; error: string | null }>({
    loading: false,
    error: null,
  });
  const controllerRef = useRef<AbortController | null>(null);
  const loadedKeyRef = useRef<number | string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  const fail = useCallback((error: unknown): string | null => {
    if (isStatus(error, 401) && onUnauthorizedRef.current) {
      onUnauthorizedRef.current();
      return null;
    }
    return describeError(error);
  }, []);

  const loadFirst = useCallback(
    (key: number | string) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setPage({ kind: "loading" });
      setMore({ loading: false, error: null });
      loadRef
        .current(null, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          loadedKeyRef.current = key;
          setPage({
            kind: "ready",
            rows: result.entries,
            cursor: result.next_cursor,
            capped: result.capped ?? null,
            paged: false,
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          if (isStatus(error, 403)) {
            setPage({ kind: "forbidden" });
            return;
          }
          const message = fail(error);
          if (message !== null) setPage({ kind: "error", message });
        });
    },
    [fail],
  );

  useEffect(() => {
    if (open && loadedKeyRef.current !== refreshKey) loadFirst(refreshKey);
  }, [open, refreshKey, loadFirst]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  function loadMore(cursor: string) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setMore({ loading: true, error: null });
    loadRef
      .current(cursor, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setMore({ loading: false, error: null });
        setPage((prev) =>
          prev.kind === "ready"
            ? {
                ...prev,
                rows: [...prev.rows, ...result.entries],
                cursor: result.next_cursor,
                paged: true,
              }
            : prev,
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = fail(error);
        setMore({ loading: false, error: message });
      });
  }

  return (
    <section className={CARD_CLASS}>
      <LogToggle open={open} onToggle={() => setOpen((o) => !o)} hideHintWhenOpen />
      {open ? (
        <div data-action-log>
          {note ? <div className={NOTE_CLASS}>{note}</div> : null}
          {page.kind === "idle" || page.kind === "loading" ? (
            <p className={STATUS_CLASS}>Loading…</p>
          ) : page.kind === "forbidden" ? (
            <p className={STATUS_CLASS}>You don&apos;t have access to this page&apos;s log.</p>
          ) : page.kind === "error" ? (
            <ErrorBox message={page.message} onRetry={() => loadFirst(refreshKey)} />
          ) : page.rows.length === 0 ? (
            <p className={STATUS_CLASS}>{emptyText}</p>
          ) : (
            <>
              <LogTable
                rows={page.rows}
                missingText={missingText}
                verbs={verbs}
              />
              <Footer
                cursor={page.cursor}
                capped={page.capped}
                paged={page.paged}
                loading={more.loading}
                error={more.error}
                onMore={loadMore}
              />
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** .log-status */
const STATUS_CLASS =
  "p-[18px] text-center text-[12px] text-[#1a1a1a] night:text-white/35";
/** .log-note */
const NOTE_CLASS =
  "border-b-[0.5px] border-black/[.08] night:border-white/10 px-4 py-2.5 text-[11.5px] text-[#1a1a1a] night:text-white/55";
const TH_CLASS =
  "border-b-[0.5px] border-black/[.08] night:border-white/10 px-2.5 py-2 text-left text-[11px] font-semibold text-[#1a1a1a] night:text-white/90";
/** 同一次保存拆出来的后几行：When / Who 淡灰。 */
const CONT_TEXT = "text-[#b0b0ab] night:text-white/25";

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p
      role="alert"
      className="mx-4 my-3 rounded-[10px] border border-[#f0b4b4] bg-[#fdecec] px-3.5 py-2.5 text-[12.5px] leading-[1.7] text-[#7a1f1f] night:border-red-400/30 night:bg-red-500/10 night:text-red-200"
    >
      Could not load the log: {message}{" "}
      <button type="button" onClick={onRetry} className="cursor-pointer underline">
        Retry
      </button>
    </p>
  );
}

function LogTable({
  rows,
  missingText,
  verbs,
}: {
  rows: ActionLogRow[];
  missingText: string;
  verbs?: Record<string, ActionVerb>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[12px] text-[#1a1a1a] night:text-white/75">
        <thead>
          <tr>
            {["When", "Who", "What", "From → To"].map((h) => (
              <th key={h} className={TH_CLASS}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const prev = rows[i - 1];
            // Q8：同一次保存（at、by 都一样）拆出来的几行，后几行淡灰、中间不画线。
            const cont = !!prev && prev.at === row.at && prev.by === row.by;
            const pad = cont ? "px-2.5 pt-0 pb-[7px]" : "px-2.5 py-[7px]";
            return (
              <tr
                key={i}
                data-cont={cont ? "" : undefined}
                className={cn(
                  "align-top",
                  !cont && i > 0 && "border-t-[0.5px] border-black/[.06] night:border-white/10",
                )}
              >
                <td className={cn(pad, "whitespace-nowrap", cont && CONT_TEXT)}>
                  {row.at ? formatLogTime(row.at) : "—"}
                </td>
                <td className={cn(pad, "font-semibold whitespace-nowrap", cont && CONT_TEXT)}>
                  {row.by}
                </td>
                <td className={cn(pad, "[overflow-wrap:anywhere]")}>
                  <What row={row} verbs={verbs} />
                </td>
                <td className={cn(pad, "max-w-[420px] [overflow-wrap:anywhere] whitespace-pre-wrap")}>
                  <FromTo row={row} missingText={missingText} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function What({
  row,
  verbs,
}: {
  row: ActionLogRow;
  verbs?: Record<string, ActionVerb>;
}) {
  const verb = row.action
    ? (verbs?.[row.action] ??
      DEFAULT_VERBS[row.action] ?? { label: row.action, tone: "change" as const })
    : null;
  return (
    <>
      {verb ? (
        <span
          className={cn(
            "mr-[5px] inline-block rounded-[5px] px-[7px] py-px align-[1px] text-[10px] font-semibold",
            TONE_CLASS[verb.tone],
          )}
        >
          {verb.label}
        </span>
      ) : null}
      {row.what === null ? (
        <span>{row.label}</span>
      ) : (
        <>
          <span className="font-semibold text-[#1a1a1a] night:text-white/90">{row.label}</span>
          {" · "}
          <span className="text-[#555] night:text-white/55">{row.what}</span>
        </>
      )}
    </>
  );
}

const FROM_CLASS = "text-[#c0392b] line-through night:text-red-300";
const TO_CLASS = "text-[#2e7d32] night:text-emerald-300";

function FromTo({ row, missingText }: { row: ActionLogRow; missingText: string }) {
  if (row.from === null && row.to === null) {
    return <span className="text-[11px] text-[#8a8a85] night:text-white/35">{missingText}</span>;
  }
  const from =
    row.from === null ? null : (
      <span className={FROM_CLASS}>
        <LogValue value={row.from} />
      </span>
    );
  const to =
    row.to === null ? null : (
      <span className={TO_CLASS}>
        <LogValue value={row.to} />
      </span>
    );
  if (!from) return to;
  if (!to) return from;
  return (
    <>
      {from} → {to}
    </>
  );
}

/** 空值写斜体浅灰 (empty)（同旧页面 logValue）。 */
function LogValue({ value }: { value: string }) {
  return value ? (
    <>{value}</>
  ) : (
    <i className="text-[#8a8a85] night:text-white/35">(empty)</i>
  );
}

function Footer({
  cursor,
  capped,
  paged,
  loading,
  error,
  onMore,
}: {
  cursor: string | null;
  capped: number | null;
  paged: boolean;
  loading: boolean;
  error: string | null;
  onMore: (cursor: string) => void;
}) {
  if (!cursor && !capped && !paged) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t-[0.5px] border-black/[.06] px-4 py-2.5 text-[12px] text-[#1a1a1a] night:border-white/10 night:text-white/55">
      {cursor ? (
        // 普通灰框键，不用蓝色（蓝色只给提交键）。
        <button
          type="button"
          disabled={loading}
          onClick={() => onMore(cursor)}
          className="inline-flex h-[30px] cursor-pointer items-center rounded-[7px] border-[0.5px] border-black/20 bg-paper px-3.5 text-[12px] font-semibold text-[#1a1a1a] hover:bg-[#ebebe8] disabled:cursor-not-allowed disabled:opacity-60 night:border-white/15 night:bg-white/[.04] night:text-white/90 night:hover:bg-white/[.08]"
        >
          {loading ? "Loading…" : "Show more"}
        </button>
      ) : capped ? (
        <span>Showing the {capped} most recent changes.</span>
      ) : (
        <span>That&apos;s everything.</span>
      )}
      {error ? (
        <span role="alert" className="text-[#A32D2D] night:text-red-300">
          Could not load more: {error}
        </span>
      ) : null}
    </div>
  );
}
