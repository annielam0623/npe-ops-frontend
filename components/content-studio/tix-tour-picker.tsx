"use client";

import { useEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  createTixTourType,
  fetchTixTourTypes,
  suggestTixKey,
  TIX_KEY_RE,
  type TixTourType,
  updateTixTourType,
} from "@/lib/tix-tour-types-api";
import { cn } from "@/lib/utils";

import { TIX_TOURS } from "./fields";

/** 现有 15 个团的按钮照旧用原来的短名（同旧页面）；新建的团用后端的团名。 */
const SHORT_LABEL: Record<string, string> = Object.fromEntries(
  TIX_TOURS.map((t) => [t.key, t.label]),
);

const INPUT =
  "min-w-0 rounded-[6px] border border-[#e5e7eb] bg-paper px-2 py-1 text-[11px] text-[#1a1a1a] placeholder:text-[#a8a39b] night:border-white/10 night:bg-white/[.04] night:text-white/90 night:placeholder:text-white/30";
const FIELD = "flex min-w-0 flex-col gap-[3px]";
const FIELD_LABEL =
  "text-[10px] font-semibold text-[#6B5E57] night:text-white/55";
const NOTE = "mt-1.5 text-[10.5px] leading-[1.5] text-[#6B5E57] night:text-white/55";
const BUTTON =
  "cursor-pointer rounded-[6px] border border-[#1a1a1a] bg-paper px-3 py-1 text-[11px] font-medium text-[#1a1a1a] hover:enabled:bg-[#1a1a1a] hover:enabled:text-white disabled:opacity-50 night:border-white/40 night:bg-white/[.04] night:text-white/90";
const CANCEL =
  "cursor-pointer rounded-[6px] border border-[#d3d1c7] bg-paper px-3 py-1 text-[11px] font-medium text-[#1a1a1a] disabled:opacity-50 night:bg-white/[.04] night:text-white/65";
const FORM =
  "mb-3 rounded-[10px] border border-dashed border-black/15 bg-[#fafaf8] px-3.5 py-3 night:border-white/15 night:bg-white/[.02]";

/**
 * Content Studio → Tickets Reminder → Guest Page 的团名按钮（G190）。
 * 团的清单读后端 tix_tour_types（含停用的）；读不到（开关没放给我 403、接口没上线 404、其他错误）
 * 就照旧用写死的 15 个团，也不出「+ New tour」「✎ Edit tour」——这两个入口只给开关
 * `content_studio_tix_tour_types` 放行的人（默认 admin 以上，Annie 2026-10-26）。
 * 其余照抄现有团（Annie：「除了第一步的 create，其他都是没有必要的」）：新团的内容卡片和现有团一样。
 */
export function TixTourPicker({
  value,
  onChange,
  onUnauthorized,
}: {
  value: string;
  onChange: (key: string) => void;
  onUnauthorized: () => void;
}) {
  const [types, setTypes] = useState<TixTourType[] | null>(null);
  const [open, setOpen] = useState<"new" | "edit" | null>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const data = await fetchTixTourTypes(controller.signal);
        if (!controller.signal.aborted) setTypes(data.tour_types);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorizedRef.current();
        setTypes(null);
      }
    })();
    return () => controller.abort();
  }, []);

  const pills = types
    ? types.map((t) => ({
        key: t.key,
        label: SHORT_LABEL[t.key] ?? t.label,
        off: !t.is_active,
      }))
    : TIX_TOURS.map((t) => ({ key: t.key, label: t.label, off: false }));
  const current = types?.find((t) => t.key === value) ?? null;

  return (
    <>
      <div
        role="group"
        aria-label="Tour"
        className="mb-3.5 flex flex-wrap items-center gap-1.5"
      >
        {pills.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={value === t.key}
            onClick={() => {
              onChange(t.key);
              if (open === "edit") setOpen(null);
            }}
            className={cn(
              "cursor-pointer rounded-[20px] border px-[11px] py-1 text-[11px] font-medium transition-all",
              value === t.key
                ? "border-[#915a1e] bg-[#915a1e] text-white"
                : "border-black/15 bg-paper text-[#1a1a1a] hover:border-[#1a1a1a] hover:text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/75 night:hover:border-white/40 night:hover:text-white/90",
              t.off && "opacity-50",
            )}
          >
            {t.label}
            {t.off ? " · Off" : ""}
          </button>
        ))}
        {types ? (
          <>
            <button
              type="button"
              aria-expanded={open === "new"}
              onClick={() => setOpen((o) => (o === "new" ? null : "new"))}
              className="cursor-pointer rounded-[20px] border border-dashed border-[#aaa] bg-paper px-[11px] py-1 text-[11px] font-medium text-[#1a1a1a] hover:border-[#1a1a1a] night:bg-white/[.04] night:text-white/75"
            >
              + New tour
            </button>
            {current ? (
              <button
                type="button"
                aria-expanded={open === "edit"}
                onClick={() => setOpen((o) => (o === "edit" ? null : "edit"))}
                className="ml-auto cursor-pointer border-0 bg-transparent px-0.5 py-1 text-[11px] text-[#6B5E57] underline underline-offset-2 hover:text-[#1a1a1a] night:text-white/55 night:hover:text-white/90"
              >
                ✎ Edit tour
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {types && open === "new" ? (
        <NewTourForm
          onCancel={() => setOpen(null)}
          onCreated={(created) => {
            setTypes((ts) => [...(ts ?? []), created]);
            onChange(created.key);
            setOpen(null);
          }}
          onUnauthorized={onUnauthorizedRef.current}
        />
      ) : null}
      {current && open === "edit" ? (
        <EditTourForm
          key={current.id}
          tour={current}
          onCancel={() => setOpen(null)}
          onSaved={(updated) => {
            setTypes((ts) =>
              (ts ?? []).map((t) => (t.id === updated.id ? updated : t)),
            );
            setOpen(null);
          }}
          onUnauthorized={onUnauthorizedRef.current}
        />
      ) : null}
    </>
  );
}

function NewTourForm({
  onCreated,
  onCancel,
  onUnauthorized,
}: {
  onCreated: (t: TixTourType) => void;
  onCancel: () => void;
  onUnauthorized: () => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  // 没手动改过 Code 时，Code 跟着 Name 自动填。
  const [codeTouched, setCodeTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    const label = name.trim();
    const key = code.trim();
    if (!label) {
      setError("Type the tour name.");
      return;
    }
    if (!TIX_KEY_RE.test(key)) {
      setError(
        "Code: lowercase letters, numbers and _ only, start with a letter, 3–50 characters.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      onCreated(await createTixTourType({ key, label }));
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="New tour"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
      className={FORM}
    >
      <div className="mb-2 text-[11px] font-semibold text-[#1a1a1a] night:text-white/90">
        + New tour
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className={cn(FIELD, "flex-[2_1_200px]")}>
          <span className={FIELD_LABEL}>Name</span>
          <input
            type="text"
            value={name}
            disabled={busy}
            maxLength={200}
            placeholder="e.g. Upper Antelope Canyon – Chief Tsosie Tours"
            onChange={(e) => {
              setName(e.target.value);
              if (!codeTouched) setCode(suggestTixKey(e.target.value));
            }}
            className={INPUT}
          />
        </label>
        <label className={cn(FIELD, "flex-[1_1_170px]")}>
          <span className={FIELD_LABEL}>Code</span>
          <input
            type="text"
            value={code}
            disabled={busy}
            maxLength={50}
            placeholder="e.g. upper_antelope_tsosie"
            onChange={(e) => {
              setCodeTouched(true);
              setCode(e.target.value);
            }}
            className={cn(INPUT, "font-mono")}
          />
        </label>
        <button type="submit" disabled={busy} className={BUTTON}>
          {busy ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className={CANCEL}
        >
          Cancel
        </button>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-[1.5] text-[#a03a1a] night:text-red-300">
        The code can&apos;t be changed after the tour is created. Lowercase
        letters, numbers and _ only.
      </p>
      {error ? (
        <p
          role="alert"
          className="mt-1.5 text-[11px] text-[#dc2626] night:text-red-300"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

function EditTourForm({
  tour,
  onSaved,
  onCancel,
  onUnauthorized,
}: {
  tour: TixTourType;
  onSaved: (t: TixTourType) => void;
  onCancel: () => void;
  onUnauthorized: () => void;
}) {
  const [label, setLabel] = useState(tour.label);
  const [smsLabel, setSmsLabel] = useState(tour.sms_label);
  const [abbr, setAbbr] = useState(tour.abbr);
  const [active, setActive] = useState(tour.is_active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const patch: Parameters<typeof updateTixTourType>[1] = {};
    if (label.trim() !== tour.label) patch.label = label.trim();
    if (smsLabel.trim() !== tour.sms_label) patch.sms_label = smsLabel.trim();
    if (abbr.trim() !== tour.abbr) patch.abbr = abbr.trim();
    if (active !== tour.is_active) patch.is_active = active;
    if (!Object.keys(patch).length) {
      onCancel();
      return;
    }
    if (!label.trim()) {
      setError("The tour name can't be empty.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      onSaved(await updateTixTourType(tour.id, patch));
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Edit tour"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className={FORM}
    >
      <div className="mb-2 text-[11px] font-semibold text-[#1a1a1a] night:text-white/90">
        Edit tour ·{" "}
        <span className="font-mono font-normal text-[#8a847c] night:text-white/40">
          {tour.key}
        </span>{" "}
        <span className="font-normal text-[#8a847c] night:text-white/40">
          (code can&apos;t be changed)
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <label className={cn(FIELD, "flex-[2_1_200px]")}>
          <span className={FIELD_LABEL}>Name</span>
          <input
            type="text"
            value={label}
            disabled={busy}
            maxLength={200}
            placeholder="e.g. Upper Antelope Canyon – Chief Tsosie Tours"
            onChange={(e) => setLabel(e.target.value)}
            className={INPUT}
          />
        </label>
        <label className={cn(FIELD, "flex-[2_1_260px]")}>
          <span className={FIELD_LABEL}>SMS name</span>
          <input
            type="text"
            value={smsLabel}
            disabled={busy}
            maxLength={200}
            placeholder="e.g. Upper Antelope Canyon Tour"
            onChange={(e) => setSmsLabel(e.target.value)}
            className={INPUT}
          />
          <span className="max-w-[46ch] text-[10px] leading-[1.5] text-[#6B5E57] night:text-white/55">
            The tour name guests see on their ticket (SMS and confirmation
            page). Don&apos;t include the supplier name.
            <br />
            Name: Upper Antelope Canyon – Chief Tsosie Tours → guests see:
            Upper Antelope Canyon Tour
          </span>
        </label>
        <label className={cn(FIELD, "flex-[1_1_90px]")}>
          <span className={FIELD_LABEL}>Short name</span>
          <input
            type="text"
            value={abbr}
            disabled={busy}
            maxLength={20}
            placeholder="e.g. U-TC"
            onChange={(e) => setAbbr(e.target.value)}
            className={INPUT}
          />
        </label>
        <label className="flex items-center gap-1.5 self-center pt-3 text-[11px] whitespace-nowrap text-[#1a1a1a] night:text-white/75">
          <input
            type="checkbox"
            checked={active}
            disabled={busy}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active
        </label>
        <span className="flex gap-2 self-center pt-3">
          <button type="submit" disabled={busy} className={BUTTON}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={CANCEL}
          >
            Cancel
          </button>
        </span>
      </div>
      <p className={NOTE}>
        The tour shows in the Tour list on Tickets Reminder — Send once SMS
        name, Short name, Check-in location and Google Maps URL are filled in.
      </p>
      <p className={NOTE}>
        Untick Active to turn the tour off. It stays in old orders; there is no
        delete.
      </p>
      {error ? (
        <p
          role="alert"
          className="mt-1.5 text-[11px] text-[#dc2626] night:text-red-300"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
