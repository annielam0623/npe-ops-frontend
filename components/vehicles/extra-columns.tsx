"use client";

import { useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
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

  const btn =
    "rounded-md border px-2 py-0.5 text-xs font-medium disabled:opacity-50";
  return (
    <section
      aria-label="Extra columns"
      className="rounded-lg border border-stone-200 bg-white"
    >
      <h2 className="border-b border-stone-200 px-4 py-3 text-sm font-semibold text-stone-900">
        Extra columns
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        className="flex flex-wrap items-center gap-2 px-4 pt-3"
      >
        <input
          value={label}
          maxLength={COLUMN_LABEL_MAX}
          placeholder="Column name, e.g. Plate"
          aria-label="New column name"
          autoComplete="off"
          onChange={(e) => setLabel(e.target.value)}
          className="w-56 rounded-md border border-stone-300 px-2.5 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={busy !== null}
          className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
        >
          {busy === "add" ? "Adding…" : "Add column"}
        </button>
        {msg ? (
          <span
            role={msg.tone === "error" ? "alert" : "status"}
            className={cn(
              "text-xs",
              msg.tone === "ok" ? "text-emerald-700" : "text-[#A32D2D]",
            )}
          >
            {msg.text}
          </span>
        ) : null}
      </form>
      <div className="flex flex-wrap gap-2 px-4 pt-3 pb-4">
        {columns.length === 0 ? (
          <span className="text-xs text-stone-400">No extra columns yet.</span>
        ) : (
          columns.map((c) => {
            const r = renaming[c.id];
            return (
              <div
                key={c.id}
                data-col={c.id}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border border-stone-200 bg-stone-50 py-1 pr-1.5 pl-3 text-xs",
                  c.is_hidden && "opacity-60",
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
                      className="w-40 rounded border border-stone-300 px-1.5 py-0.5"
                    />
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void update(c, { label: r })}
                      className={cn(btn, "border-emerald-700 text-emerald-700")}
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
                      className={cn(btn, "border-stone-300")}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span>
                      {c.label}
                      {c.is_hidden ? (
                        <span className="text-stone-400"> (hidden)</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        setRenaming({ ...renaming, [c.id]: c.label })
                      }
                      className={cn(btn, "border-stone-300")}
                    >
                      Rename
                    </button>
                    {c.is_hidden ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void update(c, { is_hidden: false })}
                        className={cn(
                          btn,
                          "border-emerald-700 text-emerald-700",
                        )}
                      >
                        Show
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void update(c, { is_hidden: true })}
                        className={cn(btn, "border-[#A32D2D] text-[#A32D2D]")}
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
