"use client";

import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { DARK_PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { plex } from "@/components/ui/dark-page";
import { describeError, isStatus } from "@/lib/api-errors";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import {
  assignItem,
  fetchColleagues,
  fetchItem,
  fetchStatuses,
  fileDownloadUrl,
  regenerateItem,
  updateItem,
} from "@/lib/workspace-api";
import type {
  WorkspaceColleague,
  WorkspaceItem,
  WorkspaceStatus,
} from "@/types";

import { describeHistory, formatBytes, formatFull } from "./config";

type View =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      item: WorkspaceItem;
      statuses: WorkspaceStatus[];
      colleagues: WorkspaceColleague[];
    };

const FIELD =
  "rounded-[9px] border border-white/15 bg-[#081624] px-3 py-2 text-[13px] text-[#f8fafc] outline-none focus:border-white/35";
const PLAIN_BUTTON =
  "rounded-[9px] border border-white/15 px-3.5 py-2 text-[13px] font-semibold text-white/85 hover:bg-white/[.07] disabled:opacity-50";

/**
 * 一条工作项（G66 阶段一）：客户 / 主题、状态、下一步（Save）；负责人（Reassign）；读取失败原因 + Read again；
 * 原文和原文件；历史。各去向的审核页（读出的服务、价格……）随各自的模块来（Transfer & Charter 是阶段二）。
 */
export function WorkspaceItemView({ id }: { id: number }) {
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
    const { signal } = controller;
    Promise.all([
      fetchItem(id, signal),
      fetchStatuses(signal),
      fetchColleagues(signal),
    ])
      .then(([item, statuses, colleagues]) =>
        setView({ kind: "ready", item, statuses, colleagues }),
      )
      .catch((error) => {
        if (signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 404)) setView({ kind: "not-found" });
        else if (isStatus(error, 403)) setView({ kind: "forbidden" });
        else setView({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [id, reloadKey, redirectToLogin]);

  return (
    <main className={cn(plex.className, "text-[13px] text-[#f8fafc]")}>
      <div className="mx-auto flex max-w-[1320px] flex-col gap-[18px]">
        <Link
          href="/workspace"
          className="text-[12.5px] font-semibold text-white/70 hover:text-white"
        >
          ← My Workspace
        </Link>
        {view.kind === "loading" ? (
          <Card>Loading…</Card>
        ) : view.kind === "not-found" ? (
          <Card>This work item does not exist (or was removed).</Card>
        ) : view.kind === "forbidden" ? (
          <Card>My Workspace is for back-office staff only.</Card>
        ) : view.kind === "error" ? (
          <Card>
            <p className="text-[#f87171]">Could not load: {view.message}</p>
            <button
              type="button"
              className={cn(PLAIN_BUTTON, "mt-2")}
              onClick={() => setReloadKey((k) => k + 1)}
            >
              Retry
            </button>
          </Card>
        ) : (
          <Ready
            item={view.item}
            statuses={view.statuses}
            colleagues={view.colleagues}
            onItem={(item) =>
              setView((v) => (v.kind === "ready" ? { ...v, item } : v))
            }
            onUnauthorized={redirectToLogin}
          />
        )}
      </div>
    </main>
  );
}

function Card({
  title,
  aside,
  children,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-[16px] border border-white/10 bg-white/[.032] p-[18px]"
    >
      {title ? (
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {aside ? <div className="ml-auto">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function Ready({
  item,
  statuses,
  colleagues,
  onItem,
  onUnauthorized,
}: {
  item: WorkspaceItem;
  statuses: WorkspaceStatus[];
  colleagues: WorkspaceColleague[];
  onItem: (item: WorkspaceItem) => void;
  onUnauthorized: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [status, setStatus] = useState(item.status_code);
  const [nextStep, setNextStep] = useState(item.next_step);
  const [owner, setOwner] = useState(String(item.owner_id));
  const [busy, setBusy] = useState<null | "save" | "assign" | "read">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty =
    title !== item.title ||
    status !== item.status_code ||
    nextStep !== item.next_step;
  const people = new Map(colleagues.map((c) => [c.id, c.name]));
  // 停用的状态不在下拉里；这条正好是停用的状态时照样列出来，不让它看起来像别的状态。
  const statusOptions = statuses.some((s) => s.code === item.status_code)
    ? statuses
    : [
        ...statuses,
        {
          code: item.status_code,
          name: item.status_name ?? item.status_code,
        } as WorkspaceStatus,
      ];

  async function run(
    kind: "save" | "assign" | "read",
    call: () => Promise<WorkspaceItem>,
    done: string,
  ) {
    setBusy(kind);
    setMsg(null);
    try {
      const next = await call();
      onItem(next);
      setTitle(next.title);
      setStatus(next.status_code);
      setNextStep(next.next_step);
      setOwner(String(next.owner_id));
      setMsg({ ok: true, text: done });
    } catch (error) {
      if (isStatus(error, 401)) onUnauthorized();
      else setMsg({ ok: false, text: describeError(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[26px] leading-[1.15] font-bold tracking-[-.02em]">
          {item.item_no}
        </h1>
        <span className="text-white/70">{item.destination_name}</span>
        <span
          className="font-semibold"
          style={{ color: item.status_color || undefined }}
        >
          {item.status_name ?? item.status_code}
        </span>
        <span className="ml-auto text-[12px] text-white/50">
          Created {formatFull(item.created_at)} · Updated{" "}
          {formatFull(item.updated_at)}
        </span>
      </header>

      {item.read_error ? (
        <div
          role="status"
          data-read-error
          className="rounded-[12px] border border-[rgba(251,191,36,.5)] bg-[rgba(251,191,36,.08)] px-4 py-3"
        >
          <p className="font-semibold text-[#fde68a]">
            The system could not read this one
          </p>
          <p className="mt-1 text-white/85">{item.read_error}</p>
          <p className="mt-1 text-white/60">
            The work item and the original are saved. Fix the cause, then read
            it again.
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              run("read", () => regenerateItem(item.id), "Read again.")
            }
            className={cn(PLAIN_BUTTON, "mt-2")}
          >
            {busy === "read" ? "Reading…" : "Read again"}
          </button>
        </div>
      ) : null}

      <Card title="Work item">
        <div className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
          <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-white/70">
            Customer / subject
            <input
              id="ws-title"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              className={cn(FIELD, "font-normal")}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-white/70">
            Status
            <select
              id="ws-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={cn(FIELD, "font-normal")}
            >
              {statusOptions.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-white/70">
            Next step
            <input
              id="ws-next"
              value={nextStep}
              maxLength={200}
              onChange={(e) => setNextStep(e.target.value)}
              className={cn(FIELD, "font-normal")}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!dirty || busy !== null}
            onClick={() =>
              run(
                "save",
                () =>
                  updateItem(item.id, {
                    title,
                    status,
                    next_step: nextStep,
                  }),
                "Saved.",
              )
            }
            className={DARK_PRIMARY_BUTTON_CLASS}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <span className="mx-1 h-6 w-px bg-white/15" aria-hidden />
          <label className="flex items-center gap-2 text-white/70">
            Owner
            <select
              id="ws-owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className={FIELD}
            >
              {!people.has(item.owner_id) ? (
                <option value={String(item.owner_id)}>{item.owner_name}</option>
              ) : null}
              {colleagues.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={owner === String(item.owner_id) || busy !== null}
            onClick={() =>
              run(
                "assign",
                () => assignItem(item.id, Number(owner)),
                `Handed to ${people.get(Number(owner)) ?? "them"}.`,
              )
            }
            className={DARK_PRIMARY_BUTTON_CLASS}
          >
            {busy === "assign" ? "Reassigning…" : "Reassign"}
          </button>
          {msg ? (
            <span
              role="status"
              className={msg.ok ? "text-[#4ade80]" : "text-[#f87171]"}
            >
              {msg.text}
            </span>
          ) : null}
        </div>
      </Card>

      <Card title="Review">
        <p className="text-white/60" data-review-placeholder>
          The review screen for {item.destination_name} comes with that module.
          For now, read the original below and track the work with the status
          and next step above.
        </p>
      </Card>

      <Card
        title="Original"
        aside={
          <span className="text-[12px] text-white/50">
            {item.source === "file" ? "Uploaded file" : "Pasted email"}
          </span>
        }
      >
        {item.files.length ? (
          <ul className="mb-3 flex flex-col gap-1.5">
            {item.files.map((f) => (
              <li key={f.id}>
                <a
                  href={fileDownloadUrl(item.id, f.id)}
                  className="font-semibold text-[#7dd3fc] hover:text-white"
                >
                  ⬇ {f.filename}
                </a>{" "}
                <span className="text-white/50">
                  {formatBytes(f.size_bytes)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {item.raw_text ? (
          <pre
            className="max-h-[420px] overflow-auto rounded-[10px] border border-white/10 bg-[#081624] px-3.5 py-3 font-[inherit] text-[13px] leading-[1.55] [overflow-wrap:anywhere] whitespace-pre-wrap text-white/85"
            data-raw-text
          >
            {item.raw_text}
          </pre>
        ) : (
          <p className="text-white/50">No text was read from the file.</p>
        )}
      </Card>

      <Card title="History">
        {item.history.length ? (
          <ul className="flex flex-col gap-1.5" data-history>
            {item.history.map((h, i) => (
              <li key={i} className="flex flex-wrap gap-x-3">
                <span className="w-[170px] shrink-0 text-white/50">
                  {formatFull(h.created_at)}
                </span>
                <span className="font-semibold">{h.actor_name || h.actor}</span>
                <span className="text-white/80">
                  {describeHistory(h, statuses, people)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-white/50">No changes yet.</p>
        )}
      </Card>
    </>
  );
}
