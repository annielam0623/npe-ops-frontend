"use client";

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
import { Modal } from "@/components/ui/modal";
import { BusIcon } from "@/components/dispatch/icons";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  applyManifestUpload,
  fetchManifestCards,
  markGuestListsDone,
  previewManifestUpload,
} from "@/lib/dispatch-manifest-api";
import { LA_TIME_ZONE } from "@/lib/la-date";
import { cn } from "@/lib/utils";
import { PageLink } from "@/components/ui/page-link";
import type {
  GuestListsDone,
  ManifestCard,
  ManifestUploadPreview,
} from "@/types";

type CardsState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      cards: ManifestCard[];
      guestListsDone: GuestListsDone | null;
    };

const DONE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  dateStyle: "short",
  timeStyle: "medium",
});

/**
 * 显示顺序（旧页面 2026-10-08，G33 同一个包）：传完的排最后，已传组内按传完的先后（最早的最前）；
 * 没传组维持原顺序。只排一份副本，不改原数组。
 */
function displayOrder(cards: ManifestCard[]): ManifestCard[] {
  const at = (c: ManifestCard) =>
    c.uploaded_at ? new Date(c.uploaded_at).getTime() : 0;
  return cards.slice().sort((a, b) => {
    if (a.uploaded !== b.uploaded) return a.uploaded ? 1 : -1;
    if (!a.uploaded) return 0;
    return at(a) - at(b);
  });
}

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
  onSeatGuests,
  onGuestListsDone,
  onApplied,
}: {
  date: string;
  /** 变了就重读卡片（排车页每次保存 / 重读之后：车数读的是已保存的排车）。 */
  version?: number;
  onUnauthorized: () => void;
  /** 卡片上的 Check the bus（原 Assign Bus）：滚到 Step 2 里这个团的车（卡片是排车页画的，由它滚）。 */
  onAssignBus: (manifestId: number) => void;
  /** 卡片上的 Seat guests：滚到 Step 2 里这个团的车并展开车下面的名单（ops 没有单独的 Step 3）。 */
  onSeatGuests?: (manifestId: number) => void;
  /** 点 Completed 成功：滚到 Step 2 开头（同上，由排车页滚）。 */
  onGuestListsDone: () => void;
  /** 某个团的名单 Apply 成功（服务端已重新自动分车）：Step 2 车下面的客人名单跟着重读。 */
  onApplied?: () => void;
}) {
  const [completing, setCompleting] = useState(false);
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
      .then((r) => setState({ kind: "ready", ...r }))
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

  async function complete() {
    setCompleting(true);
    setError(null);
    try {
      await markGuestListsDone(date);
      setReloadKey((k) => k + 1);
      onGuestListsDone();
    } catch (e) {
      if (isStatus(e, 401)) onUnauthorized();
      else setError(`Could not mark this complete: ${describeError(e)}`);
    } finally {
      setCompleting(false);
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
      onApplied?.();
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
          {displayOrder(state.cards).map((c, i) => (
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
              onSeatGuests={() => onSeatGuests?.(c.manifest_id)}
            />
          ))}
        </div>
      )}

      {/* 全部团传完后出现（旧 `.tm-done`，G33）：没点过是按钮，点过显示谁、几点；没有取消键。 */}
      {state.kind === "ready" &&
      state.cards.length > 0 &&
      state.cards.every((c) => c.uploaded) ? (
        <div data-guest-lists-done className="text-center">
          {state.guestListsDone ? (
            <span className="text-[13px] text-[#93c5fd]">
              Guest lists completed
              {state.guestListsDone.completed_by
                ? ` by ${state.guestListsDone.completed_by}`
                : ""}
              {state.guestListsDone.completed_at
                ? ` · ${DONE_FORMAT.format(new Date(state.guestListsDone.completed_at))}`
                : ""}
            </span>
          ) : (
            <button
              type="button"
              disabled={completing}
              onClick={() => void complete()}
              className={TM_BTN_BLUE}
            >
              Completed — all tours loaded
            </button>
          )}
        </div>
      ) : null}

      {/* 比对结果是居中弹窗（旧 `.tm-diff-modal`，Annie 2026-10-07：原来插在卡片网格下面，传的是靠前的团
          要滚到最下面才看得到）。点背景或按 Esc 等同 Cancel；Apply 进行中不关。 */}
      {pending ? (
        <Modal
          titleId="tm-diff-title"
          onDismiss={pending.applying ? undefined : () => setPending(null)}
          panelClassName="max-h-[85vh] max-w-[min(94vw,960px)] overflow-auto"
        >
          <DiffBox
            pending={pending}
            onCancel={() => setPending(null)}
            onApply={() => void apply()}
          />
        </Modal>
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

/**
 * 卡上的问题（同旧页面 `warnState`，Annie 2026-10-06 晚定、10-09 晚细化）：顺序即优先级；没传名单时不算。
 * solve = 哪个按钮能解决（那个按钮实心）。
 */
function warnState(
  c: ManifestCard,
): { text: string; solve: "check" | "seat" } | null {
  if (!c.uploaded) return null;
  if (!c.buses) return { text: "Needs saving", solve: "check" };
  if (c.mode === "unlettered")
    return { text: "Buses need letters", solve: "check" };
  if (typeof c.buses_needed === "number" && c.buses_needed > c.buses)
    return {
      text: `${c.not_on_bus ?? 0} guests need an extra bus`,
      solve: "check",
    };
  if (c.not_on_bus)
    return {
      text: `${c.not_on_bus} guests awaiting seat assignment`,
      solve: "seat",
    };
  return null;
}

/** 旧 `.tm-card`：上 = 图标块 + 团名 + 一行小字 + 右上角小标签；下 = 按钮平分整排。 */
function Card({
  card: c,
  tile,
  date,
  busy,
  locked,
  onUpload,
  onAssignBus,
  onSeatGuests,
}: {
  card: ManifestCard;
  tile: number;
  date: string;
  busy: boolean;
  locked: boolean;
  onUpload: () => void;
  onAssignBus: () => void;
  onSeatGuests: () => void;
}) {
  const warn = warnState(c);
  // 右上角小标签只在没问题时用：有问题时团名下面的橙字已经说了（同旧页面 cb3887d，Annie 否掉了重复的标签）。
  const pill = !c.uploaded
    ? { text: "No CSV yet", cls: "bg-[#eef0f3] text-[#4b5563]" }
    : warn
      ? null
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
        {warn ? (
          <div className="mt-[3px] text-[12.5px] font-[650] text-[#c2410c]">
            {warn.text}
          </div>
        ) : null}
        <div className="mt-[3px] text-[13.5px] leading-[1.45] text-[#6b7280]">
          {busText(c.buses)} ·{" "}
          {c.uploaded ? `${c.pax} guests loaded` : "No guests loaded"}
        </div>
      </div>
      {pill ? (
        <span
          className={cn(
            "self-start justify-self-end rounded-[5px] px-[7px] py-0.5 text-[11.5px] font-semibold whitespace-nowrap max-[620px]:col-span-full max-[620px]:justify-self-start",
            pill.cls,
          )}
        >
          {pill.text}
        </span>
      ) : (
        <span aria-hidden />
      )}
      <div className="col-span-full flex flex-wrap justify-center gap-2.5 border-t border-[#e5e7eb] pt-3.5 [&>*]:min-w-max [&>*]:flex-[1_1_0] [&>*]:justify-center">
        {c.uploaded ? (
          <PageLink
            href={`/dispatch/manifest?date=${date}&tour=${c.manifest_id}`}
            className={TM_BTN}
          >
            <DocIcon />
            Open manifest
          </PageLink>
        ) : null}
        <button
          type="button"
          disabled={busy || locked}
          onClick={onUpload}
          // 还没传名单：上传就是这张卡要做的事，实心（同旧页面）。
          className={c.uploaded ? TM_BTN : TM_BTN_BLUE}
        >
          <UploadIcon />
          {busy
            ? "Reading…"
            : c.uploaded
              ? "Re-upload CSV"
              : "Upload Rezdy CSV"}
        </button>
        {/* Check the bus（原 Assign Bus）：有没有传 CSV 都有；只在它能解决卡上的问题时实心（同旧页面 cb3887d）。 */}
        <button
          type="button"
          onClick={onAssignBus}
          className={warn?.solve === "check" ? TM_BTN_BLUE : TM_BTN}
        >
          Check the bus
        </button>
        {/* Seat guests：车位够、还有客人没分到车时才有；跳到 Step 2 这个团的车、展开名单。 */}
        {warn?.solve === "seat" ? (
          <button type="button" onClick={onSeatGuests} className={TM_BTN_BLUE}>
            Seat guests
          </button>
        ) : null}
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
      // 旧 `.tm-diff`（弹窗里）：白框；最宽 min(94vw, 960px)、最高 85vh 由外面的弹窗管，多了在框里滚。
      className="rounded-xl border-[0.5px] border-black/10 bg-white text-[#1a1a1a]"
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-4 py-[11px]">
        <b id="tm-diff-title" className="text-[14px]">
          {pending.card.title} · new CSV
        </b>
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
          A popup shows the list of Added, Removed and Changed guests. Check it,
          then click Apply. Nothing changes until you click Apply.
        </li>
        <li>
          A tour moves to the bottom of the list once it&rsquo;s loaded, so the
          tours still waiting stay at the top.
        </li>
        <li>
          Click Check the bus on a tour to jump to that tour&rsquo;s buses in
          Step 2. Orange text under a tour&rsquo;s name says what still needs
          doing, and the button that fixes it is filled in. If guests still need
          a seat, click Seat guests: it opens that tour&rsquo;s bus lists in
          Step 2.
        </li>
        <li>
          Click Open manifest to pick a bus for each guest, fill in the
          attraction confirmation, and print or download.
        </li>
        <li>
          Once every tour is loaded, click Completed — all tours loaded. This
          jumps down to Step 2 and is shared: any staff member sees it, even
          after a refresh or the next day.
        </li>
        <li>
          If Rezdy changes later, click Re-upload CSV on that tour and Apply
          again. Bus choices and the driver&rsquo;s check-ins stay. This also
          clears the Completed confirmation, since the guest list changed.
        </li>
        <li>
          If an upload is refused, the message says why (wrong date, or a row
          with no number of guests). Fix it in Rezdy, download again and upload.
        </li>
      </ol>
    </details>
  );
}
