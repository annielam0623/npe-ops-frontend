"use client";

import { useId, useState, type FormEvent } from "react";

import { cn } from "@/lib/utils";
import type { Team, TeamInput } from "@/types";

import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./buttons";
import {
  DEFAULT_TEAM_COLOR,
  TEAM_COLOR_PRESETS,
  TEAM_DESCRIPTION_MAX_LENGTH,
  TEAM_NAME_MAX_LENGTH,
  type ActionResult,
} from "./config";
import { Modal } from "./modal";

interface TeamFormDialogProps {
  /** 编辑时传原团队；新建时为 null。 */
  team: Team | null;
  onSubmit: (input: TeamInput) => Promise<ActionResult>;
  onClose: () => void;
}

const INPUT_CLASS =
  "w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none";

const LABEL_CLASS = "text-sm font-medium text-stone-700";

export function TeamFormDialog({
  team,
  onSubmit,
  onClose,
}: TeamFormDialogProps) {
  const titleId = useId();
  const nameId = useId();
  const descriptionId = useId();

  const [name, setName] = useState(team?.name ?? "");
  const [description, setDescription] = useState(team?.description ?? "");
  // 原颜色不在预设里时原样保留：不高亮任何色块，但保存时照旧提交原色。
  const [color, setColor] = useState(team?.color ?? DEFAULT_TEAM_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Team name is required.");
      return;
    }

    setError(null);
    setSaving(true);
    const result = await onSubmit({
      name: trimmedName,
      color,
      description: description.trim(),
    });
    // ok 时父组件会卸载本弹窗；redirecting 时保持「Saving…」直到跳走。
    if (result.status === "error") {
      setError(result.message);
      setSaving(false);
    }
  }

  return (
    <Modal titleId={titleId} onDismiss={saving ? undefined : onClose}>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <h2 id={titleId} className="text-lg font-semibold text-stone-900">
          {team ? "Edit Team" : "New Team"}
        </h2>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className={LABEL_CLASS}>
            Team Name *
          </label>
          <input
            id={nameId}
            type="text"
            autoFocus
            autoComplete="off"
            maxLength={TEAM_NAME_MAX_LENGTH}
            placeholder="e.g. Morning Pickup"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={INPUT_CLASS}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={descriptionId} className={LABEL_CLASS}>
            Description
          </label>
          <input
            id={descriptionId}
            type="text"
            autoComplete="off"
            maxLength={TEAM_DESCRIPTION_MAX_LENGTH}
            placeholder="Optional — what does this team handle?"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={INPUT_CLASS}
          />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={cn(LABEL_CLASS, "mb-2")}>Color</legend>
          <div className="flex flex-wrap gap-2.5">
            {TEAM_COLOR_PRESETS.map((preset) => {
              const selected = preset.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={preset}
                  type="button"
                  aria-label={preset}
                  aria-pressed={selected}
                  onClick={() => setColor(preset)}
                  className={cn(
                    "size-8 cursor-pointer rounded-full border-[3px] transition focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-1 focus-visible:outline-none",
                    selected ? "border-stone-800" : "border-transparent",
                  )}
                  style={{ backgroundColor: preset }}
                />
              );
            })}
          </div>
        </fieldset>

        {error ? (
          <p role="alert" className="text-sm text-[#A32D2D]">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={PRIMARY_BUTTON_CLASS}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
