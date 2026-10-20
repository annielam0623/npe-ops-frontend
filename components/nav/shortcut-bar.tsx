"use client";

import { useRouter } from "next/navigation";
import { type DragEvent, useState } from "react";

import { SoonTag } from "@/components/nav/app-frame";
import { hasInAppHistory } from "@/components/nav/in-app-history";
import {
  NAV_MODULES,
  type NavModuleId,
  TRACKING_WIDGET_ID,
  isNavModuleId,
} from "@/components/nav/nav-config";
import { NAV_DRAG_TYPE, useNav } from "@/components/nav/nav-context";
import { TrackingWidget } from "@/components/nav/tracking-widget";
import { PageLink } from "@/components/ui/page-link";
import { cn } from "@/lib/utils";

/** 拖进来的条目 id（侧栏条目、条上的块都带这个类型）。 */
function draggedId(e: DragEvent): NavModuleId | null {
  const id = e.dataTransfer.getData(NAV_DRAG_TYPE);
  return isNavModuleId(id) ? id : null;
}
const carriesModule = (e: DragEvent) =>
  e.dataTransfer.types.includes(NAV_DRAG_TYPE);

const isHere = (href: string, pathname: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/**
 * 顶部的 My shortcuts 条（Annie 2026-10-14）：dashboard 上照旧是 My shortcuts 框（shortcuts-section.tsx），
 * 进了别的页面，同一份 shortcuts 变成顶栏下面的导航条、跟着顶栏钉在上面，最左边 ← Back。
 * 第一个永远是 Dashboard（不能移除、不能拖走）；后面是 staff 自己钉的页：从侧栏拖进来或点侧栏的钉子加，条上拖动排序，× 移除，
 * Reset to default 恢复默认（Settings → Navigation 里配的）。改动立刻存服务端，存不上退回改动前并写原因（同原来的框）。
 */
export function ShortcutBar({ pathname }: { pathname: string }) {
  const {
    shortcuts,
    labels,
    saving,
    saveError,
    setShortcuts,
    resetShortcuts,
    retrySave,
  } = useNav();
  const router = useRouter();
  const [over, setOver] = useState(false);
  const list = shortcuts ?? [];
  // Dashboard 固定在最前面，钉过的那一份不再重复显示（存的列表不动）。
  const shown = list.filter((id) => id !== "dashboard");
  const ready = shortcuts !== null;

  /** 放到 beforeId 前面（没有就放最后）；已经在条上的就是挪位置。 */
  const place = (id: NavModuleId, beforeId: NavModuleId | null) => {
    if (id === "dashboard") return;
    const rest = list.filter((x) => x !== id);
    const i = beforeId ? rest.indexOf(beforeId) : -1;
    if (i < 0) rest.push(id);
    else rest.splice(i, 0, id);
    if (rest.join() !== list.join()) setShortcuts(rest);
  };

  const dash = NAV_MODULES.dashboard;
  const chip = "flex h-8 shrink-0 items-center rounded-[9px] border transition";
  const chipLink =
    "flex h-full items-center gap-2 px-3 text-[12.5px] font-semibold text-white no-underline";

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
        "flex min-h-12 items-center gap-2 border-b px-4 py-2 transition-colors sm:px-7",
        over
          ? "border-[#38bdf8]/50 bg-[#38bdf8]/[.08]"
          : "border-white/[.06] bg-[rgba(5,11,19,.56)]",
      )}
    >
      {/* 每页都有「← Back」（Annie 2026-10-14）：站内点过来的退回上一页；直接打开 / 刷新过的回 Dashboard。 */}
      <button
        type="button"
        onClick={() => {
          if (hasInAppHistory()) router.back();
          else router.push("/dashboard");
        }}
        className="flex h-8 shrink-0 items-center rounded-[9px] border border-white/15 px-3 text-[12.5px] font-semibold text-white hover:bg-white/[.07]"
      >
        ← Back
      </button>
      <span aria-hidden className="h-5 w-px shrink-0 bg-white/15" />
      <ul
        className="flex min-w-0 flex-1 [scrollbar-width:none] items-center gap-2 overflow-x-auto"
        aria-busy={saving}
      >
        <li
          data-shortcut="dashboard"
          className={cn(
            chip,
            isHere(dash.href!, pathname)
              ? "border-[#38bdf8]/60 bg-[#38bdf8]/[.12]"
              : "border-white/10 bg-white/[.04] hover:border-white/20 hover:bg-white/[.07]",
          )}
        >
          <PageLink href={dash.href!} draggable={false} className={chipLink}>
            {labels.dashboard}
          </PageLink>
        </li>
        {shown.map((id) => {
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
              className={cn(
                chip,
                "cursor-grab active:cursor-grabbing",
                m.href && isHere(m.href, pathname)
                  ? "border-[#38bdf8]/60 bg-[#38bdf8]/[.12]"
                  : "border-white/10 bg-white/[.04] hover:border-white/20 hover:bg-white/[.07]",
              )}
            >
              {id === TRACKING_WIDGET_ID ? (
                <TrackingWidget label={labels[id]} compact />
              ) : (
                <PageLink
                  href={m.href!}
                  draggable={false}
                  className={cn(chipLink, "pr-1")}
                >
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: m.dot ?? "rgba(255,255,255,.4)" }}
                  />
                  {labels[id]}
                  {m.upcoming ? <SoonTag /> : null}
                </PageLink>
              )}
              <button
                type="button"
                aria-label={`Remove ${labels[id]} from shortcuts`}
                disabled={saving}
                onClick={() => setShortcuts(list.filter((x) => x !== id))}
                className="flex h-full w-6 items-center justify-center text-xs text-white/45 hover:text-white disabled:cursor-wait"
              >
                ×
              </button>
            </li>
          );
        })}
        {ready && shown.length === 0 ? (
          <li className="shrink-0 px-1 text-xs text-white/50">
            Drag a page here from the ☰ menu, or click its pin
          </li>
        ) : null}
      </ul>
      {saveError ? (
        <span
          role="alert"
          className="flex shrink-0 items-center gap-2 text-xs text-[#fca5a5]"
        >
          Couldn&rsquo;t save ({saveError.replace(/\.$/, "")})
          <button
            type="button"
            disabled={saving}
            onClick={retrySave}
            className="rounded-md border border-white/20 px-2 py-0.5 font-semibold text-white hover:bg-white/10"
          >
            Try again
          </button>
        </span>
      ) : null}
      <button
        type="button"
        disabled={!ready || saving}
        onClick={resetShortcuts}
        className="shrink-0 px-0.5 py-1 text-xs font-semibold text-white/50 hover:text-white disabled:opacity-50"
      >
        Reset
      </button>
    </section>
  );
}
