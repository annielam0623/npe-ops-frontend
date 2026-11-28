// 浅色底板字色检查（Annie 2026-11-27「检查所有浅色底板，这个是staff schedule的rules」）：
// 页面里跑 `$lowContrast(rootSelector, min = 4.5)`，返回 root 里「直接坐在浅色底上的字」中对比度低于 min 的那些
// （[{text, color, bg, ratio}]，空数组 = 都过）。
// - 背景 = 往上找到第一层不透明底为止，把半透明的底一层层叠上去；字的透明度（含祖先 opacity）也叠上。
// - 只看浅色底（亮度 ≥ 0.5）上的字：蓝色提交键、灰绿 Add 键、开关这些自带深 / 彩色底的不算（颜色是 Annie 定的）。
// - 不看藏起来的、disabled 的。
const CONTRAST_HELPERS = `
(() => {
  // Tailwind v4 的色板色（text-red-300、bg-orange-600…）算出来是 oklch(…)：画到 1px canvas 上读回 RGB。
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const parse = (c) => {
    if (!c || c === "transparent") return null;
    const m = /^rgba?\\(([^)]+)\\)$/.exec(c);
    if (m) {
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    const a = /\\/\\s*([0-9.]+%?)\\s*\\)$/.exec(c);
    const al = a ? (a[1].endsWith("%") ? parseFloat(a[1]) / 100 : Number(a[1])) : 1;
    if (al === 0) return null;
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = c;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    // getImageData 给的是没预乘的 RGB，直接用。
    return d[3] ? [d[0], d[1], d[2], al] : null;
  };
  const over = (t, b) => [0, 1, 2].map((i) => t[i] * t[3] + b[i] * (1 - t[3])).concat(1);
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const b = parse(getComputedStyle(e).backgroundColor);
      if (b && b[3] > 0) { stack.push(b); if (b[3] >= 0.99) break; }
    }
    let base = stack.length && stack[stack.length - 1][3] >= 0.99 ? [255, 255, 255, 1] : parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  window.$contrastOf = (el) => {
    const cs = getComputedStyle(el);
    let op = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    const fg = parse(cs.color);
    const bg = bgOf(el);
    const c = over([fg[0], fg[1], fg[2], fg[3] * op], bg);
    return { ratio: Math.round(ratio(c, bg) * 100) / 100, light: lum(bg) >= 0.5, color: cs.color, bg: "rgb(" + bg.slice(0, 3).map(Math.round).join(",") + ")" };
  };
  // opts.lightOnly：只算字本身是浅色的（白 / 近白，亮度 > 0.4）——本次 bug 的样子；
  // 用在窗里还有统一发送格式的琥珀字（#ba7517 等，Annie 定的发送页格式）的地方，那些不在这次范围。
  window.$lowContrast = (rootSel, min = 4.5, opts = {}) => {
    const root = typeof rootSel === "string" ? document.querySelector(rootSel) : rootSel;
    if (!root) return [{ text: "(no root " + rootSel + ")", ratio: 0 }];
    const bad = [];
    for (const el of [root, ...root.querySelectorAll("*")]) {
      let txt = "";
      for (const n of el.childNodes) if (n.nodeType === 3) txt += n.textContent;
      txt = txt.trim();
      if (!txt) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === "hidden") continue;
      if (el.closest(":disabled,[aria-disabled=true]")) continue;
      const k = window.$contrastOf(el);
      if (!k.light) continue;
      if (opts.lightOnly && lum(parse(getComputedStyle(el).color)) <= 0.4) continue;
      if (k.ratio < min) bad.push({ text: txt.slice(0, 50), color: k.color, bg: k.bg, ratio: k.ratio });
    }
    return bad;
  };
})();
`;
module.exports = { CONTRAST_HELPERS };
