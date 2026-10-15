"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { DARK_PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { plex } from "@/components/ui/dark-page";
import { HowToUse } from "@/components/ui/how-to-use";
import { describeError, isStatus } from "@/lib/api-errors";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import {
  createItem,
  fetchDestinations,
  fetchItems,
  fetchStatuses,
} from "@/lib/workspace-api";
import type {
  WorkspaceDestinations,
  WorkspaceItemList,
  WorkspaceStatus,
} from "@/types";

import { extOf, formatBytes, formatUpdated, sourceLabel } from "./config";

type Tab = "paste" | "upload";
type Scope = "mine" | "team";

type Setup =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      dests: WorkspaceDestinations;
      statuses: WorkspaceStatus[];
    };

/** 选中的标签 / 去向 / 筛选：琥珀色（同 Dispatch 步骤条当前那块），不用蓝色——蓝色只给提交键。 */
const PICKED =
  "border-[rgba(251,191,36,.6)] bg-[rgba(251,191,36,.10)] text-[#fde68a]";
const UNPICKED =
  "border-white/10 bg-white/[.04] text-white/80 hover:bg-white/[.07]";

/**
 * My Workspace（后端 G66 阶段一；版式照任务包预览 Workspace.dc.html）：粘贴文字或上传文件 → 选去向 → Generate
 * → 打开这条工作项审核。下面是 My work（Mine / Whole team、按状态筛选）。
 */
export function WorkspaceView() {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<Tab>("paste");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [destId, setDestId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setSetup({ kind: "loading" });
    Promise.all([
      fetchDestinations(controller.signal),
      fetchStatuses(controller.signal),
    ])
      .then(([dests, statuses]) => {
        setSetup({ kind: "ready", dests, statuses });
        // 只有一个能用的去向时直接选上。
        if (dests.destinations.length === 1)
          setDestId(dests.destinations[0].id);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setSetup({ kind: "forbidden" });
        else setSetup({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  const ready = setup.kind === "ready" ? setup : null;
  const dests = ready?.dests.destinations ?? [];
  const showUpload = !!ready?.dests.show_upload;
  const accepts = (d: (typeof dests)[number]) =>
    tab === "paste" ? d.accepts_text : d.accepts_file;
  const picked = dests.find((d) => d.id === destId) ?? null;

  // 换到另一个标签后，选中的去向不收这种输入就取消选中。
  useEffect(() => {
    if (picked && !accepts(picked)) setDestId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function pickFile(f: File | null) {
    setGenError(null);
    if (!f || !ready) return setFile(null);
    const ext = extOf(f.name);
    const types = ready.dests.upload_types;
    if (ext === "xls" || ext === "doc") {
      setFile(null);
      return setGenError(
        `“${f.name}” is an old ${ext === "xls" ? "Excel" : "Word"} file. Save it as .${ext}x and upload that.`,
      );
    }
    if (!types.includes(ext)) {
      setFile(null);
      return setGenError(
        `“${f.name}” can’t be read here. Upload one of: ${types.join(", ")}.`,
      );
    }
    if (f.size > ready.dests.upload_max_bytes) {
      setFile(null);
      return setGenError(
        `“${f.name}” is ${formatBytes(f.size)}. The limit is ${formatBytes(ready.dests.upload_max_bytes)}.`,
      );
    }
    setFile(f);
  }

  async function generate() {
    setGenError(null);
    if (!picked) return setGenError("Choose where it should go.");
    if (tab === "paste" && !text.trim())
      return setGenError("Paste the email first.");
    if (tab === "upload" && !file) return setGenError("Choose a file first.");
    setBusy(true);
    try {
      const item = await createItem(
        tab === "paste"
          ? { destinationId: picked.id, text }
          : { destinationId: picked.id, file: file! },
      );
      router.push(`/workspace/${item.id}`);
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setGenError(describeError(error));
      setBusy(false);
    }
  }

  return (
    // 深色底、内边距由整站外框提供（同 dashboard）。
    <main className={cn(plex.className, "text-[#f8fafc]")}>
      <div className="mx-auto flex max-w-[1320px] flex-col gap-[18px] text-[13px] leading-normal">
        <header>
          <h1 className="text-[28px] leading-[1.1] font-bold tracking-[-.03em]">
            My Workspace
          </h1>
          <p className="mt-1 text-white/60">
            Paste an email or upload a file, choose where it goes, and let the
            system do the first pass. You check everything before it is saved.
          </p>
        </header>

        {setup.kind === "loading" ? (
          <Box>Loading…</Box>
        ) : setup.kind === "forbidden" ? (
          <Box>
            <p className="font-semibold">Staff access required</p>
            <p className="mt-1 text-white/60">
              My Workspace is for back-office staff only.
            </p>
          </Box>
        ) : setup.kind === "error" ? (
          <Box>
            <p className="text-[#f87171]">
              Could not load My Workspace: {setup.message}
            </p>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="mt-2 rounded-[8px] border border-white/15 px-3 py-1 text-white/80 hover:bg-white/[.07]"
            >
              Retry
            </button>
          </Box>
        ) : (
          <>
            <section
              aria-label="Input"
              className="flex flex-wrap gap-[18px] rounded-[16px] border border-white/10 bg-white/[.032] p-[18px]"
            >
              <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-2.5">
                <div role="tablist" className="flex gap-1.5">
                  {(
                    [
                      ["paste", "Paste text"],
                      ...(showUpload ? [["upload", "Upload file"]] : []),
                    ] as [Tab, string][]
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={tab === k}
                      onClick={() => {
                        setTab(k);
                        setGenError(null);
                      }}
                      className={cn(
                        "h-9 rounded-[9px] border px-4 font-semibold",
                        tab === k ? PICKED : UNPICKED,
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {tab === "paste" ? (
                  <label className="flex flex-col gap-1.5 text-[11.5px] font-semibold text-white/75">
                    Paste the email here
                    <textarea
                      id="ws-text"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={13}
                      className="resize-y rounded-[10px] border border-white/15 bg-[#081624] px-3.5 py-3 text-[13px] leading-[1.55] font-normal text-[#f8fafc] outline-none focus:border-white/35"
                    />
                  </label>
                ) : (
                  <FileDrop
                    file={file}
                    types={setup.dests.upload_types}
                    maxBytes={setup.dests.upload_max_bytes}
                    onPick={pickFile}
                  />
                )}
              </div>

              <div className="flex min-w-[260px] flex-[1_1_300px] flex-col gap-2">
                <div className="text-[11.5px] font-semibold text-white/75">
                  Where should it go?
                </div>
                {dests.length === 0 ? (
                  <p
                    className="rounded-[10px] border border-dashed border-white/20 px-3 py-3 text-white/60"
                    data-no-destinations
                  >
                    Nothing is turned on yet. An admin can turn a destination on
                    in Settings → My Workspace.
                  </p>
                ) : (
                  dests.map((d) => {
                    const ok = accepts(d);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        disabled={!ok}
                        aria-pressed={destId === d.id}
                        onClick={() => {
                          setDestId(d.id);
                          setGenError(null);
                        }}
                        data-destination={d.code}
                        className={cn(
                          "rounded-[10px] border px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-45",
                          destId === d.id ? PICKED : UNPICKED,
                        )}
                      >
                        <div className="font-semibold">{d.name}</div>
                        <div className="text-[11.5px] text-white/55">
                          {d.description}
                          {!ok
                            ? `${d.description ? " · " : ""}${tab === "paste" ? "Files only" : "Pasted text only"}`
                            : ""}
                        </div>
                      </button>
                    );
                  })
                )}
                {/* Generate 是提交键：蓝色（CLAUDE.md）。 */}
                <button
                  type="button"
                  onClick={generate}
                  disabled={busy || dests.length === 0}
                  className={cn(
                    DARK_PRIMARY_BUTTON_CLASS,
                    "mt-1 h-11 rounded-[10px] text-[14px] font-bold",
                  )}
                >
                  {busy ? "Reading…" : "Generate"}
                </button>
                {genError ? (
                  <p className="text-[12.5px] text-[#f87171]" role="alert">
                    {genError}
                  </p>
                ) : null}
              </div>
            </section>

            <MyWork
              statuses={setup.statuses}
              onUnauthorized={redirectToLogin}
            />
          </>
        )}

        <HowToUse
          dark
          title="How to use"
          items={[
            "Paste the email into the box, or switch to Upload file and choose an Excel, CSV, PDF or Word file.",
            "Choose where it should go on the right, then click Generate. The system reads it and opens the work item for you to check.",
            "If it could not read everything, the work item still saves and says why. Your original text and file are kept.",
            "Nothing goes into bookings or quotes until you check it and save.",
            "My work lists what you are working on. Switch to Whole team to see everyone’s, and use the status buttons to filter. Done and cancelled items are hidden unless you pick that status.",
            "Click Open to go back to a work item, change its status or next step, or hand it to a teammate.",
          ]}
          warning="ops is connected to the live system: Generate creates a real work item."
        />
      </div>
    </main>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-white/10 bg-white/[.032] p-[18px]">
      {children}
    </div>
  );
}

function FileDrop({
  file,
  types,
  maxBytes,
  onPick,
}: {
  file: File | null;
  types: string[];
  maxBytes: number;
  onPick: (f: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        onPick(e.dataTransfer.files[0] ?? null);
      }}
      className={cn(
        "rounded-[12px] border-[1.5px] border-dashed px-5 py-10 text-center text-white/75",
        over ? "border-[rgba(251,191,36,.7)]" : "border-white/20",
      )}
    >
      <div className="mb-1 font-semibold">
        {file ? file.name : "Drop a file here, or choose one"}
      </div>
      <div className="text-[11.5px] text-white/50">
        {file
          ? formatBytes(file.size)
          : `${types.map((t) => t.toUpperCase()).join(", ")} · up to ${formatBytes(maxBytes)}`}
      </div>
      <input
        ref={inputRef}
        id="ws-file"
        type="file"
        accept={types.map((t) => `.${t}`).join(",")}
        className="hidden"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          onPick(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mt-3 rounded-[9px] border border-white/15 px-4 py-1.5 font-semibold text-white/85 hover:bg-white/[.07]"
      >
        {file ? "Choose another file" : "Choose file"}
      </button>
    </div>
  );
}

// ── My work ──

function MyWork({
  statuses,
  onUnauthorized,
}: {
  statuses: WorkspaceStatus[];
  onUnauthorized: () => void;
}) {
  const [scope, setScope] = useState<Scope>("mine");
  /** null = Open（所有没关闭的）。 */
  const [status, setStatus] = useState<string | null>(null);
  const [data, setData] = useState<WorkspaceItemList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetchItems(scope, status, controller.signal)
      .then(setData)
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (isStatus(e, 401)) onUnauthorized();
        else setError(describeError(e));
      });
    return () => controller.abort();
  }, [scope, status, onUnauthorized]);

  const counts = data?.counts ?? {};
  const openCount = statuses
    .filter((s) => !s.is_closed)
    .reduce((n, s) => n + (counts[s.code] ?? 0), 0);
  const filters: { key: string | null; label: string; n: number }[] = [
    { key: null, label: "Open", n: openCount },
    ...statuses.map((s) => ({
      key: s.code,
      label: s.name,
      n: counts[s.code] ?? 0,
    })),
  ];

  return (
    <section
      aria-label="My work"
      className="rounded-[16px] border border-white/10 bg-white/[.032] p-[18px]"
    >
      <h2 className="text-[15px] font-semibold">My work</h2>
      <p className="mt-0.5 text-[12px] text-white/55">
        Everything made here is kept, so you can reopen it, pick up a draft, or
        hand it to a teammate.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {(
          [
            ["mine", "Mine"],
            ["team", "Whole team"],
          ] as [Scope, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={scope === k}
            onClick={() => setScope(k)}
            className={cn(
              "h-8 rounded-[8px] border px-3 text-[12.5px] font-semibold",
              scope === k ? PICKED : UNPICKED,
            )}
          >
            {label}
          </button>
        ))}
        <span aria-hidden className="mx-1.5 h-5 w-px bg-white/15" />
        {filters.map((f) => (
          <button
            key={f.key ?? "open"}
            type="button"
            aria-pressed={status === f.key}
            onClick={() => setStatus(f.key)}
            data-filter={f.key ?? "open"}
            className={cn(
              "h-8 rounded-[8px] border px-3 text-[12.5px] font-semibold",
              status === f.key ? PICKED : UNPICKED,
            )}
          >
            {f.label}{" "}
            <span className="font-normal text-white/55 tabular-nums">
              {f.n}
            </span>
          </button>
        ))}
      </div>

      {error ? (
        <p className="mt-3 text-[#f87171]">Could not load My work: {error}</p>
      ) : !data ? (
        <p className="mt-3 text-white/55">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="mt-4 text-white/55" data-empty>
          {status === null
            ? scope === "mine"
              ? "Nothing open for you. Paste an email above to start."
              : "Nothing open for the team."
            : "Nothing with this status."}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead>
              <tr className="border-b border-white/10 text-[12px] text-white/60">
                {[
                  "No.",
                  "Type",
                  "Customer / subject",
                  "From",
                  "Owner",
                  "Updated",
                  "Status",
                  "Next step",
                  "",
                ].map((h) => (
                  <th key={h} className="px-1.5 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr
                  key={it.id}
                  className="border-b border-white/[.06] align-top"
                  data-item={it.item_no}
                >
                  <td className="px-1.5 py-2.5 font-semibold whitespace-nowrap">
                    {it.item_no}
                  </td>
                  <td className="px-1.5 py-2.5">{it.destination_name}</td>
                  <td className="px-1.5 py-2.5 [overflow-wrap:anywhere]">
                    {it.title || <span className="text-white/40">—</span>}
                  </td>
                  <td className="px-1.5 py-2.5 whitespace-nowrap text-white/60">
                    {sourceLabel(it)}
                  </td>
                  <td className="px-1.5 py-2.5 whitespace-nowrap">
                    {it.owner_name}
                  </td>
                  <td className="px-1.5 py-2.5 whitespace-nowrap text-white/60">
                    {formatUpdated(it.updated_at)}
                  </td>
                  {/* 状态用普通彩色字，不做胶囊（CLAUDE.md）；颜色来自设置。 */}
                  <td
                    className="px-1.5 py-2.5 font-semibold whitespace-nowrap"
                    style={{ color: it.status_color || undefined }}
                  >
                    {it.status_name ?? it.status_code}
                    {it.read_failed ? (
                      <span className="ml-1.5 font-normal text-[#fbbf24]">
                        · not read
                      </span>
                    ) : null}
                  </td>
                  <td className="px-1.5 py-2.5 text-white/80">
                    {it.next_step}
                  </td>
                  <td className="px-1.5 py-2.5 text-right">
                    <Link
                      href={`/workspace/${it.id}`}
                      className="inline-block rounded-[8px] border border-white/15 px-3 py-1 font-semibold text-white hover:bg-white/[.07]"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.truncated ? (
            <p className="mt-2 text-[12px] text-white/50">
              Showing the latest 500. Pick a status to narrow the list.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
