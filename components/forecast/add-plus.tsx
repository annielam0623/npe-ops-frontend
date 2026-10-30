/**
 * 能编辑的空格子里一直显示的绿色「+」（Annie 2026-10-28「把能edit里的-都改成绿色的+」，
 * preview https://claude.ai/artifact/X9EXZjpgbKfPhxzeKR7c9c 第 2 版）。过去的日子、只读的空格照旧灰「—」。
 */
export function AddPlus() {
  return (
    <div
      data-add-plus
      aria-hidden="true"
      className="text-[15px] leading-none font-bold text-[#4ade80]"
    >
      +
    </div>
  );
}
