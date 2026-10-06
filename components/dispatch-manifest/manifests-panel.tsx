"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { StepBox } from "@/components/dispatch/step-box";
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

const UPLOADED_AT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function busText(n: number) {
  return n === 0
    ? "No bus on the schedule yet"
    : n === 1
      ? "1 bus"
      : `${n} buses`;
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
    <StepBox
      n={1}
      title="Guest lists"
      desc="Upload each tour's Rezdy CSV. The buses on each card come from the schedule saved in Step 2."
    >
      <HowToUse />
      {error ? (
        <p role="alert" className="text-sm text-[#A32D2D]">
          {error}
        </p>
      ) : null}
      {applied ? (
        <p role="status" className="text-sm font-medium text-emerald-700">
          {applied}
        </p>
      ) : null}

      {state.kind === "loading" ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : state.kind === "error" ? (
        <p role="alert" className="text-sm text-[#A32D2D]">
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
        <p className="text-sm text-stone-500">
          No bus tour sections on this day.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
          {state.cards.map((c) => (
            <Card
              key={c.manifest_id}
              card={c}
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

function Card({
  card: c,
  date,
  busy,
  locked,
  onUpload,
  onAssignBus,
}: {
  card: ManifestCard;
  date: string;
  busy: boolean;
  locked: boolean;
  onUpload: () => void;
  onAssignBus: () => void;
}) {
  const pill = !c.uploaded
    ? { text: "No CSV yet", cls: "bg-stone-100 text-stone-500" }
    : c.not_on_bus
      ? {
          text: `${c.not_on_bus} pax not on a bus`,
          cls: "bg-orange-100 text-orange-800",
        }
      : { text: `${c.pax} pax`, cls: "bg-emerald-100 text-emerald-800" };
  const lunch = c.lunch;
  const hasLunch = !!lunch && lunch.turkey + lunch.veggie + lunch.beef > 0;
  return (
    <div
      data-card={c.manifest_id}
      className="flex flex-col gap-2 rounded-md border border-stone-200 p-3 text-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-stone-900">{c.title}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
            pill.cls,
          )}
        >
          {pill.text}
        </span>
      </div>
      <p className="text-xs text-stone-600">
        {busText(c.buses)}
        {c.uploaded
          ? ` · ${c.guests} order${c.guests === 1 ? "" : "s"}, ${c.pax} pax`
          : " · no guests loaded for this day."}
        {hasLunch
          ? ` · lunch ${lunch.turkey} Turkey / ${lunch.veggie} Veggie / ${lunch.beef} Roast Beef`
          : ""}
        {c.uploaded && c.uploaded_at ? (
          <>
            <br />
            Uploaded {UPLOADED_AT.format(new Date(c.uploaded_at))}
            {c.uploaded_by ? ` by ${c.uploaded_by}` : ""}
          </>
        ) : null}
      </p>
      {c.mode === "unlettered" ? (
        <p className="text-xs text-[#8a5a00]">
          Give each bus a letter in its section in Step 2, then Save schedule.
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2">
        {c.uploaded ? (
          <Link
            href={`/dispatch/manifest?date=${date}&tour=${c.manifest_id}`}
            className="rounded-md bg-stone-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700"
          >
            Open manifest
          </Link>
        ) : null}
        <button
          type="button"
          disabled={busy || locked}
          onClick={onUpload}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50",
            c.uploaded
              ? "border border-stone-300 text-stone-700 hover:bg-stone-50"
              : "bg-[#185FA5] text-white hover:bg-[#134c85]",
          )}
        >
          {busy
            ? "Reading…"
            : c.uploaded
              ? "Re-upload CSV"
              : "Upload Rezdy CSV"}
        </button>
        {/* 有没有传 CSV 都有（同旧页面）。 */}
        <button
          type="button"
          onClick={onAssignBus}
          className="rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100"
        >
          Assign Bus
        </button>
      </div>
    </div>
  );
}

const KIND = {
  added: { label: "Added", cls: "bg-[#EAF3DE] text-[#2F7851]" },
  removed: { label: "Removed", cls: "bg-[#fdeceb] text-[#b3261e]" },
  changed: { label: "Changed", cls: "bg-[#E6F1FB] text-[#185FA5]" },
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
      className="overflow-hidden rounded-md border border-sky-300"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 bg-sky-50 px-3 py-2">
        <span className="text-sm font-semibold text-sky-900">
          {pending.card.title} · new CSV
        </span>
        <span className="text-xs text-stone-600">
          {p.rows} orders, {p.pax} pax · {n} change{n === 1 ? "" : "s"}
          {p.unchanged ? `, ${p.unchanged} unchanged` : ""}
        </span>
      </div>
      {rows.length ? (
        <div className="max-h-[440px] overflow-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="sticky top-0 bg-stone-50 text-left text-stone-500">
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
                  <th key={h} className="px-2 py-1.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map(({ kind, r, note }, i) => (
                <tr key={i} data-change={kind}>
                  <td className="px-2 py-1">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                        KIND[kind].cls,
                      )}
                    >
                      {KIND[kind].label}
                    </span>
                  </td>
                  <td className="px-2 py-1 font-mono">{r.order_number}</td>
                  <td className="px-2 py-1">{r.pickup_time}</td>
                  <td className="px-2 py-1">{r.pickup_location}</td>
                  <td className="px-2 py-1">{r.name}</td>
                  <td className="px-2 py-1">{r.pax}</td>
                  <td className="px-2 py-1">{note}</td>
                  <td className="px-2 py-1">{r.product}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-3 py-3 text-sm text-stone-600">
          No changes: the file matches the list already loaded.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-sky-200 px-3 py-2">
        {pending.error ? (
          <span role="alert" className="mr-auto text-xs text-[#A32D2D]">
            {pending.error}
          </span>
        ) : null}
        <button
          type="button"
          disabled={pending.applying}
          onClick={onCancel}
          className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending.applying}
          onClick={onApply}
          className="rounded-md bg-[#185FA5] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#134c85] disabled:opacity-50"
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
    <details className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-relaxed text-stone-700">
      <summary className="cursor-pointer font-semibold text-sky-900">
        📖 How to use — Guest lists
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
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
