"use client";

import { useId, useState } from "react";

import { Modal } from "@/components/ui/modal";
import { VisibilityControl } from "@/components/ui/visibility-control";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  addRosterPerson,
  phoneDigits,
  type Roster,
  type RosterPerson,
} from "@/lib/dispatch-roster-api";
import { cn } from "@/lib/utils";

import {
  HOWTO,
  HOWTO_OL,
  HOWTO_SUMMARY,
  TD,
  TH,
  TM_BTN,
} from "./legacy-styles";

type Side = "driver" | "guide";

const byName = (a: RosterPerson, b: RosterPerson) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/**
 * G192「Drivers & guides」窗口（Annie 2026-10-26 看 preview https://claude.ai/artifact/R7mzCP6Emi88Cqgoa6zS3Y 回「ok」，Q1–Q6 全 A）：
 * 左 Drivers、右 Guides，名字 + 电话（A–Z，Driver + Guide 两边都有）；每边一个 + Add driver / + Add guide（只填名字 + 电话，
 * 要 dispatch.edit）。电话重复（409）：后端原话红字 + 名单里已有的那个人标黄。存好：这一行标绿「✓ Added」，排车下拉马上有这个人。
 * 改 / 停用 / 删除、驾照等资料仍在 Settings › Human Resource（admin）。右上角 Visible to 只有 Super Admin 看得到。
 */
export function RosterDialog({
  roster,
  canAdd,
  onClose,
  onAdded,
  onUnauthorized,
}: {
  roster: Roster;
  canAdd: boolean;
  onClose: () => void;
  /** 存好了：排车页把这个人加进自己的司机 / 导游名单（不重读这一天）。 */
  onAdded: (person: RosterPerson, side: Side) => void;
  onUnauthorized: () => void;
}) {
  const titleId = useId();
  const [open, setOpen] = useState<Side | null>(null);
  const [busy, setBusy] = useState(false);
  /** 电话重复时，名单里已有的那个号码（只比数字），两边都标黄。 */
  const [dupPhone, setDupPhone] = useState<string | null>(null);
  const [added, setAdded] = useState<ReadonlySet<number>>(new Set());

  async function save(
    side: Side,
    name: string,
    phone: string,
  ): Promise<string | null> {
    setBusy(true);
    setDupPhone(null);
    try {
      const person = await addRosterPerson({ name, phone, type: side });
      setAdded((s) => new Set(s).add(person.id));
      setOpen(null);
      onAdded(person, side);
      return null;
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return null;
      }
      if (isStatus(e, 409)) setDupPhone(phoneDigits(phone));
      if (isStatus(e, 403))
        return "Your account can't add people here. Nothing was added.";
      return e instanceof TypeError
        ? "Could not reach the server. Nothing was added - try again."
        : describeError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      panelClassName="max-w-[960px] max-h-[92vh] overflow-y-auto text-[#111827]"
    >
      <div
        data-roster
        className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e5e7eb] px-[18px] pt-4 pb-3"
      >
        <div className="min-w-0">
          <h2 id={titleId} className="m-0 text-[18px] font-bold">
            Drivers &amp; guides
          </h2>
          <p className="m-0 mt-0.5 text-[12.5px] text-[#4a5568]">
            Everyone who can be picked on Dispatch. Licence and other details:
            Settings › Human Resource.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <VisibilityControl pageKey="dispatch_roster" tone="light" />
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={TM_BTN}
          >
            Close
          </button>
        </div>
      </div>
      <details className={cn(HOWTO, "mx-[18px] mt-3 max-w-none")}>
        <summary className={HOWTO_SUMMARY}>
          📖 How to use — Drivers &amp; guides
        </summary>
        <ol className={HOWTO_OL}>
          <li>
            Click Drivers &amp; guides (next to Import history) to see each
            driver and guide with their phone number.
          </li>
          <li>
            To add someone, click Add driver or Add guide, type the name and
            phone number, then click Save.
          </li>
          <li>
            The new person is in the Driver or Guide list on this page right
            away.
          </li>
          <li>
            &quot;This phone number is already on the list&quot; means that
            person is already in the system. Find them in the list instead of
            adding them again.
          </li>
          <li>
            To change or remove a person, or to fill in licence and other
            details, ask an admin in Settings › Human Resource.
          </li>
        </ol>
      </details>
      <div className="grid grid-cols-2 max-[720px]:grid-cols-1">
        {(["driver", "guide"] as const).map((side) => (
          <Column
            key={side}
            side={side}
            people={[
              ...(side === "driver" ? roster.drivers : roster.guides),
            ].sort(byName)}
            canAdd={canAdd}
            formOpen={open === side}
            busy={busy}
            dupPhone={dupPhone}
            added={added}
            onOpen={() => {
              setDupPhone(null);
              setOpen(side);
            }}
            onCancel={() => {
              setDupPhone(null);
              setOpen(null);
            }}
            onSave={(name, phone) => save(side, name, phone)}
          />
        ))}
      </div>
    </Modal>
  );
}

function Column({
  side,
  people,
  canAdd,
  formOpen,
  busy,
  dupPhone,
  added,
  onOpen,
  onCancel,
  onSave,
}: {
  side: Side;
  people: RosterPerson[];
  canAdd: boolean;
  formOpen: boolean;
  busy: boolean;
  dupPhone: string | null;
  added: ReadonlySet<number>;
  onOpen: () => void;
  onCancel: () => void;
  /** 返回出错的那句话；null = 存好了（或已跳登录）。 */
  onSave: (name: string, phone: string) => Promise<string | null>;
}) {
  const title = side === "driver" ? "Drivers" : "Guides";
  const what = side === "driver" ? "driver" : "guide";
  return (
    <section
      aria-label={title}
      data-roster-side={side}
      className={cn(
        "min-w-0 px-[18px] pt-3.5 pb-[18px]",
        side === "guide" &&
          "border-l border-[#e5e7eb] max-[720px]:border-t max-[720px]:border-l-0",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2.5">
        <h3 className="m-0 text-[14px] font-bold">
          {title}{" "}
          <span className="font-normal text-[#6b7280] tabular-nums">
            {people.length}
          </span>
        </h3>
        {canAdd && !formOpen ? (
          <button
            type="button"
            data-roster-add={side}
            onClick={onOpen}
            disabled={busy}
            className={TM_BTN}
          >
            + Add {what}
          </button>
        ) : null}
      </div>
      {formOpen ? (
        <AddForm
          side={side}
          busy={busy}
          dup={!!dupPhone}
          onCancel={onCancel}
          onSave={onSave}
        />
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={cn(TH, "py-1.5")}>Name</th>
              <th className={cn(TH, "py-1.5")}>Phone</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const isNew = added.has(p.id);
              const isDup = !!dupPhone && phoneDigits(p.phone) === dupPhone;
              return (
                <tr
                  key={p.id}
                  data-roster-person={p.id}
                  data-dup={isDup || undefined}
                  data-added={isNew || undefined}
                  className={cn(
                    isDup ? "bg-[#fff4d6]" : isNew ? "bg-[#eef9f1]" : "",
                  )}
                >
                  <td className={cn(TD, "px-2.5 py-[7px]")}>
                    {p.name}
                    {p.type === "both" ? (
                      <span className="ml-1.5 inline-block rounded-[5px] bg-[#e6f4ec] px-[5px] text-[10.5px] font-bold text-[#1e6b43]">
                        Driver + Guide
                      </span>
                    ) : null}
                    {isNew ? (
                      <span className="ml-1.5 text-[10.5px] font-bold text-[#1e6b43]">
                        ✓ Added
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={cn(
                      TD,
                      "px-2.5 py-[7px] font-mono text-[12px] whitespace-nowrap tabular-nums",
                    )}
                  >
                    {p.phone || "—"}
                  </td>
                </tr>
              );
            })}
            {!people.length ? (
              <tr>
                <td
                  colSpan={2}
                  className={cn(TD, "px-2.5 py-3 text-center text-[#6b7280]")}
                >
                  No {title.toLowerCase()} yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AddForm({
  side,
  busy,
  dup,
  onCancel,
  onSave,
}: {
  side: Side;
  busy: boolean;
  /** 刚才那次是电话重复（电话框标红）。 */
  dup: boolean;
  onCancel: () => void;
  onSave: (name: string, phone: string) => Promise<string | null>;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const INPUT =
    "h-8 min-w-0 rounded-[7px] border border-[#cbd2dc] bg-white px-2.5 text-[13px] text-[#111827]";
  return (
    <form
      data-roster-form={side}
      onSubmit={async (e) => {
        e.preventDefault();
        setError(await onSave(name.trim(), phone.trim()));
      }}
      className="mb-2.5 flex flex-col gap-2 rounded-[10px] border border-[#cbd2dc] bg-[#f8fafc] p-3"
    >
      <div className="grid grid-cols-2 gap-2 max-[720px]:grid-cols-1">
        <label
          htmlFor={`${id}-name`}
          className="flex min-w-0 flex-col gap-[3px] text-[11.5px] font-semibold text-[#374151]"
        >
          Name
          <input
            id={`${id}-name`}
            data-roster-name
            autoFocus
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            className={INPUT}
          />
        </label>
        <label
          htmlFor={`${id}-phone`}
          className="flex min-w-0 flex-col gap-[3px] text-[11.5px] font-semibold text-[#374151]"
        >
          Phone
          <input
            id={`${id}-phone`}
            data-roster-phone
            inputMode="tel"
            value={phone}
            maxLength={40}
            aria-invalid={(!!error && dup) || undefined}
            onChange={(e) => setPhone(e.target.value)}
            className={cn(
              INPUT,
              error &&
                dup &&
                "border-[#b3261e] shadow-[inset_0_0_0_1px_#b3261e]",
            )}
          />
        </label>
      </div>
      {error ? (
        <p
          role="alert"
          data-roster-error
          className="m-0 text-[12px] font-semibold text-[#b3261e]"
        >
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        {/* 蓝色只给提交键（Annie 2026-10-11）。 */}
        <button
          type="submit"
          data-roster-save
          disabled={busy || !name.trim() || !phone.trim()}
          className="h-8 rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-4 text-[12.5px] font-semibold text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] text-[#185fa5] underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
