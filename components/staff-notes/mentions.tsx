"use client";

import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  fetchMentionDirectory,
  type MentionDirectory,
  type StaffNoteMention,
  type StaffNoteTeamMention,
} from "@/lib/staff-notes-api";
import { cn } from "@/lib/utils";

/** 已经放进正文的 @（按名字认：正文里还有「@名字」才算数）。 */
export type PickedMention =
  | { kind: "person"; id: number; name: string }
  | { kind: "team"; id: number; name: string };

/**
 * @ 名单：一个页面只读一次（几个输入框共用）。读不到（旧后端没有这个接口 / 断网）⇒ null，@ 只是普通文字、不出下拉。
 */
let directoryPromise: Promise<MentionDirectory | null> | null = null;
export function useMentionDirectory(
  enabled = true,
): MentionDirectory | null {
  const [dir, setDir] = useState<MentionDirectory | null>(null);
  useEffect(() => {
    // partner 只读（Annie 2026-11-22「partner 都能看」）：不出 @ 名单，也不去读（后端 require_staff 会 403）。
    if (!enabled) return;
    let alive = true;
    directoryPromise ??= fetchMentionDirectory().then(
      (d) => d,
      () => {
        // 下次打开再试。
        directoryPromise = null;
        return null;
      },
    );
    void directoryPromise.then((d) => {
      if (alive) setDir(d);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return dir;
}

/** 正文里还在的 @（删掉了「@名字」的不算），分成 person / team 两组 id。 */
export function effectiveMentions(
  text: string,
  picked: readonly PickedMention[],
): { mentions: number[]; mention_team_ids: number[] } {
  const mentions: number[] = [];
  const teams: number[] = [];
  for (const m of picked) {
    if (!text.includes(`@${m.name}`)) continue;
    const list = m.kind === "person" ? mentions : teams;
    if (!list.includes(m.id)) list.push(m.id);
  }
  return { mentions, mention_team_ids: teams };
}

export function hasMention(
  text: string,
  picked: readonly PickedMention[],
): boolean {
  const m = effectiveMentions(text, picked);
  return m.mentions.length + m.mention_team_ids.length > 0;
}

/** 光标前正在打的「@xxx」：返回 xxx 和 @ 的位置；不在打 @ ⇒ null。 */
function activeQuery(
  text: string,
  caret: number,
): { query: string; at: number } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
  if (!m) return null;
  return { query: m[2], at: before.length - m[2].length - 1 };
}

type Option =
  | { kind: "team"; id: number; name: string; hint: string }
  | { kind: "person"; id: number; name: string; hint: string };

const MAX_PEOPLE = 30;

function optionsFor(dir: MentionDirectory, query: string): Option[] {
  const q = query.toLowerCase();
  const teams: Option[] = dir.teams
    .filter((t) => t.name.toLowerCase().includes(q))
    .map((t) => ({
      kind: "team",
      id: t.id,
      name: t.name,
      hint: `${t.member_count} ${t.member_count === 1 ? "person" : "people"}`,
    }));
  // 后端已经排好（在线的在前，再按名字；Q1 A）。
  const people: Option[] = dir.people
    .filter((p) => p.display_name.toLowerCase().includes(q))
    .slice(0, MAX_PEOPLE)
    .map((p) => ({
      kind: "person",
      id: p.id,
      name: p.display_name,
      hint: [p.teams?.join(", "), p.online ? "online" : ""]
        .filter(Boolean)
        .join(" · "),
    }));
  return [...teams, ...people];
}

/**
 * 写 ★ Note 的输入框：打 @ 出下拉（Teams 一组、People 一组），↑↓ 选、Enter / Tab / 点一下放进去，Esc 收起。
 * 选中的写成「@名字 」放进正文，同时记在 picked 里；存的时候用 effectiveMentions 取还在正文里的。
 */
export function MentionTextarea({
  id,
  value,
  onChange,
  picked,
  onPickedChange,
  directory,
  placeholder,
  disabled,
  dark = false,
  className,
  rows = 3,
  onKeyDown,
  ariaLabel,
  textareaRef,
  style,
}: {
  id?: string;
  value: string;
  onChange: (text: string) => void;
  picked: readonly PickedMention[];
  onPickedChange: (next: PickedMention[]) => void;
  directory: MentionDirectory | null;
  placeholder?: string;
  disabled?: boolean;
  /** 深色底（Morning 对话框）。 */
  dark?: boolean;
  className?: string;
  rows?: number;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  ariaLabel?: string;
  /** 调用方要拿到输入框（例如自动长高）。 */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  style?: CSSProperties;
}) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? ownRef;
  const [caret, setCaret] = useState(0);
  const [closed, setClosed] = useState(false);
  const [active, setActive] = useState(0);
  const query = directory && !closed ? activeQuery(value, caret) : null;
  const options = useMemo(
    () => (query && directory ? optionsFor(directory, query.query) : []),
    [query, directory],
  );
  const open = !!query;
  const idx = Math.min(active, Math.max(0, options.length - 1));

  function pick(o: Option) {
    if (!query) return;
    const insert = `@${o.name} `;
    const next = value.slice(0, query.at) + insert + value.slice(caret);
    onChange(next);
    if (!picked.some((p) => p.kind === o.kind && p.id === o.id))
      onPickedChange([...picked, { kind: o.kind, id: o.id, name: o.name }]);
    const pos = query.at + insert.length;
    setCaret(pos);
    setActive(0);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  }

  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open && options.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((idx + 1) % options.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((idx - 1 + options.length) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(options[idx]);
        return;
      }
    }
    if (open && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setClosed(true);
      return;
    }
    onKeyDown?.(e);
  }

  const teamOpts = options.filter((o) => o.kind === "team");
  const peopleOpts = options.filter((o) => o.kind === "person");
  const optionClass = (o: Option) =>
    cn(
      "flex w-full cursor-pointer items-baseline justify-between gap-2 px-2.5 py-1.5 text-left text-[12.5px]",
      dark ? "text-[#e0eaf6]" : "text-[#1a1a1a]",
      options[idx] === o && (dark ? "bg-white/10" : "bg-[#eef4ff]"),
    );
  const groupClass = cn(
    "px-2.5 py-1 text-[10.5px] font-bold tracking-[.05em] uppercase",
    dark ? "bg-white/[.04] text-[#8aa9c8]" : "bg-[#f6f7f9] text-[#6b6f76]",
  );
  const renderOption = (o: Option) => (
    <button
      key={`${o.kind}-${o.id}`}
      type="button"
      role="option"
      aria-selected={options[idx] === o}
      data-mention-option={o.kind}
      onMouseDown={(e) => {
        // 不让输入框失焦。
        e.preventDefault();
        pick(o);
      }}
      className={optionClass(o)}
    >
      <span className="min-w-0 truncate">
        {o.kind === "team" ? (
          <MentionChip kind="team" dark={dark}>{`@${o.name}`}</MentionChip>
        ) : (
          o.name
        )}
      </span>
      {o.hint ? (
        <small
          className={cn(
            "shrink-0 text-[11px]",
            dark ? "text-[#8aa9c8]" : "text-[#6b6f76]",
          )}
        >
          {o.hint}
        </small>
      ) : null}
    </button>
  );

  return (
    <div className="relative">
      <textarea
        ref={ref}
        id={id}
        aria-label={ariaLabel}
        value={value}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setClosed(false);
        }}
        onSelect={(e) =>
          setCaret(
            (e.target as HTMLTextAreaElement).selectionStart ?? value.length,
          )
        }
        onBlur={() => setClosed(true)}
        onFocus={() => setClosed(false)}
        onKeyDown={keyDown}
        style={style}
        className={className}
      />
      {open ? (
        <div
          role="listbox"
          aria-label="Mention a teammate or a team"
          data-mention-list
          className={cn(
            "absolute inset-x-0 top-full z-50 mt-1 max-h-[220px] overflow-y-auto rounded-lg border shadow-[0_6px_18px_rgba(0,0,0,.18)] max-sm:max-h-[170px]",
            dark ? "border-white/15 bg-[#0f2035]" : "border-[#cfd3d8] bg-white",
          )}
        >
          {options.length === 0 ? (
            <div
              data-mention-empty
              className={cn(
                "px-2.5 py-2 text-[12px]",
                dark ? "text-[#8aa9c8]" : "text-[#6b6f76]",
              )}
            >
              No teammate or team matches &ldquo;{query.query}&rdquo;
            </div>
          ) : (
            <>
              {teamOpts.length ? (
                <>
                  <div className={groupClass}>Teams</div>
                  {teamOpts.map(renderOption)}
                </>
              ) : null}
              {peopleOpts.length ? (
                <>
                  <div className={groupClass}>People</div>
                  {peopleOpts.map(renderOption)}
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** 正文里的 @：人 = 蓝底，team = 白底蓝框（preview 第 2 节）。 */
export function MentionChip({
  kind,
  dark = false,
  children,
}: {
  kind: "person" | "team";
  dark?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      data-mention={kind}
      className={cn(
        "rounded-[3px] px-[3px] font-semibold",
        kind === "person"
          ? dark
            ? "bg-[#1e3a5f] text-[#93c5fd]"
            : "bg-[#dbeafe] text-[#1d4ed8]"
          : dark
            ? "border border-[#93c5fd] text-[#93c5fd]"
            : "border border-[#1d4ed8] bg-white text-[#1d4ed8]",
      )}
    >
      {children}
    </span>
  );
}

/** 一条 ★ Note 的正文：认得出的「@名字」高亮，其余原样（纯文本，不当 HTML）。 */
export function NoteText({
  text,
  mentions,
  teams,
  dark = false,
}: {
  text: string;
  mentions?: readonly StaffNoteMention[];
  teams?: readonly StaffNoteTeamMention[];
  dark?: boolean;
}) {
  const names: { name: string; kind: "person" | "team" }[] = [
    ...(teams ?? []).map((t) => ({ name: t.name, kind: "team" as const })),
    ...(mentions ?? []).map((m) => ({
      name: m.name,
      kind: "person" as const,
    })),
  ]
    .filter((n) => n.name)
    // 长名字先认（「ZZ Test Max」不要被「ZZ Test」截走）。
    .sort((a, b) => b.name.length - a.name.length);
  if (!names.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    let best: { at: number; name: string; kind: "person" | "team" } | null =
      null;
    for (const n of names) {
      const at = rest.indexOf(`@${n.name}`);
      if (at >= 0 && (!best || at < best.at)) best = { at, ...n };
    }
    if (!best) {
      parts.push(rest);
      break;
    }
    if (best.at) parts.push(rest.slice(0, best.at));
    parts.push(
      <MentionChip key={key++} kind={best.kind} dark={dark}>
        {`@${best.name}`}
      </MentionChip>,
    );
    rest = rest.slice(best.at + best.name.length + 1);
  }
  return <>{parts}</>;
}
