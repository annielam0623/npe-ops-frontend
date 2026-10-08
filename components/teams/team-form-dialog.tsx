"use client";

import { useId, useState, type FormEvent } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import type { Team, TeamInput } from "@/types";

import {
  DEFAULT_TEAM_COLOR,
  TEAM_COLOR_PRESETS,
  TEAM_DESCRIPTION_MAX_LENGTH,
  TEAM_NAME_MAX_LENGTH,
} from "./config";
import {
  LEGACY_CANCEL_BUTTON_CLASS,
  LEGACY_ERROR_CLASS,
  LEGACY_INPUT_CLASS,
  LEGACY_LABEL_CLASS,
  LEGACY_MODAL_TITLE_CLASS,
  LEGACY_SAVE_BUTTON_CLASS,
} from "./legacy-styles";

interface TeamFormDialogProps {
  /** 编辑时传原团队；新建时为 null。 */
  team: Team | null;
  onSubmit: (input: TeamInput) => Promise<ActionResult>;
  onClose: () => void;
}

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
    <Modal
      titleId={titleId}
      onDismiss={saving ? undefined : onClose}
      panelClassName="max-w-[460px] !rounded-[14px] p-7"
    >
      {/* 版式照旧页面 settings_teams.html 的 #modal：各块之间靠下边距，不是等距。 */}
      <form noValidate onSubmit={handleSubmit}>
        <h2 id={titleId} className={LEGACY_MODAL_TITLE_CLASS}>
          {team ? "Edit Team" : "New Team"}
        </h2>

        <label htmlFor={nameId} className={LEGACY_LABEL_CLASS}>
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
          className={LEGACY_INPUT_CLASS}
        />

        <label htmlFor={descriptionId} className={LEGACY_LABEL_CLASS}>
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
          className={LEGACY_INPUT_CLASS}
        />

        <fieldset>
          <legend className="mb-2 block text-[13px] font-semibold text-[#444]">
            Color
          </legend>
          <div className="mb-5 flex flex-wrap gap-2.5">
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
                    "size-[30px] cursor-pointer rounded-full border-[3px] border-solid transition-[border] duration-150",
                    selected ? "border-[#1a3a5c]" : "border-transparent",
                  )}
                  style={{ backgroundColor: preset }}
                />
              );
            })}
          </div>
        </fieldset>

        {error ? (
          <p role="alert" className={LEGACY_ERROR_CLASS}>
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={LEGACY_CANCEL_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={LEGACY_SAVE_BUTTON_CLASS}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
