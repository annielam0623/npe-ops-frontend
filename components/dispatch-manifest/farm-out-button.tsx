"use client";

import { useEffect, useState } from "react";

import {
  LIGHT_BUTTON,
  sendButtonClass,
  YELLOW_BOX,
} from "@/components/tickets-send/legacy-ui";
import { Modal } from "@/components/ui/modal";
import {
  applyDispatchMeta,
  cloneRow,
  META,
  unitOf,
} from "@/components/dispatch/config";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  acquireEditLock,
  fetchDispatchDay,
  releaseEditLock,
  saveDispatchSection,
} from "@/lib/dispatch-api";
import { fetchPartners } from "@/lib/farm-out-api";
import { cn } from "@/lib/utils";
import type { DispatchRow, ManifestBlock } from "@/types";
import type { FarmOutPartner } from "@/types/farm-out";

/**
 * Bus Manifest 页第二辆车的「⇄ Farm out」键（Annie 2026-10-28「要」；preview https://claude.ai/artifact/7uRp5FHfFTsnRYemrrm1Wf ，
 * Q1–Q5 照推荐，主窗口 eb 2026-10-30 派工）：
 * Q1 键在第二辆车色条上；Q2 点了弹框选合作公司，框里蓝色 Farm out 马上生效（不并进整页 Save：做的是 Dispatch 那边的事）；
 * Q3 转完页面上方黄条提醒去 Dispatch 选酒店、发通知；Q4 撤销照旧在 Dispatch；Q5 选酒店、发通知不搬过来。
 * 不用改后端，照 Dispatch 的做法依次调：占住这一天（edit-lock）→ 读这一天（GET day）→ 只存这一团（POST section）→ 放开。
 */

/** 色条上的小键（同 Print / Guide view 的样子）。 */
const BAND_BUTTON =
  "inline-flex h-[26px] cursor-pointer items-center gap-[5px] rounded-[7px] border border-[#475569] bg-white px-2.5 text-[11.5px] font-bold whitespace-nowrap text-[#1e293b] disabled:cursor-not-allowed disabled:opacity-45";

type Partners =
  | { state: "loading" }
  | { state: "ready"; list: FarmOutPartner[] }
  | { state: "failed" };

/** 合作公司名单：页面上只读一次（同 Dispatch，接口读不到时键整个不出现）。 */
export function usePartners(enabled: boolean): Partners {
  const [partners, setPartners] = useState<Partners>({ state: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchPartners()
      .then((list) => alive && setPartners({ state: "ready", list }))
      .catch(() => alive && setPartners({ state: "failed" }));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return partners;
}

/**
 * 把这一团的第二辆车转给合作公司：返回 null = 成功；字符串 = 没转（后端原话，例如别人正在改这一天）。
 * assignmentId = 这辆车在 Dispatch 的行 id（Bus Manifest 的 block.bus.id）；对不上（Dispatch 那边刚改过）就不转。
 */
export async function farmOutBus(input: {
  date: string;
  tour: number;
  assignmentId: number;
  partnerId: number;
}): Promise<string | null> {
  const { date, tour, assignmentId, partnerId } = input;
  const lock = await acquireEditLock(date, null);
  try {
    const day = await fetchDispatchDay(date);
    applyDispatchMeta(day.meta);
    const unit = unitOf({ shift: META.bus_tour_shift, manifest_id: tour });
    const rows = day.rows.filter((r) => unitOf(r) === unit);
    const idx = rows.findIndex((r) => r.id === assignmentId);
    // 只有第二辆车能转（同 Dispatch 的规矩）。
    if (idx !== 1)
      return "This bus changed on Dispatch since this page was opened. Reload the page and try again.";
    const next: DispatchRow[] = rows.map((r, i) =>
      i === idx
        ? {
            ...cloneRow(r),
            farm_out: true,
            partner_id: partnerId,
            // Farm out 车必须有车字母（后端 400 A farm out car needs a bus letter.），同 Dispatch。
            bus_label:
              r.bus_label ??
              META.bus_labels.find(
                (l) => !rows.some((x) => x.bus_label === l),
              ) ??
              null,
            driver_hr_id: null,
            driver_typed_name: null,
            vehicle_id: null,
            guide_hr_id: null,
            guide_typed_name: null,
            location_ids: [],
          }
        : cloneRow(r),
    );
    await saveDispatchSection(date, unit, next, lock.token);
    return null;
  } finally {
    // 成功失败都放开这一天（section 存好不会自己放）。
    await releaseEditLock(date, lock.token).catch(() => undefined);
  }
}

/** 第二辆车色条上的键 + 弹框。 */
export function FarmOutButton({
  date,
  tour,
  block,
  partners,
  blocked,
  onDone,
  onError,
  onUnauthorized,
}: {
  date: string;
  tour: number;
  block: ManifestBlock;
  partners: Partners;
  /** 页面上有没存的改动：先存再转（转完整页重读，没存的换车会对不上）。 */
  blocked: boolean;
  onDone: (partnerName: string) => void;
  /** 没转成：原话写在页面上方的红条（同 preview ④）。 */
  onError: (message: string) => void;
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (partners.state !== "ready") return null;
  const active = partners.list.filter((p) => p.is_active);
  const none = active.length === 0;
  return (
    <>
      <button
        type="button"
        data-farm-out-button
        disabled={none || blocked}
        title={
          none
            ? "No farm out partners yet. An admin adds them in Supplier → Partners."
            : blocked
              ? "Save your changes first."
              : undefined
        }
        onClick={() => setOpen(true)}
        className={BAND_BUTTON}
      >
        ⇄ Farm out
      </button>
      {open ? (
        <FarmOutDialog
          date={date}
          tour={tour}
          block={block}
          partners={active}
          onClose={() => setOpen(false)}
          onDone={(name) => {
            setOpen(false);
            onDone(name);
          }}
          onError={(m) => {
            setOpen(false);
            onError(m);
          }}
          onUnauthorized={onUnauthorized}
        />
      ) : null}
    </>
  );
}

function FarmOutDialog({
  date,
  tour,
  block,
  partners,
  onClose,
  onDone,
  onError,
  onUnauthorized,
}: {
  date: string;
  tour: number;
  block: ManifestBlock;
  partners: FarmOutPartner[];
  onClose: () => void;
  onDone: (partnerName: string) => void;
  onError: (message: string) => void;
  onUnauthorized: () => void;
}) {
  // 只有一家时已经帮你选好（Q2）。
  const [partnerId, setPartnerId] = useState<number | null>(
    partners.length === 1 ? partners[0].id : null,
  );
  const [busy, setBusy] = useState(false);
  const guests = block.sections.flatMap((s) => s.guests);
  const orders = new Set(guests.map((g) => g.order_number)).size;
  const pax = guests.reduce((n, g) => n + (g.pax || 0), 0);
  const bus = block.bus_number;

  async function go() {
    if (partnerId === null || busy) return;
    setBusy(true);
    try {
      const err = await farmOutBus({
        date,
        tour,
        assignmentId: block.bus.id,
        partnerId,
      });
      if (err) onError(err);
      else onDone(partners.find((p) => p.id === partnerId)?.name ?? "");
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      onError(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      titleId="bm-farm-out-title"
      onDismiss={busy ? undefined : onClose}
      panelClassName="max-w-[520px] p-5"
    >
      <div data-farm-out-dialog className="flex flex-col gap-3">
        <h2
          id="bm-farm-out-title"
          className="text-[16px] font-semibold text-[#1a1a1a]"
        >
          Farm out Bus {bus}?
        </h2>
        <label className="flex flex-wrap items-center gap-2.5 text-[13px] text-[#1a1a1a]">
          <span className="font-semibold">Farm out to</span>
          <select
            aria-label="Farm out to"
            value={partnerId ?? ""}
            disabled={busy}
            onChange={(e) =>
              setPartnerId(e.target.value ? Number(e.target.value) : null)
            }
            className="min-h-[34px] w-[230px] rounded-[7px] border border-[#cbd2dc] bg-white px-2 text-[13.5px] text-[#111]"
          >
            {partners.length > 1 ? (
              <option value="">— pick a partner —</option>
            ) : null}
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[12.5px] leading-[1.55] text-[#475569]">
          {orders} order{orders === 1 ? "" : "s"} ({pax} pax) on Bus {bus} go to
          the partner. They move to <b>Affiliate</b> at the bottom of this page.
          {block.bus.driver ? (
            <>
              <br />
              Driver <b>{block.bus.driver}</b> will be taken off this bus.
            </>
          ) : null}
        </p>
        <div className={YELLOW_BOX}>
          Next, on Dispatch: pick each order&rsquo;s hotel and send the farm out
          notice.
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={LIGHT_BUTTON}
          >
            Cancel
          </button>
          <button
            type="button"
            data-farm-out-go
            disabled={busy || partnerId === null}
            onClick={() => void go()}
            className={cn(sendButtonClass("blue"), "min-w-[96px]")}
          >
            {busy ? "Farming out…" : "Farm out"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
