import type { ManifestAffiliate } from "@/types";

const TH =
  "border-b border-[#d1d5db] px-1.5 py-px text-left text-[10px] font-semibold text-[#9ca3af]";
const TD =
  "border-b border-[#e5e7eb] px-1.5 py-px align-middle text-[11px] text-[#6b7280]";

/**
 * Affiliate：被转单（Farm out）的客人，整个团一栏，放在所有车和 Not on a bus 之后（Annie 2026-10-18）。
 * 样子照 preview 第 6 版：只占整页一半、靠左，比主表小一号、灰色、行距紧；五列（订单号、接客时间、酒店、姓名、人数）；
 * 有 Affiliate 自己的小计行，没有任何总和（不和我们车上的人相加）；没有小字。
 * ⛔ 不出现合作公司名：栏标题只写 Affiliate，接口本来就不带 partner_name，这里也不渲染产品分节标题。
 */
export function AffiliateCard({ affiliate }: { affiliate: ManifestAffiliate }) {
  const guests = affiliate.sections.flatMap((s) => s.guests);
  if (guests.length === 0) return null;
  return (
    <section
      aria-label="Affiliate"
      data-affiliate
      className="mb-[22px] w-1/2 min-w-[440px] overflow-hidden rounded-[10px] bg-[#f3f4f6] px-2.5 pt-1.5 pb-2 font-[Arial,'Helvetica_Neue',Helvetica,sans-serif] text-[#6b7280] max-[900px]:w-full"
    >
      <div className="flex items-baseline gap-2.5 border-b border-[#d1d5db] px-1 py-0.5">
        <b className="text-[13px] font-bold text-[#6b7280]">Affiliate</b>
        <span
          data-affiliate-pax
          className="ml-auto text-[12px] font-semibold text-[#6b7280]"
        >
          {affiliate.totals.pax} pax
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="mt-0.5 w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>Order Number</th>
              <th className={TH}>Pick-up Time</th>
              <th className={TH}>Pick-up Location</th>
              <th className={TH}>Name</th>
              <th className={`${TH} text-center`}>#</th>
            </tr>
          </thead>
          <tbody>
            {guests.map((g) => (
              <tr key={g.id} data-affiliate-guest={g.order_number}>
                <td className={`${TD} font-['Courier_New',monospace] whitespace-nowrap`}>
                  {g.order_number}
                </td>
                <td className={`${TD} whitespace-nowrap`}>{g.pickup_time}</td>
                <td className={TD}>{g.pickup_location}</td>
                <td className={TD}>
                  {[g.first_name, g.last_name].filter(Boolean).join(" ") ||
                    g.name}
                </td>
                <td className={`${TD} text-center font-semibold`}>{g.pax}</td>
              </tr>
            ))}
            <tr data-affiliate-total>
              <td colSpan={4} className={`${TD} border-b-0 font-semibold`}>
                Affiliate total
              </td>
              <td className={`${TD} border-b-0 text-center font-semibold`}>
                {affiliate.totals.pax}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
