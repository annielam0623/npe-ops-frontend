"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  DARK_ERR,
  HOWTO_OL,
  MONO,
  MUTED,
  TD,
  TH,
  TM_BTN,
  TM_BTN_BLUE,
  TM_PAD,
} from "@/components/dispatch/legacy-styles";
import { StepBox } from "@/components/dispatch/step-box";
import { BusIcon } from "@/components/dispatch/icons";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  applyManifestUpload,
  fetchManifestCards,
  previewManifestUpload,
} from "@/lib/dispatch-manifest-api";
import { cn } from "@/lib/utils";
import type { ManifestCard, ManifestUploadPreview } from "@/types";

type CardsState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; cards: ManifestCard[] };

interface Pending {
  card: ManifestCard;
  file: File;
  preview: ManifestUploadPreview;
  applying: boolean;
  error: string | null;
}

// 卡上只放车数和人数，照旧版 _tour_manifests_panel.html（Annie 2026-10-08 再确认：「不需要放餐之类的详情」）：
// 午餐、订单数、谁传的都不放；要留意的事只进右上角小标签。
function busText(n: number) {
  return n === 0
    ? "No bus assigned"
    : `${n} bus${n === 1 ? "" : "es"} assigned`;
}

/**
 * 排车页的 Step 1 Guest lists：每个 bus tour 一张卡，上传 Rezdy CSV → 看 Added / Removed / Changed → Apply。
 * 车数来自排车页**已保存**的排车（同旧页面 _tour_manifests_panel.html）。
 */
export function ManifestsPanel({
  date,
  version = 0,
  onUnauthorized,
  onAssignBus,
}: {
  date: string;
  /** 变了就重读卡片（排车页每次保存 / 重读之后：车数读的是已保存的排车）。 */
  version?: number;
  onUnauthorized: () => void;
  /** 卡片上的 Assign Bus：滚到 Step 2 里这个团的车（卡片是排车页画的，由它滚）。 */
  onAssignBus: (manifestId: number) => void;
}) {
  const [state, setState] = useState<CardsState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<ManifestCard | null>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  // 换天：丢掉待 Apply 的文件和上次的提示。
  useEffect(() => {
    setPending(null);
    setApplied(null);
    setError(null);
  }, [date]);

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => (s.kind === "ready" ? s : { kind: "loading" }));
    fetchManifestCards(date, controller.signal)
      .then((cards) => setState({ kind: "ready", cards }))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(e, 401)) onUnauthorizedRef.current();
        else setState({ kind: "error", message: describeError(e) });
      });
    return () => controller.abort();
  }, [date, reloadKey, version]);

  function pick(card: ManifestCard) {
    targetRef.current = card;
    setError(null);
    fileRef.current?.click();
  }

  async function onFile(file: File | undefined) {
    const card = targetRef.current;
    if (fileRef.current) fileRef.current.value = "";
    if (!file || !card) return;
    setPending(null);
    setApplied(null);
    setPreviewing(card.manifest_id);
    try {
      const preview = await previewManifestUpload(date, card.manifest_id, file);
      setPending({ card, file, preview, applying: false, error: null });
    } catch (e) {
      if (isStatus(e, 401)) onUnauthorized();
      else setError(`${card.title}: ${describeError(e)}`);
    } finally {
      setPreviewing(null);
    }
  }

  async function apply() {
    if (!pending || pending.applying) return;
    setPending({ ...pending, applying: true, error: null });
    try {
      const r = await applyManifestUpload(
        date,
        pending.card.manifest_id,
        pending.file,
      );
      setApplied(
        `${pending.card.title}: applied. ${r.rows} orders, ${r.pax} pax.`,
      );
      setPending(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setPending((p) =>
        p
          ? {
              ...p,
              applying: false,
              error: `${describeError(e)} Nothing was loaded.`,
            }
          : p,
      );
    }
  }

  return (
    // 样子照旧页面 _tour_manifests_panel.html：How to use 在标题行右边（`.tm-howto`），
    // 上传后的一句话跟在说明后面（`.tm-msg`），卡片两列（`.tm-grid`）。
    <StepBox
      n={1}
      title="Guest lists"
      headExtra={<HowToUse />}
      desc={
        <p className="m-0">
          Upload each tour&rsquo;s Rezdy CSV. The buses on each card come from
          the schedule saved in Step 2.{" "}
          {applied ? (
            <span role="status" className="text-[12.5px] text-[#93c5fd]">
              {applied}
            </span>
          ) : null}
        </p>
      }
    >
      {error ? (
        <p role="alert" className={cn(DARK_ERR, "m-0")}>
          {error}
        </p>
      ) : null}

      {state.kind === "loading" ? (
        <p className={cn(MUTED, "m-0 text-[13px]")}>Loading…</p>
      ) : state.kind === "error" ? (
        <p role="alert" className={cn(DARK_ERR, "m-0")}>
          Could not load the tour manifests: {state.message}{" "}
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="underline"
          >
            Retry
          </button>
        </p>
      ) : state.cards.length === 0 ? (
        <p className={cn(MUTED, "m-0 text-[13px]")}>
          No bus tour sections on this day.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
          {state.cards.map((c, i) => (
            <Card
              key={c.manifest_id}
              card={c}
              tile={i % TILE.length}
              date={date}
              busy={previewing === c.manifest_id}
              // 一个预览还在读：别的卡也先不让选（后到的预览会盖掉人最后选的那一个）。
              locked={previewing !== null}
              onUpload={() => pick(c)}
              onAssignBus={() => onAssignBus(c.manifest_id)}
            />
          ))}
        </div>
      )}

      {pending ? (
        <DiffBox
          pending={pending}
          onCancel={() => setPending(null)}
          onApply={() => void apply()}
        />
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx"
        hidden
        aria-label="Rezdy CSV"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
    </StepBox>
  );
}

/** 图标块颜色按卡片序号轮流，只是好认，没有含义（旧 `.tm-tile.c0`–`c3`）。 */
const TILE = [
  "bg-[#e3edff] text-[#2563eb]",
  "bg-[#e3f5ea] text-[#16a34a]",
  "bg-[#f1e6ff] text-[#9333ea]",
  "bg-[#fff0de] text-[#ea7a0c]",
];

/** 旧 `.tm-card`：上 = 图标块 + 团名 + 一行小字 + 右上角小标签；下 = 按钮平分整排。 */
function Card({
  card: c,
  tile,
  date,
  busy,
  locked,
  onUpload,
  onAssignBus,
}: {
  card: ManifestCard;
  tile: number;
  date: string;
  busy: boolean;
  locked: boolean;
  onUpload: () => void;
  onAssignBus: () => void;
}) {
  // 右上角小标签，顺序同旧版：没传 → 车没字母（客人一个都分不上车，先补字母）→ 有人没上车 → 已传。
  const WARN = "bg-[#fdf1dd] text-[#8a5a00]";
  const pill = !c.uploaded
    ? { text: "No CSV yet", cls: "bg-[#eef0f3] text-[#4b5563]" }
    : c.mode === "unlettered"
      ? { text: "Buses need letters", cls: WARN }
      : c.not_on_bus
        ? { text: `${c.not_on_bus} not on a bus`, cls: WARN }
        : { text: "CSV loaded", cls: "bg-[#e6f4ec] text-[#1e6b43]" };
  return (
    <div
      data-card={c.manifest_id}
      className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3.5 rounded-[10px] bg-white px-[18px] py-4 text-[#111827] max-[620px]:grid-cols-[auto_minmax(0,1fr)]"
    >
      <span
        aria-hidden
        className={cn(
          "flex size-[46px] items-center justify-center rounded-[10px]",
          TILE[tile],
        )}
      >
        <BusIcon className="size-6" />
      </span>
      <div className="min-w-0">
        <div className="text-[17px] font-[650] tracking-[-.005em]">
          {c.title}
        </div>
        <div className="mt-[3px] text-[13.5px] leading-[1.45] text-[#6b7280]">
          {busText(c.buses)} ·{" "}
          {c.uploaded ? `${c.pax} guests loaded` : "No guests loaded"}
        </div>
      </div>
      <span
        className={cn(
          "self-start justify-self-end rounded-[5px] px-[7px] py-0.5 text-[11.5px] font-semibold whitespace-nowrap max-[620px]:col-span-full max-[620px]:justify-self-start",
          pill.cls,
        )}
      >
        {pill.text}
      </span>
      <div className="col-span-full flex flex-wrap justify-center gap-2.5 border-t border-[#e5e7eb] pt-3.5 [&>*]:min-w-max [&>*]:flex-[1_1_0] [&>*]:justify-center">
        {c.uploaded ? (
          <Link
            href={`/dispatch/manifest?date=${date}&tour=${c.manifest_id}`}
            className={TM_BTN}
          >
            <DocIcon />
            Open manifest
          </Link>
        ) : null}
        <button
          type="button"
          disabled={busy || locked}
          onClick={onUpload}
          className={TM_BTN}
        >
          <UploadIcon />
          {busy
            ? "Reading…"
            : c.uploaded
              ? "Re-upload CSV"
              : "Upload Rezdy CSV"}
        </button>
        {/* 有没有传 CSV 都有（同旧页面）。 */}
        <button type="button" onClick={onAssignBus} className={TM_BTN_BLUE}>
          Assign Bus
        </button>
      </div>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 14v4.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V14" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5zM9 12h6M9 16h6" />
    </svg>
  );
}

const KIND = {
  added: { label: "Added", cls: "bg-[#e6f4ec] text-[#1e6b43]" },
  removed: { label: "Removed", cls: "bg-[#fdeceb] text-[#b3261e]" },
  changed: { label: "Changed", cls: "bg-[#e8f0fd] text-[#1d4ed8]" },
} as const;

function DiffBox({
  pending,
  onCancel,
  onApply,
}: {
  pending: Pending;
  onCancel: () => void;
  onApply: () => void;
}) {
  const p = pending.preview;
  const n = p.added.length + p.removed.length + p.changed.length;
  const rows = [
    ...p.added.map((r) => ({ kind: "added" as const, r, note: "" })),
    ...p.removed.map((r) => ({
      kind: "removed" as const,
      r,
      note: [
        r.bus_label ? `Was on Bus ${r.bus_label}` : "",
        r.boarding
          ? `Driver marked ${r.boarding === "boarded" ? "boarded" : "no show"}`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    ...p.changed.map((r) => ({
      kind: "changed" as const,
      r,
      note: r.changes.join(", "),
    })),
  ];
  return (
    <div
      role="region"
      aria-label="New CSV"
      // 旧 `.tm-diff`：白框，表头钉在顶上、内容多时在框里滚。
      className="max-w-full overflow-hidden rounded-xl border-[0.5px] border-black/10 bg-white text-[#1a1a1a]"
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-4 py-[11px]">
        <b className="text-[14px]">{pending.card.title} · new CSV</b>
        <span className="text-[13px] text-[#4a5568]">
          {p.rows} orders, {p.pax} pax · {n} change{n === 1 ? "" : "s"}
          {p.unchanged ? `, ${p.unchanged} unchanged` : ""}
        </span>
      </div>
      {rows.length ? (
        <div className="max-h-[440px] overflow-auto">
          <table className="w-full min-w-[900px] border-collapse text-[13px] tabular-nums">
            <thead>
              <tr>
                {[
                  "Change",
                  "Order #",
                  "Pickup",
                  "Location",
                  "Guest",
                  "Pax",
                  "Note",
                  "Tour",
                ].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      TH,
                      "sticky top-0 py-[7px]",
                      h === "Pax" && "text-right",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ kind, r, note }, i) => (
                <tr key={i} data-change={kind}>
                  <td className={cn(TD, TM_PAD, "whitespace-nowrap")}>
                    <span
                      className={cn(
                        "inline-block rounded-[5px] px-[7px] py-0.5 text-[11.5px] font-semibold whitespace-nowrap",
                        KIND[kind].cls,
                      )}
                    >
                      {KIND[kind].label}
                    </span>
                  </td>
                  <td className={cn(TD, TM_PAD, MONO)}>{r.order_number}</td>
                  <td className={cn(TD, TM_PAD, MONO)}>{r.pickup_time}</td>
                  <td className={cn(TD, TM_PAD)}>{r.pickup_location}</td>
                  <td className={cn(TD, TM_PAD)}>{r.name}</td>
                  <td className={cn(TD, TM_PAD, "text-right")}>{r.pax}</td>
                  <td className={cn(TD, TM_PAD, "text-[12px] text-[#4a5568]")}>
                    {note}
                  </td>
                  <td
                    className={cn(
                      TD,
                      TM_PAD,
                      "min-w-[220px] text-[12px] text-[#4a5568]",
                    )}
                  >
                    {r.product}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="m-0 px-4 py-3 text-[13px] text-[#4a5568]">
          No changes: the file matches the list already loaded.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 px-4 pt-3 pb-3.5">
        {pending.error ? (
          <span role="alert" className="text-[12.5px] text-[#b3261e]">
            {pending.error}
          </span>
        ) : null}
        <button
          type="button"
          disabled={pending.applying}
          onClick={onCancel}
          className={TM_BTN}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending.applying}
          onClick={onApply}
          className={TM_BTN_BLUE}
        >
          {pending.applying
            ? "Applying…"
            : n
              ? `Apply ${n} change${n === 1 ? "" : "s"}`
              : "Apply"}
        </button>
      </div>
    </div>
  );
}

function HowToUse() {
  return (
    // 旧 `.tm-howto`：标题行右边，书本图标 + 浅蓝字链接；展开后占满一行，深底上浅色字。
    <details className="ml-auto max-w-full text-[12.5px] leading-[1.85] text-[#cbd5e1] open:ml-0 open:basis-full">
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 font-medium text-[#93c5fd] hover:text-[#bfdbfe] hover:underline hover:underline-offset-[3px] [&::-webkit-details-marker]:hidden">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-5 flex-none"
        >
          <path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13" />
        </svg>
        How to use — Guest lists
      </summary>
      <ol className={cn(HOWTO_OL, "mt-2 mb-1 max-w-[760px] pl-5")}>
        <li>
          Save the schedule in Step 2 first. The buses on each card come from
          the saved schedule. For a tour with two or more buses, give each bus a
          letter (A, B ...).
        </li>
        <li>
          Download the CSV for each tour from Rezdy and click Upload Rezdy CSV
          on that tour. Upload it as is. Do not open it in Excel first.
        </li>
        <li>
          Check the list of Added, Removed and Changed guests, then click Apply.
          Nothing changes until you click Apply.
        </li>
        <li>
          Click Assign Bus on a tour to jump to that tour&rsquo;s buses in Step
          2.
        </li>
        <li>
          Click Open manifest to pick a bus for each guest, fill in the
          attraction confirmation, and print or download.
        </li>
        <li>
          If Rezdy changes later, click Re-upload CSV on that tour and Apply
          again. Bus choices and the driver&rsquo;s check-ins stay.
        </li>
        <li>
          If an upload is refused, the message says why (wrong date, or a row
          with no number of guests). Fix it in Rezdy, download again and upload.
        </li>
      </ol>
    </details>
  );
}
