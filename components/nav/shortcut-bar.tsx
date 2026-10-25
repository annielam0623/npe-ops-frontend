"use client";

import { useRouter } from "next/navigation";

import { hasInAppHistory } from "@/components/nav/in-app-history";

import { ShortcutStrip } from "./shortcut-strip";

/**
 * 顶部的 My shortcuts 条（Annie 2026-10-14）：dashboard 上是页里的 My shortcuts 一行卡片（dashboard/shortcuts-section.tsx），
 * 进了别的页面，同一份 shortcuts 变成顶栏下面的导航条、跟着顶栏钉在上面，最左边 ← Back。
 * 条本身（药丸、拖拽、×、「…」溢出菜单、缩小）在 shortcut-strip.tsx，这里只加 ← Back。
 * 第一个永远是 Dashboard（不能移除、不能拖走）；后面是 staff 自己钉的页：从侧栏拖进来或点侧栏的钉子加，条上拖动排序，× 移除，
 * 「…」里有 + 添加和 Reset to default。改动立刻存服务端，存不上退回改动前并写原因。
 */
export function ShortcutBar({ pathname }: { pathname: string }) {
  const router = useRouter();
  return (
    <ShortcutStrip
      variant="bar"
      pathname={pathname}
      leading={
        <>
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
        </>
      }
    />
  );
}
