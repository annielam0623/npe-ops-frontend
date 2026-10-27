"use client";

import { useEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  createShuttleRoute,
  fetchShuttleRoutes,
  shuttleFieldKey,
  updateShuttleRoute,
  type ShuttleDirection,
  type ShuttleGroupOption,
  type ShuttleRoute,
} from "@/lib/shuttle-routes-api";
import { cn } from "@/lib/utils";

import { SHUTTLE_SUBJECT_NOTE, SHUTTLE_VARS } from "./fields";
import { type Studio, TextFieldCard } from "./studio-cards";

type LoadState =
  { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" };

/** 卡片怎么画见 ShuttleFieldCard（主题只读说明；短信 / 邮件正文带 Insert；guest page 照旧可编辑，Annie 2026-10-26）。 */
const FIELDS: {
  key: "sms_body" | "email_subject" | "email_body" | "guest_page_body";
  label: string;
  rows: number;
}[] = [
  { key: "sms_body", label: "SMS body", rows: 4 },
  { key: "email_subject", label: "Email subject", rows: 1 },
  { key: "email_body", label: "Email body", rows: 6 },
  { key: "guest_page_body", label: "Guest confirmation page text", rows: 6 },
];

/**
 * Content Studio → Shuttle（后端 G128）：没有 Global / 没有 Preview（后端两份实现文档都写明是
 * 刻意不做，不是漏做——还没有发送逻辑，没有真实渲染规则可预览）。路线 = Products 里
 * `booking_type = "shuttle"` 的 Group × 方向，staff 自己在这里加 / 改名，不提供删除。
 */
export function ShuttleRoutesPanel({
  studio,
  onUnauthorized,
}: {
  studio: Studio;
  onUnauthorized: () => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [routes, setRoutes] = useState<ShuttleRoute[]>([]);
  const [groups, setGroups] = useState<ShuttleGroupOption[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    (async () => {
      try {
        const data = await fetchShuttleRoutes(controller.signal);
        setRoutes(data.routes);
        setGroups(data.shuttle_groups);
        setCurrent((c) =>
          c && data.routes.some((r) => r.id === c)
            ? c
            : (data.routes[0]?.id ?? null),
        );
        setState({ kind: "ready" });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) {
          onUnauthorizedRef.current();
          return;
        }
        setState({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

  if (state.kind === "loading") {
    return (
      <p className="py-5 text-[13px] text-[#888] night:text-white/55">
        Loading…
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <div
        role="alert"
        className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[#fca5a5] bg-[#fff5f5] px-3 py-2 text-[12px] text-[#dc2626] night:border-red-500/30 night:bg-red-500/10 night:text-red-300"
      >
        <span>Could not load Shuttle routes: {state.message}</span>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="shrink-0 cursor-pointer rounded-[6px] border border-[#dc2626] px-2.5 py-0.5 text-[11px] font-medium night:border-red-500/30"
        >
          Retry
        </button>
      </div>
    );
  }

  const route = routes.find((r) => r.id === current) ?? null;

  return (
    <>
      <div className="mb-2.5 text-[10px] font-bold tracking-[0.07em] text-[#9B8F88] uppercase night:text-white/50">
        Routes
      </div>
      <p className="mb-3 text-[11px] leading-[1.5] text-[#6B5E57] night:text-white/65">
        A route is one shuttle group and direction (outbound / inbound).
        Renaming a route only changes the name shown here — it does not move or
        lose any saved text. There is no delete; switch Active off instead.
      </p>

      {routes.map((r) => (
        <RouteRow
          key={r.id}
          route={r}
          onSaved={(updated) =>
            setRoutes((rs) =>
              rs.map((x) => (x.id === updated.id ? updated : x)),
            )
          }
          onUnauthorized={onUnauthorizedRef.current}
        />
      ))}
      <AddRouteForm
        groups={groups}
        onCreated={(created) => {
          setRoutes((rs) => [...rs, created]);
          setCurrent(created.id);
        }}
        onUnauthorized={onUnauthorizedRef.current}
      />

      <div className="mt-[18px] mb-2.5 text-[10px] font-bold tracking-[0.07em] text-[#9B8F88] uppercase night:text-white/50">
        Templates
      </div>
      {routes.length ? (
        <>
          <p className="mb-3 text-[11px] leading-[1.5] text-[#6B5E57] night:text-white/65">
            Pick a route, then edit its SMS, Email, and Guest Page text below.
          </p>
          <div
            role="group"
            aria-label="Route"
            className="mb-3.5 flex flex-wrap items-start gap-1.5"
          >
            {routes.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={current === r.id}
                onClick={() => {
                  setCurrent(r.id);
                  studio.setActive(null);
                }}
                className={cn(
                  "cursor-pointer rounded-[20px] border px-[11px] py-1 text-[11px] font-medium transition-all",
                  current === r.id
                    ? "border-[#0ea5e9] bg-[#0ea5e9] text-white"
                    : "border-black/15 bg-paper text-[#1a1a1a] hover:border-[#1a1a1a] hover:text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/75 night:hover:border-white/40 night:hover:text-white/90",
                  !r.is_active && "opacity-50",
                )}
              >
                {r.label}
                {!r.is_active ? " · Off" : ""}
              </button>
            ))}
          </div>
          {route
            ? FIELDS.map((f) => (
                <ShuttleFieldCard
                  key={f.key}
                  fieldKey={shuttleFieldKey(route, f.key)}
                  label={f.label}
                  rows={f.rows}
                  studio={studio}
                />
              ))
            : null}
        </>
      ) : (
        <p className="text-[11px] text-[#1a1a1a] night:text-white/50">
          No routes yet — add one above to start editing its text.
        </p>
      )}
    </>
  );
}

function RouteRow({
  route,
  onSaved,
  onUnauthorized,
}: {
  route: ShuttleRoute;
  onSaved: (r: ShuttleRoute) => void;
  onUnauthorized: () => void;
}) {
  const [label, setLabel] = useState(route.label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setLabel(route.label), [route.label]);

  async function saveLabel() {
    const next = label.trim();
    if (!next || next === route.label) {
      setLabel(route.label);
      return;
    }
    setBusy(true);
    setError("");
    try {
      onSaved(await updateShuttleRoute(route.id, { label: next }));
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setLabel(route.label);
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(checked: boolean) {
    setBusy(true);
    setError("");
    try {
      onSaved(await updateShuttleRoute(route.id, { is_active: checked }));
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-2.5 overflow-hidden rounded-[10px] border border-black/10 bg-paper night:border-white/10 night:bg-white/[.04]">
      <div className="flex items-start justify-between gap-2.5 px-3.5 pt-2.5 pb-2.5">
        <div className="min-w-0 flex-1">
          <input
            type="text"
            aria-label={`Rename ${route.label}`}
            value={label}
            disabled={busy}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => void saveLabel()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setLabel(route.label);
            }}
            className="w-full border-0 bg-transparent p-0 text-[12px] font-semibold text-[#1a1a1a] focus:outline-none night:text-white/90"
          />
          <div className="mt-px font-mono text-[10px] text-[#1a1a1a]/45 night:text-white/35">
            {route.group_display_name} · {route.direction}
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] whitespace-nowrap text-[#1a1a1a] night:text-white/65">
          <input
            type="checkbox"
            checked={route.is_active}
            disabled={busy}
            onChange={(e) => void toggleActive(e.target.checked)}
          />
          Active
        </label>
      </div>
      {error ? (
        <p className="px-3.5 pb-2 text-[11px] text-[#dc2626] night:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AddRouteForm({
  groups,
  onCreated,
  onUnauthorized,
}: {
  groups: ShuttleGroupOption[];
  onCreated: (r: ShuttleRoute) => void;
  onUnauthorized: () => void;
}) {
  const [groupId, setGroupId] = useState(groups[0] ? String(groups[0].id) : "");
  const [direction, setDirection] = useState<ShuttleDirection>("outbound");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add() {
    if (!groupId || !label.trim()) {
      setError("Pick a group and type a label.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      onCreated(
        await createShuttleRoute({
          manifest_id: Number(groupId),
          direction,
          label: label.trim(),
        }),
      );
      setLabel("");
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const SELECT =
    "rounded-[6px] border border-[#e5e7eb] bg-paper px-2 py-1 text-[11px] text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90";

  return (
    <div className="overflow-hidden rounded-[10px] border border-dashed border-black/15 bg-[#fafaf8] px-3.5 py-3 night:border-white/15 night:bg-white/[.02]">
      <div className="mb-2 text-[11px] font-semibold text-[#1a1a1a] night:text-white/90">
        + Add route
      </div>
      {groups.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Shuttle group"
            value={groupId}
            disabled={busy}
            onChange={(e) => setGroupId(e.target.value)}
            className={SELECT}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.display_name}
              </option>
            ))}
          </select>
          <select
            aria-label="Direction"
            value={direction}
            disabled={busy}
            onChange={(e) => setDirection(e.target.value as ShuttleDirection)}
            className={SELECT}
          >
            <option value="outbound">Outbound</option>
            <option value="inbound">Inbound</option>
          </select>
          <input
            type="text"
            aria-label="Route label"
            value={label}
            disabled={busy}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label, e.g. South Rim — Outbound"
            className="min-w-[160px] flex-1 rounded-[6px] border border-[#e5e7eb] bg-paper px-2 py-1 text-[11px] text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void add()}
            className="cursor-pointer rounded-[6px] border border-[#1a1a1a] bg-paper px-3 py-1 text-[11px] font-medium text-[#1a1a1a] hover:enabled:bg-[#1a1a1a] hover:enabled:text-white disabled:opacity-50 night:border-white/40 night:bg-white/[.04] night:text-white/90"
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-[#1a1a1a]/60 night:text-white/50">
          No Shuttle groups yet — make one in Settings → Products → Groups.
        </p>
      )}
      {error ? (
        <p className="mt-1.5 text-[11px] text-[#dc2626] night:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** 键名最后一段（sms_body / email_subject / email_body / guest_page_body）。 */
const fieldOf = (key: string) => key.split("__").pop() ?? "";

const GUEST_PAGE_HINT =
  "Not sent or shown anywhere yet — Shuttle has no send feature today. This just stores the text for when it does.";

/** Email subject 那一格：只读说明，主题由系统统一出（Annie 2026-10-26 选 B1）。 */
function ShuttleSubjectNote({ fieldKey }: { fieldKey: string }) {
  return (
    <section
      aria-label="Email subject"
      className="mb-2.5 overflow-hidden rounded-[10px] border border-black/10 bg-paper px-3.5 py-2.5 text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90"
    >
      <h3 className="text-[12px] leading-[1.4] font-semibold">Email subject</h3>
      <div className="mt-px font-mono text-[10px] night:text-white/35">
        {fieldKey}
      </div>
      <p className="mt-1.5 text-[11px] leading-[1.5] text-[#6B5E57] night:text-white/65">
        {SHUTTLE_SUBJECT_NOTE}
      </p>
    </section>
  );
}

/** 旧路线面板的一格文案：短信 / 邮件正文带 Insert 变量；主题是只读说明；guest page 文字照旧（没有 Insert）。 */
function ShuttleFieldCard({
  fieldKey,
  label,
  rows,
  studio,
}: {
  fieldKey: string;
  label: string;
  rows: number;
  studio: Studio;
}) {
  const f = fieldOf(fieldKey);
  if (f === "email_subject") return <ShuttleSubjectNote fieldKey={fieldKey} />;
  const guestPage = f === "guest_page_body";
  return (
    <TextFieldCard
      field={{
        key: fieldKey,
        label,
        rows,
        vars: guestPage ? undefined : SHUTTLE_VARS,
        hint: guestPage ? GUEST_PAGE_HINT : undefined,
      }}
      studio={studio}
    />
  );
}
