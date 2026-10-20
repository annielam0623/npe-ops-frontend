import { CenteredPage } from "@/components/ui/centered-page";
import { NAV_MODULES, type NavModuleId } from "./nav-config";

/**
 * 还没有页面的侧栏条目的占位页（Annie 2026-10-11：Quotation 内容回头再想；Staff Schedule / Daily Operation Report
 * 做好之前也一样）。网址就是这一页将来的网址：页面做好后直接替换这里，员工已经钉的快捷方式不用重钉。
 */
export function ComingSoon({ id }: { id: NavModuleId }) {
  return (
    <CenteredPage as="main" className="text-[#f8fafc]">
      <h1 className="mb-2.5 text-[29px] leading-[1.12] font-bold tracking-[-.02em]">
        {NAV_MODULES[id].label}
      </h1>
      <div className="rounded-[18px] border border-dashed border-white/15 bg-white/[.032] px-[22px] py-10 text-center text-sm text-white/60">
        Coming soon.
      </div>
    </CenteredPage>
  );
}
