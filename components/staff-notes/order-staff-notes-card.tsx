"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePhoneInfo } from "@/components/ui/phone";
import { isStatus } from "@/lib/api-errors";
import {
  fetchOrderStaffNotes,
  newestFirst,
  type StaffNote,
  type StaffNoteProduct,
} from "@/lib/staff-notes-api";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import type { OrderDetail } from "@/types";

import { useMentionDirectory } from "./mentions";
import { StaffNoteComposer, StaffNoteList } from "./staff-notes";

/**
 * 这单的产品（多产品时写 ★ Note 要选）：GET /api/staff-notes 回的 products；还没读到 / 读不到 ⇒ null，
 * 这时不出「For」框，product_code 传 null（单产品后端自动带；多产品后端 400，红字照原话）。
 */
export function useOrderNoteProducts(
  orderNumber: string,
  onUnauthorized: () => void,
): StaffNoteProduct[] | null {
  const [products, setProducts] = useState<StaffNoteProduct[] | null>(null);
  // 调用方每次渲染给的可能是新函数：只在单号变了时重读。
  const unauthorized = useRef(onUnauthorized);
  useEffect(() => {
    unauthorized.current = onUnauthorized;
  });
  useEffect(() => {
    const ac = new AbortController();
    setProducts(null);
    fetchOrderStaffNotes(orderNumber, ac.signal).then(
      (r) => {
        if (!ac.signal.aborted) setProducts(r.products ?? []);
      },
      (e) => {
        if (!ac.signal.aborted && isStatus(e, 401)) unauthorized.current();
      },
    );
    return () => ac.abort();
  }, [orderNumber]);
  return products;
}

/**
 * Order details 的「★ Notes」卡（Annie Q4 A 能写；Q5 B 卡里只放 ★ Note，Chat history 只放客人对话）：
 * 第 3 件的输入框 + 这单全部 ★ Note（最新在上、每条带产品标签；整单的写「Order note」）。partner 不出（调用方挡）。
 */
export function OrderStaffNotesCard({
  order,
  notes: initial,
  onUnauthorized,
}: {
  order: OrderDetail;
  notes: readonly StaffNote[];
  onUnauthorized: () => void;
}) {
  const directory = useMentionDirectory();
  const info = usePhoneInfo("About ★ Notes");
  const products = useOrderNoteProducts(order.order_number, onUnauthorized);
  const [added, setAdded] = useState<StaffNote[]>([]);
  const [dirty, setDirty] = useState(false);
  const notes = useMemo(() => {
    const ids = new Set(initial.map((n) => n.id));
    return newestFirst([...initial, ...added.filter((n) => !ids.has(n.id))]);
  }, [initial, added]);
  const onDirty = useCallback((d: boolean) => setDirty(d), []);
  useLeaveGuard(
    dirty,
    "A ★ Note you typed is not added yet. Leave without adding it?",
  );
  return (
    <section
      aria-label="★ Notes"
      data-staff-notes-card
      className="rounded-[10px] border-[0.5px] border-black/10 bg-paper px-4 py-3.5 night:border-white/10 night:bg-white/[.04]"
    >
      <h3 className="mb-2.5 flex items-center text-[11px] font-semibold tracking-[0.6px] text-[#1d4ed8] uppercase night:text-[#93c5fd]">
        ★ Notes
        {info.button}
      </h3>
      <p
        className={`mb-1.5 text-[11px] text-[#6b6f76] night:text-white/45 ${info.hide}`}
      >
        Internal only. Guests and partners can&apos;t see these.
      </p>
      <StaffNoteComposer
        orderNumber={order.order_number}
        products={products ?? []}
        source="order_details"
        directory={directory}
        onAdded={(n) => setAdded((a) => [n, ...a])}
        onDirty={onDirty}
        onUnauthorized={onUnauthorized}
      />
      {notes.length ? (
        <div className="mt-2.5">
          <StaffNoteList notes={notes} showProduct />
        </div>
      ) : (
        <div
          data-staff-notes-empty
          className="mt-2.5 text-[12px] text-[#6b6f76] night:text-white/45"
        >
          No ★ Notes yet.
        </div>
      )}
    </section>
  );
}
