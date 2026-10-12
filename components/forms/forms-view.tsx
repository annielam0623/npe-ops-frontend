import { PageLink } from "@/components/ui/page-link";

/**
 * Forms（dashboard 改版，Annie 2026-10-11）：Work Sheet / Guide Sheet 这类要填、要打印的单子集中在这一页进。
 * 两张单子本身不动、网址不变；以后有同类的单子也加在这里。
 */
const FORMS: readonly { title: string; href: string; desc: string }[] = [
  {
    title: "Work Sheet",
    href: "/dispatch/work-sheet",
    desc: "Driver work ticket — fill in, save a file, print.",
  },
  {
    title: "Guide Sheet",
    href: "/dispatch/guide-sheet",
    desc: "Guide assignment sheet — fill in, save a file, print.",
  },
];

export function FormsView() {
  return (
    <main className="mx-auto max-w-[1400px] text-[#f8fafc]">
      <h1 className="mb-2.5 text-[29px] leading-[1.12] font-bold tracking-[-.02em]">
        Forms
      </h1>
      <p className="mb-5 text-[13.5px] text-[#94a3b8]">
        Pick the form you need.
      </p>
      <div className="grid grid-cols-1 gap-3.5 min-[1100px]:grid-cols-3 sm:grid-cols-2">
        {FORMS.map((f) => (
          <PageLink
            key={f.href}
            href={f.href}
            className="group flex flex-col gap-1.5 rounded-[18px] border border-white/10 bg-white/[.032] p-[22px] no-underline transition hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[.06]"
          >
            <span className="flex items-center justify-between text-base font-bold text-white">
              {f.title}
              <span
                aria-hidden
                className="text-white/40 group-hover:text-white"
              >
                →
              </span>
            </span>
            <span className="text-[13px] text-white/60">{f.desc}</span>
          </PageLink>
        ))}
      </div>
    </main>
  );
}
