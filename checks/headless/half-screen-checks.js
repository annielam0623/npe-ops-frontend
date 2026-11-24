// 半屏适配（Annie 2026-11-23「有个页面交互的问题，像这样半屏的显示，页面上的小窗也应该调整比例来适配，而不是显示需要移动滑条来看」；
// 5e 转「Staff Schedule 除了Q4选B，其他都按推荐」「动手」）：各页共用的宽度检查。
// 量页面上装表格 / 排班格子的那几块（overflow-x: auto）：要不要左右滑。
//   fitAt：这些宽度下不用滑；scrollAt：这些宽度下要滑（表格最窄 650px，窄于它照旧滑；手机照旧）。
//   narrowAt：{ width: 最宽多少 }——还要滑，但比原来的最窄宽度窄（内容本身放不下，不再硬撑 900–1080px）。
const SCROLLERS = `(() => { const main = document.querySelector('main') || document.body;
  return [...main.querySelectorAll('*')].filter((e) => { const s = getComputedStyle(e); return (s.overflowX === 'auto' || s.overflowX === 'scroll') && e.clientWidth > 150 && e.getBoundingClientRect().height > 40 && !!e.querySelector(SEL); }); })()`;

async function halfScreenChecks({ cdp, evaluate, openPage, check, sleep, url, sel, label, fitAt = [], scrollAt = [], narrowAt = [] }) {
  const measure = async () =>
    evaluate(`const SEL = ${JSON.stringify(sel)}; const list = ${SCROLLERS}; return { page: document.documentElement.scrollWidth > innerWidth + 1, blocks: list.map((e) => ({ client: e.clientWidth, scroll: e.scrollWidth })) };`);
  const at = async (width, mobile = false) => {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile });
    await openPage(url);
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`return !!document.querySelector('main ${sel}');`)) break;
      await sleep(250);
    }
    await sleep(600);
    return measure();
  };
  for (const w of fitAt) {
    const m = await at(w);
    check(`半屏适配 ${label} ${w}px：不用左右滑、整页也不晃`, m.blocks.length > 0 && m.blocks.every((b) => b.scroll <= b.client + 1) && !m.page, JSON.stringify(m));
  }
  for (const { width, max } of narrowAt) {
    const m = await at(width);
    check(`半屏适配 ${label} ${width}px：表格不再硬撑原来的最窄宽度（最宽 ${max}px），整页不晃`, m.blocks.length > 0 && m.blocks.every((b) => b.scroll <= max) && !m.page, JSON.stringify(m));
  }
  for (const w of scrollAt) {
    const mobile = w < 640;
    const m = await at(w, mobile);
    check(`半屏适配 ${label} ${w}px${mobile ? "（手机，照旧）" : "（表格窄于 650px）"}：表格里左右滑，整页不晃`, m.blocks.some((b) => b.scroll > b.client + 1) && !m.page, JSON.stringify(m));
  }
  await cdp("Emulation.clearDeviceMetricsOverride");
}

module.exports = { halfScreenChecks };
