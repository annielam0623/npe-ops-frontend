"use client";

import { type DragEvent, useState } from "react";

import { SoonTag } from "@/components/nav/app-frame";
import {
  NAV_MODULES,
  type NavModuleId,
  isNavModuleId,
} from "@/components/nav/nav-config";
import { NAV_DRAG_TYPE, useNav } from "@/components/nav/nav-context";
import { PageLink } from "@/components/ui/page-link";
import { cn } from "@/lib/utils";

/** 拖进来的条目 id（侧栏条目、框里的块都带这个类型）。 */
function draggedId(e: DragEvent): NavModuleId | null {
  const id = e.dataTransfer.getData(NAV_DRAG_TYPE);
  return isNavModuleId(id) ? id : null;
}
const carriesModule = (e: DragEvent) =>
  e.dataTransfer.types.includes(NAV_DRAG_TYPE);

/**
 * My shortcuts（dashboard 改版阶段一，设计 §2.3）：虚线框。从侧栏拖进来或点侧栏的钉子加；框里拖动排序；× 移除；
 * Reset to default 恢复默认（默认值是 Settings → Navigation 里配的）。每次改动立刻存服务端，存不上退回改动前并写原因。
 */
export function ShortcutsSection() {
  const {
    shortcuts,
    labels,
    saving,
    saveError,
    setShortcuts,
    resetShortcuts,
    retrySave,
  } = useNav();
  const [over, setOver] = useState(false);
  const list = shortcuts ?? [];

  /** 放到 beforeId 前面（没有就放最后）；已经在框里的就是挪位置。 */
  const place = (id: NavModuleId, beforeId: NavModuleId | null) => {
    const rest = list.filter((x) => x !== id);
    const i = beforeId ? rest.indexOf(beforeId) : -1;
    if (i < 0) rest.push(id);
    else rest.splice(i, 0, id);
    if (rest.join() !== list.join()) setShortcuts(rest);
  };

  const ready = shortcuts !== null;

  return (
    <section
      aria-label="My shortcuts"
      onDragOver={(e) => {
        if (!ready || saving || !carriesModule(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        const id = draggedId(e);
        if (!id) return;
        e.preventDefault();
        place(id, null);
      }}
      className={cn(
        "mb-[18px] rounded-[16px] border-[1.5px] border-dashed p-4 transition-colors",
        over
          ? "border-[#38bdf8]/70 bg-[#38bdf8]/[.06]"
          : "border-white/15 bg-white/[.02]",
      )}
    >
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="shrink-0 text-[15px] font-semibold">My shortcuts</h2>
        {/* 用法说明和标题同一行、不换行（Annie 2026-10-11）；更窄时末尾省略。 */}
        <span className="min-w-0 flex-1 truncate text-xs text-white/60">
          Drag a page here from the ☰ menu, or click its pin · drag tiles to
          reorder · × to remove
        </span>
        <button
          type="button"
          disabled={!ready || saving}
          onClick={resetShortcuts}
          className="shrink-0 px-0.5 py-1 text-xs font-semibold text-[#38bdf8] hover:text-[#7dd3fc] disabled:opacity-50"
        >
          Reset to default
        </button>
      </div>

      {saveError ? (
        <p
          role="alert"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-[#f87171]/40 bg-[#f87171]/[.08] px-3 py-2 text-[12.5px] text-[#fca5a5]"
        >
          <span>
            Couldn&rsquo;t save your shortcuts: {saveError} They are back to how
            they were.
          </span>
          <button
            type="button"
            disabled={saving}
            onClick={retrySave}
            className="rounded-md border border-white/20 px-2 py-0.5 text-xs font-semibold text-white hover:bg-white/10"
          >
            Try again
          </button>
        </p>
      ) : null}

      {!ready ? (
        <p className="px-1 py-2.5 text-[13px] text-white/60">Loading…</p>
      ) : list.length === 0 ? (
        <p className="px-1 py-2.5 text-[13px] text-white/60">
          No shortcuts yet — drag any module from the menu on the left and drop
          it here.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2.5" aria-busy={saving}>
          {list.map((id) => {
            const m = NAV_MODULES[id];
            return (
              <li
                key={id}
                data-shortcut={id}
                draggable={!saving}
                onDragStart={(e) => {
                  e.dataTransfer.setData(NAV_DRAG_TYPE, id);
                  e.dataTransfer.setData("text/plain", labels[id]);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (saving || !carriesModule(e)) return;
                  e.preventDefault();
                  setOver(true);
                }}
                onDrop={(e) => {
                  e.stopPropagation();
                  setOver(false);
                  const dragged = draggedId(e);
                  if (!dragged) return;
                  e.preventDefault();
                  if (dragged !== id) place(dragged, id);
                }}
                className="flex h-[46px] cursor-grab items-center rounded-[11px] border border-white/10 bg-white/[.04] transition hover:border-white/20 hover:bg-white/[.07] active:cursor-grabbing"
              >
                <PageLink
                  href={m.href!}
                  draggable={false}
                  className="flex h-full items-center gap-[9px] pr-1.5 pl-3.5 text-[13.5px] font-semibold text-white no-underline"
                >
                  <span
                    aria-hidden
                    className="size-[7px] shrink-0 rounded-full"
                    style={{ background: m.dot ?? "rgba(255,255,255,.4)" }}
                  />
                  {labels[id]}
                  {m.upcoming ? <SoonTag /> : null}
                </PageLink>
                <button
                  type="button"
                  aria-label={`Remove ${labels[id]} from shortcuts`}
                  disabled={saving}
                  onClick={() => setShortcuts(list.filter((x) => x !== id))}
                  className="flex h-full w-8 items-center justify-center text-sm text-white/50 hover:text-white disabled:cursor-wait"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
