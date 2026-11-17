"use client";

import { useState } from "react";

import { usePhoneInfo } from "@/components/ui/phone";
import { describeError, isStatus } from "@/lib/api-errors";
import { lockPayrollDates, unlockPayrollDates } from "@/lib/guide-payroll-api";
import { cn } from "@/lib/utils";
import type { PayrollLock } from "@/types/guide-payroll";

import { isAutoLock, PayrollAutoLock } from "./payroll-auto-lock";

import {
  HR_CARD_CLASS,
  HR_CARD_HEADER_CLASS,
  HR_CARD_TITLE_CLASS,
} from "./legacy-ui";
import {
  C_BTN,
  C_BTN_SAVE,
  C_CONFIRM,
  C_DIM,
  C_GREEN,
  C_HINT,
  C_INPUT,
  C_LINK,
  C_RED,
  C_SAVEBAR,
  C_STICKY,
  C_TABLE,
  C_TD,
  C_TH,
  C_WRAP,
  cardRangeName,
  dateError,
} from "./payroll-cards-shared";

/**
 * Payroll › Locked dates 卡（138 乙，5a；V9 题 7 A）：列表 Dates / Note / Locked by / Unlock（蓝下划线字），
 * 下面 From / To / Note + 蓝「Lock dates」。锁和解锁都先出黄框确认，点了就直接存（照规矩用蓝色）。
 * 页面上有没存的改动（runsDirty）时按 Lock dates ⇒ 红字 "Save or discard your changes first."。
 */

type Confirm =
  | { kind: "lock"; from: string; to: string; note: string }
  | { kind: "unlock"; lock: PayrollLock };

export interface PayrollLocksProps {
  canEdit: boolean;
  onUnauthorized: () => void;
  locks: PayrollLock[];
  /** 页面上（期间页或 Pay rates）有没存的改动。 */
  runsDirty: boolean;
  /** 锁 / 解锁成功后：页面重拉期间数据。 */
  onChanged: () => void;
}

export function PayrollLocks({
  canEdit,
  onUnauthorized,
  locks,
  runsDirty,
  onChanged,
}: PayrollLocksProps) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const info = usePhoneInfo("About locked dates");

  const sorted = [...locks].sort((a, b) => a.from.localeCompare(b.from));

  function askLock() {
    setMsg(null);
    const e =
      dateError(from, "from") ??
      dateError(to, "to") ??
      (to < from ? "'To' can't be before 'from'." : null) ??
      (() => {
        const ov = locks.find((l) => from <= l.to && to >= l.from);
        return ov
          ? `${ov.from} to ${ov.to} is already locked. Pick dates that don't overlap.`
          : null;
      })() ??
      (runsDirty ? "Save or discard your changes first." : null);
    if (e) {
      setErr(e);
      setConfirm(null);
      return;
    }
    setErr(null);
    setConfirm({ kind: "lock", from, to, note: note.trim() });
  }

  async function go() {
    if (!confirm || busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (confirm.kind === "lock") {
        await lockPayrollDates({
          from: confirm.from,
          to: confirm.to,
          ...(confirm.note ? { note: confirm.note } : {}),
        });
        setFrom("");
        setTo("");
        setNote("");
      } else {
        await unlockPayrollDates(confirm.lock.id);
      }
      setConfirm(null);
      setMsg("Saved");
      onChanged();
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={HR_CARD_CLASS} data-payroll-locks>
      <div className={HR_CARD_HEADER_CLASS}>
        <span className={HR_CARD_TITLE_CLASS}>
          Locked dates
          {info.button}
        </span>
        <span className={cn(C_HINT, info.hide)}>
          Lock days after their pay is final. Locking or unlocking is saved
          right away.
        </span>
      </div>
      <PayrollAutoLock onUnauthorized={onUnauthorized} />
      {sorted.length ? (
        <div className={cn(C_WRAP, "pt-3")}>
          <table className={cn(C_TABLE, "min-w-[480px]")}>
            <thead>
              <tr>
                <th className={cn(C_TH, C_STICKY)}>Dates</th>
                <th className={C_TH}>Note</th>
                <th className={C_TH}>Locked by</th>
                <th className={C_TH} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => (
                <tr key={l.id} className="bg-white" data-lock-row={l.id}>
                  <td className={cn(C_TD, C_STICKY, "whitespace-nowrap")}>
                    {cardRangeName(l.from, l.to)}
                  </td>
                  <td className={C_TD}>
                    {l.note ? l.note : <span className={C_DIM}>—</span>}
                  </td>
                  <td className={C_TD}>
                    {/* 系统自动锁的行（Annie 2026-11-17 自动锁动手）：写灰字 Auto，不写后端的账号名。 */}
                    {isAutoLock(l.created_by) ? (
                      <span className={C_DIM} data-lock-auto>
                        Auto
                      </span>
                    ) : (
                      (l.created_by ?? <span className={C_DIM}>—</span>)
                    )}
                  </td>
                  <td className={C_TD}>
                    {canEdit ? (
                      <button
                        type="button"
                        className={C_LINK}
                        data-unlock={l.id}
                        disabled={busy}
                        onClick={() => {
                          setErr(null);
                          setMsg(null);
                          setConfirm({ kind: "unlock", lock: l });
                        }}
                      >
                        Unlock
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="px-4 py-7 text-center text-[13px] text-[#4b5563]"
          data-locks-empty
        >
          No dates are locked.
        </div>
      )}
      {confirm ? (
        <div className={C_CONFIRM} data-lock-confirm={confirm.kind}>
          <span className="flex-[1_1_260px]">
            {confirm.kind === "lock"
              ? `Lock ${cardRangeName(confirm.from, confirm.to)}? Fees, extras and tips on these days, and prices or extra amounts that cover them, can’t be changed until you unlock.`
              : `Unlock ${cardRangeName(confirm.lock.from, confirm.lock.to)}? Pay on these days can be changed again.`}
          </span>
          <button
            type="button"
            className={C_BTN_SAVE}
            disabled={busy}
            data-lock-yes
            onClick={() => void go()}
          >
            {busy ? "Saving…" : confirm.kind === "lock" ? "Lock" : "Unlock"}
          </button>
          <button
            type="button"
            className={C_BTN}
            disabled={busy}
            data-lock-no
            onClick={() => setConfirm(null)}
          >
            Cancel
          </button>
        </div>
      ) : null}
      {canEdit ? (
        <div className={cn(C_SAVEBAR, "mt-3")} data-lock-form>
          <label className="inline-flex items-center gap-1.5 text-[13px]">
            From
            <input
              type="date"
              className={C_INPUT}
              value={from}
              data-lf="from"
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-[13px]">
            To
            <input
              type="date"
              className={C_INPUT}
              value={to}
              data-lf="to"
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-[13px] max-sm:w-full">
            Note
            <input
              className={cn(C_INPUT, "max-sm:flex-1")}
              value={note}
              placeholder="Optional, like Paid Nov 9"
              data-lf="note"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={C_BTN_SAVE}
            disabled={busy}
            data-lock-dates
            onClick={askLock}
          >
            Lock dates
          </button>
          <span className="flex-1" />
          {err ? (
            <span className={C_RED} role="alert" data-lock-err>
              {err}
            </span>
          ) : msg ? (
            <span className={C_GREEN} data-lock-saved>
              {msg}
            </span>
          ) : null}
        </div>
      ) : err ? (
        <p className={cn(C_RED, "m-0 px-4 py-3")} role="alert">
          {err}
        </p>
      ) : (
        <div className="h-3" />
      )}
    </div>
  );
}
