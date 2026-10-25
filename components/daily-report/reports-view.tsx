"use client";

import { IBM_Plex_Sans } from "next/font/google";
import { useCallback, useEffect, useRef, useState } from "react";

import { CenteredPage } from "@/components/ui/centered-page";
import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import {
  fetchOperationReport,
  fetchOperationReports,
  fetchReportAssignees,
  updateOperationReport,
} from "@/lib/daily-report-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type {
  CurrentUser,
  OperationReport,
  OperationReportList,
  OperationReportPatch,
  OperationReportQuery,
  ReportAssignee,
  ReportType,
} from "@/types";

import { REPORT_TYPES, TYPE_LABEL, TYPE_TEXT_CLASS } from "./config";
import { LOG_BUTTON_CLASS, savedMessage } from "./dor-section";
import { LogIncidentDialog } from "./log-incident-dialog";
import { ReportItem } from "./report-item";
import { useDorVisible } from "./use-dor-visible";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const PAGE_SIZE = 50;

type StatusFilter = "unresolved" | "resolved" | "all";
const STATUS_QUERY: Record<StatusFilter, string | undefined> = {
  unresolved: undefined, // 后端默认 open,in_progress
  resolved: "resolved",
  all: "open,in_progress,resolved",
};
const STATUS_TABS: [StatusFilter, string][] = [
  ["unresolved", "Unresolved"],
  ["resolved", "Resolved"],
  ["all", "All"],
];

const INPUT_CLASS =
  "rounded-lg border border-white/20 bg-black/[.28] px-2.5 py-1.5 text-[13px] text-[#f8fafc] placeholder:text-white/35 [color-scheme:dark]";

interface Filters {
  status: StatusFilter;
  type: "" | ReportType;
  followUp: string; // "" 任何人 / "none" 未分配 / 用户 id
  from: string;
  to: string;
  q: string;
}
const NO_FILTERS: Filters = {
  status: "unresolved",
  type: "",
  followUp: "",
  from: "",
  to: "",
  q: "",
};

function toQuery(f: Filters, offset: number): OperationReportQuery {
  return {
    status: STATUS_QUERY[f.status],
    type: f.type || undefined,
    follow_up_user_id: f.followUp
      ? f.followUp === "none"
        ? "none"
        : Number(f.followUp)
      : undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    q: f.q.trim() || undefined,
    limit: PAGE_SIZE,
    offset,
  };
}

/** /daily-report：全部记录（含已解决）+ 筛选 + 改状态 / 跟进人。通知链接 ?id=12 会把那条置顶展开。 */
export function ReportsView() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [fatal, setFatal] = useState<
    { kind: "forbidden" } | { kind: "error"; message: string } | null
  >(null);
  const redirectingRef = useRef(false);
  const onUnauthorized = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchCurrentUser(controller.signal)
      .then(setMe)
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else if (isStatus(error, 403)) setFatal({ kind: "forbidden" });
        else setFatal({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [onUnauthorized]);

  return (
    <main className={cn(plex.className, "text-[#f8fafc]")}>
      <CenteredPage className="flex flex-col gap-3">
        <h1 className="db-title text-[18px]">Daily Operation Report</h1>
        {fatal?.kind === "forbidden" ? (
          <Notice>Staff access required.</Notice>
        ) : fatal ? (
          <ErrorBanner dark>
            Failed to load your account: {fatal.message}
          </ErrorBanner>
        ) : !me ? (
          <Notice>Loading…</Notice>
        ) : (
          <Gate me={me} onUnauthorized={onUnauthorized} />
        )}
      </CenteredPage>
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/[.032] p-[22px] text-sm text-white/60">
      {children}
    </div>
  );
}

/** 板块没放给我（或开关接口读不到）：不请求 DOR 接口，只说还没开放。 */
function Gate({
  me,
  onUnauthorized,
}: {
  me: CurrentUser;
  onUnauthorized: () => void;
}) {
  const visibility = useDorVisible(onUnauthorized);
  if (visibility === "loading") return <Notice>Loading…</Notice>;
  if (visibility === "hidden") {
    return <Notice>This section is not available yet.</Notice>;
  }
  return <Reports me={me} onUnauthorized={onUnauthorized} />;
}

type ListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: OperationReportList };

function Reports({
  me,
  onUnauthorized,
}: {
  me: CurrentUser;
  onUnauthorized: () => void;
}) {
  const canEdit = !!(me.is_supervisor || me.is_admin);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // 搜索框输入防抖：停一下再查，不是每个字符一次请求。
  const [search, setSearch] = useState("");
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [extra, setExtra] = useState<OperationReport[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [assignees, setAssignees] = useState<ReportAssignee[]>([]);
  const [linked, setLinked] = useState<OperationReport | null>(null);
  const [logging, setLogging] = useState(false);
  const [toast, setToast] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((f) => (f.q === search ? f : { ...f, q: search })),
      300,
    );
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    setExtra([]);
    (async () => {
      try {
        const data = await fetchOperationReports(
          toQuery(filters, 0),
          controller.signal,
        );
        if (!controller.signal.aborted) setState({ kind: "ready", data });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else setState({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [filters, reloadKey, onUnauthorized]);

  // 跟进人下拉：筛选和改跟进人都要用；拿不到就只有「任何人 / 未分配」。
  useEffect(() => {
    const controller = new AbortController();
    fetchReportAssignees(controller.signal)
      .then(setAssignees)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  // 通知点进来的 ?id=12：单独取这条置顶展开（不一定在当前筛选结果里）。
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("id");
    const id = raw ? Number(raw) : NaN;
    if (!Number.isInteger(id) || id <= 0) return;
    const controller = new AbortController();
    fetchOperationReport(id, controller.signal)
      .then((d) => setLinked(d.report))
      .catch(() => undefined);
    return () => controller.abort();
  }, [reloadKey]);

  async function loadMore() {
    if (state.kind !== "ready" || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchOperationReports(
        toQuery(filters, state.data.items.length + extra.length),
      );
      setExtra((prev) => [...prev, ...next.items]);
    } catch (error) {
      if (isStatus(error, 401)) onUnauthorized();
      else setToast(describeError(error));
    } finally {
      setLoadingMore(false);
    }
  }

  async function handlePatch(
    id: number,
    patch: OperationReportPatch,
  ): Promise<string | null> {
    try {
      await updateOperationReport(id, patch);
      reload();
      return null;
    } catch (error) {
      if (isStatus(error, 401)) onUnauthorized();
      return describeError(error);
    }
  }

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  const data = state.kind === "ready" ? state.data : null;
  const items = data ? [...data.items, ...extra] : [];
  const linkedId = linked?.id;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {data ? (
          <span className="flex flex-wrap gap-x-3 text-[12px] font-bold">
            {REPORT_TYPES.map((t) => (
              <span key={t} className={TYPE_TEXT_CLASS[t]}>
                {TYPE_LABEL[t]} {data.counts[t]}
              </span>
            ))}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setToast("");
            setLogging(true);
          }}
          className={cn(LOG_BUTTON_CLASS, "ml-auto")}
        >
          + Log an incident
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Status filter" className="flex gap-1">
          {STATUS_TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filters.status === key}
              onClick={() => setFilter("status", key)}
              className={cn(
                "rounded-md border px-3 py-1 text-[12.5px]",
                filters.status === key
                  ? "border-[#f8fafc] bg-[#f8fafc] font-semibold text-[#06101c]"
                  : "border-white/25 hover:bg-white/[.08]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          aria-label="Type filter"
          value={filters.type}
          onChange={(e) => setFilter("type", e.target.value as "" | ReportType)}
          className={INPUT_CLASS}
        >
          <option value="">All types</option>
          {REPORT_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          aria-label="Follow-up filter"
          value={filters.followUp}
          onChange={(e) => setFilter("followUp", e.target.value)}
          className={INPUT_CLASS}
        >
          <option value="">Anyone</option>
          <option value="none">Not assigned</option>
          {assignees.map((u) => (
            <option key={u.id} value={String(u.id)}>
              {u.display_name}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="From date"
          value={filters.from}
          max={filters.to || undefined}
          onChange={(e) => setFilter("from", e.target.value)}
          className={INPUT_CLASS}
        />
        <input
          type="date"
          aria-label="To date"
          value={filters.to}
          min={filters.from || undefined}
          onChange={(e) => setFilter("to", e.target.value)}
          className={INPUT_CLASS}
        />
        <input
          type="search"
          aria-label="Search reports"
          placeholder="Search text or CHD#"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={cn(INPUT_CLASS, "min-w-[180px] flex-1")}
        />
      </div>

      <p role="status" className="min-h-[18px] text-[12.5px] text-[#86efac]">
        {toast}
      </p>

      {linked ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          <ReportItem
            key={`${linked.id}-${linked.updated_at}`}
            report={linked}
            canEdit={canEdit}
            assignees={assignees}
            defaultExpanded
            onPatch={handlePatch}
          />
        </ul>
      ) : null}

      {state.kind === "loading" ? (
        <Notice>Loading…</Notice>
      ) : state.kind === "error" ? (
        <ErrorBanner dark actionLabel="Retry" onAction={reload}>
          Failed to load reports: {state.message}
        </ErrorBanner>
      ) : items.length === 0 ? (
        <Notice>
          {filters.status === "unresolved" && !filters.q && !filters.type
            ? "No unresolved incidents."
            : "No reports match these filters."}
        </Notice>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {items
              .filter((r) => r.id !== linkedId)
              .map((report) => (
                <ReportItem
                  key={report.id}
                  report={report}
                  canEdit={canEdit}
                  assignees={assignees}
                  onPatch={handlePatch}
                />
              ))}
          </ul>
          <div className="flex items-center justify-between text-[12.5px] text-white/60">
            <span>
              Showing {items.length} of {data?.total}
            </span>
            {data && items.length < data.total ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded-md border border-white/25 px-3 py-1 text-[12.5px] text-[#f8fafc] hover:bg-white/[.08] disabled:opacity-60"
              >
                {loadingMore ? "Loading…" : "Show more"}
              </button>
            ) : null}
          </div>
        </>
      )}

      {logging ? (
        <LogIncidentDialog
          onClose={() => setLogging(false)}
          onUnauthorized={onUnauthorized}
          onCreated={(result) => {
            setLogging(false);
            setToast(savedMessage(result));
            reload();
          }}
        />
      ) : null}
    </>
  );
}
