"use client";

import { createContext, useContext, useState } from "react";

import { Modal } from "@/components/ui/modal";
import {
  LIGHT_BUTTON,
  sendButtonClass,
  YELLOW_BOX,
} from "@/components/tickets-send/legacy-ui";
import type {
  ManifestGuest,
  ManifestSection,
  ManifestTextSize,
  ManifestVersion,
  ManifestView as ManifestData,
} from "@/types";

/**
 * Bus Manifest 页「改了先放在页面上，按整页 Save 才存」（Annie 2026-10-29：「bus manifest Q4 没存之前还是挪过去，缓存，
 * 然后等整页存。其他都走推荐。动手」；preview https://claude.ai/artifact/XNA2wnz8SRcWcqxrANy1WX ）：
 * 版式、字号、换车、每节的黄框、Special Requirements 都先记在这里；整页 Save 依次调现有接口（版式 → 换车 → 备注 → 字号 → 黄框），
 * 存上的拿掉，没存上的留着继续标琥珀色。Special Requirements 也并进整页 Save（Annie 2026-10-30「并进整页一起存 A 动手」：
 * 格子里的 Save 改成 Done，先暂存、标琥珀色，存的时候放在换车之后发）。
 */

export type AttrValues = {
  checkin_time: string;
  pax_text: string;
  tour_time: string;
  confirmation_no: string;
};

export interface Pending {
  /** 选了别的版式（和库里一样 = null）。 */
  version: ManifestVersion | null;
  /** 按车键（bus_key）：调好、按了 Done 的字号。 */
  textSizes: Record<string, ManifestTextSize>;
  /** 按客人 id：换到哪辆车（"" = 不在车上）。 */
  moves: Record<number, string>;
  /** 按「车键|节」：改过的黄框四格。 */
  attractions: Record<
    string,
    { busKey: string; section: string; title: string; values: AttrValues }
  >;
  /** 按客人 id：改过的 Special Requirements（null = 恢复 Rezdy 原文，"" = 删空）；order 是单号（写在提示里）。 */
  notes: Record<number, { notes: string | null; order: string }>;
}

export const EMPTY_PENDING: Pending = {
  version: null,
  textSizes: {},
  moves: {},
  attractions: {},
  notes: {},
};

export function isDirty(p: Pending): boolean {
  return (
    p.version !== null ||
    Object.keys(p.textSizes).length > 0 ||
    Object.keys(p.moves).length > 0 ||
    Object.keys(p.attractions).length > 0 ||
    Object.keys(p.notes).length > 0
  );
}

export const attrKey = (busKey: string, section: string) =>
  `${busKey}|${section}`;

/** 每位客人在库里的车（换车前）：用来写「from A」、判断换回原车 = 没改。 */
export function savedBusOf(data: ManifestData): Map<number, string> {
  const m = new Map<number, string>();
  for (const b of data.blocks)
    for (const s of b.sections)
      for (const g of s.guests) m.set(g.id, g.bus_label ?? "");
  for (const s of data.unplaced.sections)
    for (const g of s.guests) m.set(g.id, g.bus_label ?? "");
  return m;
}

/** 「7:15 AM」→ 分钟（读不懂排最后）。 */
function minutesOf(t: string): number {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AP]M)?/i.exec(t);
  if (!m) return 24 * 60;
  const ap = m[3]?.toUpperCase();
  // 带 AM / PM：12 AM = 0 点、12 PM = 12 点；不带就当 24 小时。
  const h = ap ? (Number(m[1]) % 12) + (ap === "PM" ? 12 : 0) : Number(m[1]);
  return h * 60 + Number(m[2]);
}

/** 同后端：接客时间 → 酒店 → first name → last name。 */
function sortGuests(guests: ManifestGuest[]): ManifestGuest[] {
  return [...guests].sort(
    (a, b) =>
      minutesOf(a.pickup_time) - minutesOf(b.pickup_time) ||
      a.pickup_location.localeCompare(b.pickup_location) ||
      a.first_name.localeCompare(b.first_name) ||
      a.last_name.localeCompare(b.last_name),
  );
}

/**
 * Q4（Annie 改了推荐）：换了车的客人没存之前就在页面上挪到新车（同一节，没有就新起一节），
 * 原车那一节空了就拿掉。各节标题、合计行的人数还是库里的数，按 Save 重读后才对。
 */
export function applyMoves(
  data: ManifestData,
  moves: Pending["moves"],
): ManifestData {
  const ids = Object.keys(moves).map(Number);
  if (!ids.length) return data;
  const moving = new Map<
    number,
    { guest: ManifestGuest; section: ManifestSection }
  >();
  const strip = (sections: ManifestSection[]) =>
    sections
      .map((s) => {
        const keep = s.guests.filter((g) => {
          if (g.id in moves) {
            moving.set(g.id, { guest: g, section: s });
            return false;
          }
          return true;
        });
        return keep.length === s.guests.length ? s : { ...s, guests: keep };
      })
      .filter((s) => s.guests.length > 0);
  const blocks = data.blocks.map((b) => ({
    ...b,
    sections: strip(b.sections),
  }));
  let unplaced = strip(data.unplaced.sections);
  for (const id of ids) {
    const hit = moving.get(id);
    if (!hit) continue;
    const label = moves[id];
    const guest = { ...hit.guest, bus_label: label || null };
    const put = (sections: ManifestSection[]) => {
      const i = sections.findIndex((s) => s.key === hit.section.key);
      if (i >= 0) {
        const next = [...sections];
        next[i] = {
          ...next[i],
          guests: sortGuests([...next[i].guests, guest]),
        };
        return next;
      }
      return [...sections, { ...hit.section, guests: [guest] }];
    };
    const bi = label ? blocks.findIndex((b) => b.bus_key === label) : -1;
    if (bi >= 0)
      blocks[bi] = { ...blocks[bi], sections: put(blocks[bi].sections) };
    else unplaced = put(unplaced);
  }
  return {
    ...data,
    blocks,
    unplaced: { ...data.unplaced, sections: unplaced },
  };
}

/** 工具条下面那一句：哪几样还没存。 */
export function pendingSummary(
  p: Pending,
  data: ManifestData,
  versionLabel: (v: ManifestVersion) => string,
  savedVersion: ManifestVersion,
): string[] {
  const out: string[] = [];
  if (p.version)
    out.push(
      `version ${versionLabel(savedVersion)} → ${versionLabel(p.version)}`,
    );
  for (const key of Object.keys(p.textSizes)) {
    const b = data.blocks.find((x) => x.bus_key === key);
    out.push(`text size on Bus ${b?.bus_number ?? key}`);
  }
  const moves = Object.entries(p.moves);
  if (moves.length) {
    const orders = new Map<number, string>();
    for (const b of data.blocks)
      for (const s of b.sections)
        for (const g of s.guests) orders.set(g.id, g.order_number);
    for (const s of data.unplaced.sections)
      for (const g of s.guests) orders.set(g.id, g.order_number);
    out.push(
      `${moves.length} guest${moves.length === 1 ? "" : "s"} moved (${moves
        .map(([id, l]) => `${orders.get(Number(id)) ?? id} → ${l || "no bus"}`)
        .join(", ")})`,
    );
  }
  const attrs = Object.values(p.attractions);
  if (attrs.length)
    out.push(
      `${attrs.length} confirmation box${attrs.length === 1 ? "" : "es"} (${attrs.map((a) => a.title).join(", ")})`,
    );
  const notes = Object.values(p.notes);
  if (notes.length)
    out.push(
      `Special Requirements for ${notes.map((n) => n.order).join(", ")}`,
    );
  return out;
}

// ── 往下传：换车、黄框都在表格深处 ─────────────────────────────────────

export interface StageCtx {
  /** 客人 id → 换车前在哪辆车（只有换过的）。 */
  movedFrom: Map<number, string>;
  attractions: Pending["attractions"];
  stageAttraction: (
    busKey: string,
    section: ManifestSection,
    values: AttrValues,
  ) => void;
  /** 改过、还没存的 Special Requirements（按客人 id）。 */
  notes: Pending["notes"];
  /** 存失败的那几样（Save 后还在 pending 里）：标得更醒目。 */
  failed: boolean;
}

export const Stage = createContext<StageCtx>({
  movedFrom: new Map(),
  attractions: {},
  stageAttraction: () => {},
  notes: {},
  failed: false,
});
export const useStage = () => useContext(Stage);

/** 琥珀色（没存的改动，同排班 / 排车页的 preview）。 */
export const UNSAVED_RING =
  "outline outline-2 outline-[#f59e0b] outline-offset-[-1px]";
export const UNSAVED_TAG =
  "inline-block rounded-full bg-[rgba(245,158,11,.22)] px-1.5 text-[10.5px] font-bold whitespace-nowrap text-[#92400e]";

// ── 弹窗 ─────────────────────────────────────────────────────────────

/** 有没存的改动时离开页面（Save / Don't save / Cancel）。 */
export function LeaveDialog({
  items,
  onSave,
  onDiscard,
  onCancel,
}: {
  items: string[];
  /** 存；全部存上返回 null，否则返回原因（留在框里显示）。 */
  onSave: () => Promise<string | null>;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      titleId="bm-leave-title"
      onDismiss={busy ? undefined : onCancel}
      panelClassName="max-w-[520px] p-5"
    >
      <div data-leave-dialog>
        <h2
          id="bm-leave-title"
          className="mb-3 text-[15px] font-semibold text-[#1a1a1a]"
        >
          Leave without saving?
        </h2>
        <div className={YELLOW_BOX}>
          <b>Not saved yet:</b> {items.join(" · ")}.
        </div>
        {error ? (
          <p
            role="alert"
            className="mt-3 text-[13px] font-semibold text-[#A32D2D]"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={LIGHT_BUTTON}
          >
            Cancel
          </button>
          <button
            type="button"
            data-leave-discard
            disabled={busy}
            onClick={onDiscard}
            className={LIGHT_BUTTON}
          >
            Don&rsquo;t save
          </button>
          <button
            type="button"
            data-leave-save
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const err = await onSave();
              setBusy(false);
              if (err) setError(err);
            }}
            className={sendButtonClass("blue")}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 有没存的改动时按 Print / Download（Q3）：先问，「Save and print」= 先存再打开。 */
export function SaveFirstDialog({
  action,
  items,
  onConfirm,
  onCancel,
}: {
  action: "print" | "download";
  items: string[];
  onConfirm: () => Promise<string | null>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verb = action === "print" ? "print" : "download";
  return (
    <Modal
      titleId="bm-save-first-title"
      onDismiss={busy ? undefined : onCancel}
      panelClassName="max-w-[520px] p-5"
    >
      <div data-save-first-dialog>
        <h2
          id="bm-save-first-title"
          className="mb-3 text-[15px] font-semibold text-[#1a1a1a]"
        >
          Save before {action === "print" ? "printing" : "downloading"}?
        </h2>
        <div className={YELLOW_BOX}>
          <b>Not saved yet:</b> {items.join(" · ")}.
          <br />
          The {action === "print" ? "printout" : "Excel file"} uses what is
          saved, so save first.
        </div>
        {error ? (
          <p
            role="alert"
            className="mt-3 text-[13px] font-semibold text-[#A32D2D]"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={LIGHT_BUTTON}
          >
            Cancel
          </button>
          <button
            type="button"
            data-save-first-go
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const err = await onConfirm();
              setBusy(false);
              if (err) setError(err);
            }}
            className={sendButtonClass("blue")}
          >
            {busy ? "Saving…" : `Save and ${verb}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
