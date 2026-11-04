"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** Relay list 的地址（Annie：「排完relay并保存了以后，应该加一个按键显示这些relay的list」）；car = 只看这一台（车头 Print）。 */
export function relayListUrl(date: string, car: number | null): string {
  return `/dispatch/relay-list?date=${date}${car ? `&car=${car}` : ""}`;
}

/**
 * 打开 Relay list（新标签）：有没存的改动先问要不要存（Relay list 显示的是已保存的排车）。
 * Assign 顶上统计条旁的 Relay List 键（置顶 70，Annie 2026-11-03「动手」）和 Send 页车头的 Print 共用。
 * 返回 open(car) 和要放进页面的确认框（没开时是 null）。
 */
export function useRelayListOpener({
  date,
  dirty,
  onSave,
}: {
  date: string;
  dirty: boolean;
  /** 存这一天；存好返回 true。没有 = 只读，不问、直接打开已保存的。 */
  onSave?: () => Promise<boolean>;
}) {
  /** undefined = 没开；null = 整份；数字 = 只看这台车。 */
  const [ask, setAsk] = useState<number | null | undefined>(undefined);

  function open(car: number | null) {
    if (dirty && onSave) {
      setAsk(car);
      return;
    }
    window.open(relayListUrl(date, car), "_blank", "noopener,noreferrer");
  }

  const dialog =
    ask !== undefined && onSave ? (
      <ConfirmDialog
        title="Save before opening the Relay list?"
        confirmLabel="Save and open"
        busyLabel="Saving…"
        onClose={() => setAsk(undefined)}
        onConfirm={async () => {
          // 先在点击里开好新标签（存完再开会被浏览器当成弹窗拦掉），存好了再把地址填进去。
          const tab = window.open("about:blank", "_blank");
          const ok = await onSave();
          if (!ok) {
            tab?.close();
            return {
              status: "error",
              message:
                "Could not save. Fix the problems shown on Assign, then try again.",
            };
          }
          const url = relayListUrl(date, ask);
          if (tab) {
            tab.opener = null;
            tab.location.href = url;
          } else window.open(url, "_blank", "noopener,noreferrer");
          setAsk(undefined);
          return { status: "ok" };
        }}
      >
        <p>
          The Relay list shows the saved schedule. You have changes on Assign
          that are not saved yet.
        </p>
      </ConfirmDialog>
    ) : null;

  return { open, dialog };
}
