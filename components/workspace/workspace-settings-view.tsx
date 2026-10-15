"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  BTN_ADD_CLASS,
  BTN_ADD_SMALL_CLASS,
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CARD_TITLE_CLASS,
  FORM_INPUT_CLASS,
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
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import {
  fetchWorkspaceSettings,
  saveDestination,
  saveGeneral,
  saveStatus,
} from "@/lib/workspace-api";
import type {
  WorkspaceDestinationSetting,
  WorkspaceGeneral,
  WorkspaceSettings,
  WorkspaceStatus,
} from "@/types";

type View =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: WorkspaceSettings };

type Result = { tone: "ok" | "error"; text: string } | null;

/**
 * Settings → My Workspace（admin，后端 G66 阶段一）：去向、状态、编号前缀 / 上传上限 / 上传类型。
 * 版式照 Pickup Locations / Vehicles（白卡片 + 表格，每行自己的 Save）。存了立即生效。
 */
export function WorkspaceSettingsView() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchWorkspaceSettings(controller.signal)
      .then((data) => setView({ kind: "ready", data }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setView({ kind: "forbidden" });
        else setView({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  return (
    <main className="text-stone-800 night:text-white/90">
      <LegacyPageHeader
        title="🗂 My Workspace"
        count={
          view.kind === "ready"
            ? `${view.data.destinations.filter((d) => d.is_enabled).length} of ${view.data.destinations.length} destinations on`
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
          <p className="mt-1">Only admins can change My Workspace settings.</p>
        </Panel>
      ) : view.kind === "error" ? (
        <ErrorBanner
          actionLabel="Retry"
          onAction={() => setReloadKey((k) => k + 1)}
        >
          Could not load My Workspace settings: {view.message}
        </ErrorBanner>
      ) : (
        <>
          <LegacyHowTo title="How to use">
            <li>
              <b>Destinations</b> are the choices under “Where should it go?” in
              My Workspace. Turn one on and it appears there right away; turn it
              off and it disappears.
            </li>
            <li>
              Tick <b>Text</b> / <b>File</b> for what it accepts. If no
              destination accepts files, the Upload file tab is hidden.
            </li>
            <li>
              <b>Statuses</b> are the steps a work item goes through. A closed
              status (Done, Cancelled) hides the item from My work unless
              someone picks that status. Draft is where every item starts, so it
              can’t be turned off or closed.
            </li>
            <li>
              <b>General</b>: the work item number prefix (changes only new
              items), the upload size limit and which file types are allowed.
            </li>
            <li>Each row has its own Save. Changes take effect right away.</li>
          </LegacyHowTo>
          <Destinations
            rows={view.data.destinations}
            onUnauthorized={redirectToLogin}
          />
          <Statuses
            rows={view.data.statuses}
            onUnauthorized={redirectToLogin}
          />
          <General
            value={view.data.general}
            readable={view.data.readable_types}
            onUnauthorized={redirectToLogin}
          />
        </>
      )}
    </main>
  );
}

function useSaver<T>(onUnauthorized: () => void) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  async function save(call: () => Promise<T>, onDone: (v: T) => void) {
    setBusy(true);
    setResult(null);
    try {
      const v = await call();
      onDone(v);
      setResult({ tone: "ok", text: "Saved." });
    } catch (error) {
      if (isStatus(error, 401)) onUnauthorized();
      else setResult({ tone: "error", text: describeError(error) });
    } finally {
      setBusy(false);
    }
  }
  return { busy, result, save };
}

const CHECK = "size-4 accent-[#1a1a1a]";

// ── Destinations ──

function Destinations({
  rows,
  onUnauthorized,
}: {
  rows: WorkspaceDestinationSetting[];
  onUnauthorized: () => void;
}) {
  return (
    <section className={CARD_CLASS} aria-label="Destinations">
      <div className={CARD_HEADER_CLASS}>
        <span className={CARD_TITLE_CLASS}>Destinations</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="text-[#999] night:text-white/50">
              {["Name", "Description", "Text", "File", "On", "Order", ""].map(
                (h) => (
                  <td key={h} className={TH_CLASS}>
                    {h}
                  </td>
                ),
              )}
            </tr>
          </thead>
          <tbody className={TBODY_CLASS}>
            {rows.map((d) => (
              <DestinationRow
                key={d.id}
                row={d}
                onUnauthorized={onUnauthorized}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DestinationRow({
  row,
  onUnauthorized,
}: {
  row: WorkspaceDestinationSetting;
  onUnauthorized: () => void;
}) {
  const [saved, setSaved] = useState(row);
  const [d, setD] = useState(row);
  const { busy, result, save } =
    useSaver<WorkspaceDestinationSetting>(onUnauthorized);
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  return (
    <tr className={cn(TR_CLASS, TR_HOVER)} data-dest-row={row.code}>
      <td className={cn(TD_CLASS, "w-[220px]")}>
        <input
          id={`dest-name-${row.id}`}
          value={d.name}
          onChange={(e) => setD({ ...d, name: e.target.value })}
          className={INLINE_INPUT_CLASS}
        />
      </td>
      <td className={TD_CLASS}>
        <input
          id={`dest-desc-${row.id}`}
          value={d.description}
          onChange={(e) => setD({ ...d, description: e.target.value })}
          className={INLINE_INPUT_CLASS}
        />
      </td>
      <td className={TD_CLASS}>
        <input
          type="checkbox"
          aria-label="Accepts pasted text"
          checked={d.accepts_text}
          onChange={(e) => setD({ ...d, accepts_text: e.target.checked })}
          className={CHECK}
        />
      </td>
      <td className={TD_CLASS}>
        <input
          type="checkbox"
          aria-label="Accepts files"
          checked={d.accepts_file}
          onChange={(e) => setD({ ...d, accepts_file: e.target.checked })}
          className={CHECK}
        />
      </td>
      <td className={TD_CLASS}>
        <input
          type="checkbox"
          aria-label="Turned on"
          checked={d.is_enabled}
          onChange={(e) => setD({ ...d, is_enabled: e.target.checked })}
          className={CHECK}
        />
      </td>
      <td className={cn(TD_CLASS, "w-[80px]")}>
        <input
          type="number"
          aria-label="Order"
          value={d.sort_order}
          onChange={(e) => setD({ ...d, sort_order: Number(e.target.value) })}
          className={cn(INLINE_INPUT_BASE, "w-16")}
        />
      </td>
      <td className={cn(TD_CLASS, "w-[200px] whitespace-nowrap")}>
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() =>
            save(
              () =>
                saveDestination(row.id, {
                  name: d.name,
                  description: d.description,
                  accepts_text: d.accepts_text,
                  accepts_file: d.accepts_file,
                  is_enabled: d.is_enabled,
                  sort_order: d.sort_order,
                }),
              (v) => {
                setSaved(v);
                setD(v);
              },
            )
          }
          className={BTN_ADD_SMALL_CLASS}
        >
          {busy ? "Saving…" : "Save"}
        </button>{" "}
        <span className={resultClass(result?.tone)}>{result?.text}</span>
      </td>
    </tr>
  );
}

// ── Statuses ──

function Statuses({
  rows,
  onUnauthorized,
}: {
  rows: WorkspaceStatus[];
  onUnauthorized: () => void;
}) {
  return (
    <section className={CARD_CLASS} aria-label="Statuses">
      <div className={CARD_HEADER_CLASS}>
        <span className={CARD_TITLE_CLASS}>Statuses</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse">
          <thead>
            <tr className="text-[#999] night:text-white/50">
              {["Name", "Color", "Order", "In use", "Closed", ""].map((h) => (
                <td key={h} className={TH_CLASS}>
                  {h}
                </td>
              ))}
            </tr>
          </thead>
          <tbody className={TBODY_CLASS}>
            {rows.map((s) => (
              <StatusRow key={s.code} row={s} onUnauthorized={onUnauthorized} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusRow({
  row,
  onUnauthorized,
}: {
  row: WorkspaceStatus;
  onUnauthorized: () => void;
}) {
  const [saved, setSaved] = useState(row);
  const [s, setS] = useState(row);
  const { busy, result, save } = useSaver<WorkspaceStatus>(onUnauthorized);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  // 新工作项都从 Draft 开始：不能停用、不能设成已关闭（后端也会拦）。
  const isDraft = row.code === "draft";
  return (
    <tr className={cn(TR_CLASS, TR_HOVER)} data-status-row={row.code}>
      <td className={cn(TD_CLASS, "w-[240px]")}>
        <input
          id={`status-name-${row.code}`}
          value={s.name}
          onChange={(e) => setS({ ...s, name: e.target.value })}
          className={INLINE_INPUT_CLASS}
        />
      </td>
      <td className={TD_CLASS}>
        <span className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Color"
            value={s.color}
            onChange={(e) => setS({ ...s, color: e.target.value })}
            className="h-7 w-10 cursor-pointer rounded border border-black/20 bg-white"
          />
          {/* 预览：My work 里就是这样的彩色字（深色底）。 */}
          <span
            className="rounded bg-[#06101c] px-2 py-0.5 text-[12px] font-semibold"
            style={{ color: s.color }}
          >
            {s.name || "—"}
          </span>
        </span>
      </td>
      <td className={cn(TD_CLASS, "w-[80px]")}>
        <input
          type="number"
          aria-label="Order"
          value={s.sort_order}
          onChange={(e) => setS({ ...s, sort_order: Number(e.target.value) })}
          className={cn(INLINE_INPUT_BASE, "w-16")}
        />
      </td>
      <td className={TD_CLASS}>
        <input
          type="checkbox"
          aria-label="In use"
          checked={s.is_active}
          disabled={isDraft}
          onChange={(e) => setS({ ...s, is_active: e.target.checked })}
          className={CHECK}
        />
      </td>
      <td className={TD_CLASS}>
        <input
          type="checkbox"
          aria-label="Closed"
          checked={s.is_closed}
          disabled={isDraft}
          onChange={(e) => setS({ ...s, is_closed: e.target.checked })}
          className={CHECK}
        />
      </td>
      <td className={cn(TD_CLASS, "w-[200px] whitespace-nowrap")}>
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() =>
            save(
              () =>
                saveStatus(row.code, {
                  name: s.name,
                  color: s.color,
                  sort_order: s.sort_order,
                  is_active: s.is_active,
                  is_closed: s.is_closed,
                }),
              (v) => {
                setSaved(v);
                setS(v);
              },
            )
          }
          className={BTN_ADD_SMALL_CLASS}
        >
          {busy ? "Saving…" : "Save"}
        </button>{" "}
        <span className={resultClass(result?.tone)}>{result?.text}</span>
      </td>
    </tr>
  );
}

// ── General ──

function General({
  value,
  readable,
  onUnauthorized,
}: {
  value: WorkspaceGeneral;
  readable: string[];
  onUnauthorized: () => void;
}) {
  const [saved, setSaved] = useState(value);
  const [g, setG] = useState(value);
  const { busy, result, save } = useSaver<WorkspaceGeneral>(onUnauthorized);
  const dirty = JSON.stringify(g) !== JSON.stringify(saved);
  return (
    <section className={CARD_CLASS} aria-label="General">
      <div className={CARD_HEADER_CLASS}>
        <span className={CARD_TITLE_CLASS}>General</span>
      </div>
      <div className="flex flex-wrap items-end gap-5 px-4 py-4 text-[12px] text-[#555] night:text-white/70">
        <label className="flex flex-col gap-1">
          Work item number prefix
          <input
            id="ws-prefix"
            value={g.item_prefix}
            maxLength={10}
            onChange={(e) => setG({ ...g, item_prefix: e.target.value })}
            className={cn(FORM_INPUT_CLASS, "w-32")}
          />
          <span className="text-[11px] text-[#999]">
            e.g. {g.item_prefix || "WS"}-1042 · new items only
          </span>
        </label>
        <label className="flex flex-col gap-1">
          Upload limit (MB)
          <input
            id="ws-max-mb"
            type="number"
            min={1}
            max={25}
            step={1}
            value={g.upload_max_mb}
            onChange={(e) =>
              setG({ ...g, upload_max_mb: Number(e.target.value) })
            }
            className={cn(FORM_INPUT_CLASS, "w-28")}
          />
          <span className="text-[11px] text-[#999]">1 to 25</span>
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1">File types allowed</legend>
          <div className="flex flex-wrap gap-3">
            {readable.map((t) => (
              <label key={t} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={g.upload_types.includes(t)}
                  onChange={(e) =>
                    setG({
                      ...g,
                      upload_types: e.target.checked
                        ? readable.filter(
                            (x) => x === t || g.upload_types.includes(x),
                          )
                        : g.upload_types.filter((x) => x !== t),
                    })
                  }
                  className={CHECK}
                />
                .{t}
              </label>
            ))}
          </div>
          <span className="text-[11px] text-[#999]">
            Old .xls / .doc files can’t be read; staff are asked to save them as
            .xlsx / .docx.
          </span>
        </fieldset>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={() =>
              save(
                () => saveGeneral(g),
                (v) => {
                  setSaved(v);
                  setG(v);
                },
              )
            }
            className={BTN_ADD_CLASS}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <span className={resultClass(result?.tone)}>{result?.text}</span>
        </div>
      </div>
    </section>
  );
}
