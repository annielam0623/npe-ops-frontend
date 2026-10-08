"use client";

import { useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  BTN_EDIT_CLASS,
  BTN_OFF_CLASS,
  BTN_ON_CLASS,
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CARD_TITLE_CLASS,
  INLINE_INPUT_BASE,
  resultClass,
} from "@/components/pickup-locations/legacy-ui";
import { cn } from "@/lib/utils";
import {
  COLUMN_LABEL_MAX,
  createVehicleColumn,
  updateVehicleColumn,
} from "@/lib/vehicles-api";
import type { VehicleColumn } from "@/types";

/**
 * staff 自己加的列（只收文字）：加、改名、隐藏 / 显示。**不删**（值留着）。
 * 这些列只给人看，代码不读（要拿来算的做成固定列，例如 Seats）。
 */
export function ExtraColumns({
  columns,
  onChanged,
  onUnauthorized,
}: {
  columns: VehicleColumn[];
  onChanged: () => Promise<void>;
  onUnauthorized: () => void;
}) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<Record<number, string>>({});

  function fail(error: unknown) {
    if (isStatus(error, 401)) onUnauthorized();
    else setMsg({ tone: "error", text: describeError(error) });
  }

  async function add() {
    if (busy) return;
    setBusy("add");
    setMsg(null);
    try {
      const col = await createVehicleColumn(label);
      setLabel("");
      setMsg({
        tone: "ok",
        text: `✓ Added column ${col.label}. Fill it in with Edit or Edit all.`,
      });
      await onChanged();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  }

  async function update(
    c: VehicleColumn,
    patch: { label?: string; is_hidden?: boolean },
  ) {
    if (busy) return;
    setBusy(String(c.id));
    setMsg(null);
    try {
      await updateVehicleColumn(c.id, patch);
      setRenaming((r) => {
        const next = { ...r };
        delete next[c.id];
        return next;
      });
      await onChanged();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Extra columns" className={CARD_CLASS}>
      <div className={CARD_HEADER_CLASS}>
        <h2 className={CARD_TITLE_CLASS}>Extra columns</h2>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        className="flex flex-wrap items-center gap-2 px-5 pt-3.5 pb-1.5"
      >
        <input
          value={label}
          maxLength={COLUMN_LABEL_MAX}
          placeholder="Column name, e.g. Plate"
          aria-label="New column name"
          autoComplete="off"
          onChange={(e) => setLabel(e.target.value)}
          className="w-[220px] rounded-[7px] border-[0.5px] border-black/20 bg-white px-2.5 py-[7px] text-[13px] text-[#1a1a1a] focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy !== null}
          className={BTN_EDIT_CLASS}
        >
          {busy === "add" ? "Adding…" : "Add column"}
        </button>
        {msg ? (
          <span
            role={msg.tone === "error" ? "alert" : "status"}
            className={resultClass(msg.tone)}
          >
            {msg.text}
          </span>
        ) : null}
      </form>
      <div className="flex flex-wrap gap-2 px-5 pt-1.5 pb-3.5">
        {columns.length === 0 ? (
          <span className="text-[12px] text-[#999]">No extra columns yet.</span>
        ) : (
          columns.map((c) => {
            const r = renaming[c.id];
            return (
              <div
                key={c.id}
                data-col={c.id}
                className={cn(
                  "flex items-center gap-1.5 rounded-[8px] border-[0.5px] border-black/[.12] bg-[#fafaf8] py-[5px] pr-2 pl-3 text-[12px] text-[#1a1a1a]",
                  c.is_hidden && "opacity-55",
                )}
              >
                {r !== undefined ? (
                  <>
                    <input
                      aria-label="Column name"
                      value={r}
                      maxLength={COLUMN_LABEL_MAX}
                      autoFocus
                      onChange={(e) =>
                        setRenaming({ ...renaming, [c.id]: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void update(c, { label: r });
                        if (e.key === "Escape")
                          setRenaming((x) => {
                            const n = { ...x };
                            delete n[c.id];
                            return n;
                          });
                      }}
                      className={cn(INLINE_INPUT_BASE, "w-40")}
                    />
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void update(c, { label: r })}
                      className={BTN_ON_CLASS}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setRenaming((x) => {
                          const n = { ...x };
                          delete n[c.id];
                          return n;
                        })
                      }
                      className={BTN_EDIT_CLASS}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span>
                      {c.label}
                      {c.is_hidden ? (
                        <span className="text-[#999]"> (hidden)</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        setRenaming({ ...renaming, [c.id]: c.label })
                      }
                      className={BTN_EDIT_CLASS}
                    >
                      Rename
                    </button>
                    {c.is_hidden ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void update(c, { is_hidden: false })}
                        className={BTN_ON_CLASS}
                      >
                        Show
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void update(c, { is_hidden: true })}
                        className={BTN_OFF_CLASS}
                      >
                        Hide
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
