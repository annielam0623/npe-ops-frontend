import Link from "next/link";

import type { ForecastUnassignedProduct } from "@/types";

/**
 * 这窗口里有订单、但没分到任何路线组的产品（后端待办 A17）——前端只负责显示，提示去 Products 分组。
 */
export function UnassignedBanner({
  products,
}: {
  products: ForecastUnassignedProduct[];
}) {
  if (!products.length) return null;

  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100"
    >
      <p className="font-semibold">
        {products.length} product{products.length === 1 ? "" : "s"} with
        bookings in this window are not grouped to any route.
      </p>
      <p className="mt-1 text-amber-100/80">
        They are not counted in any block below. Fix the grouping on{" "}
        <Link href="/settings/products" className="underline hover:text-amber-50">
          Settings → Products
        </Link>
        .
      </p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-amber-100/80">
        {products.map((p) => (
          <li key={p.product_code}>
            {p.product_name} — {p.pax.toLocaleString()} pax
          </li>
        ))}
      </ul>
    </div>
  );
}
