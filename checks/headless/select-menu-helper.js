// 全站下拉（components/ui/select-menu.tsx，Annie 2026-11-21）换掉原生 <select> 以后，检查套里选值 / 读值 / 读选项的共用小工具。
// 注入页面：await evaluate(SELECT_HELPERS)。原生 select 和新的下拉都认，换页的时候老检查不用逐个改写法：
//   await $sel(el, value)  ⇒ 选这个值（新下拉：点开、点那一项；原生：设值 + change），返回 Promise，记得 await / return。
//   $selValue(el)          ⇒ 当前值（新下拉读 data-value）。
//   await $selOptions(el)  ⇒ [{ value, label }]（新下拉：点开读完再关上）。
//   $isSelectMenu(el)      ⇒ 是不是新下拉。
const SELECT_HELPERS = `
window.$isSelectMenu = (el) => !!el && el.matches && el.matches('button[data-select-menu]');
window.$selWait = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 30)); } return null; };
window.$selList = (btn) => { const id = btn.getAttribute('aria-controls'); return id ? document.getElementById(id) : null; };
window.$selOpen = async (btn) => { if (btn.getAttribute('aria-expanded') !== 'true') btn.click(); return $selWait(() => $selList(btn)); };
window.$selClose = async (btn) => { if (btn.getAttribute('aria-expanded') === 'true') btn.click(); await $selWait(() => btn.getAttribute('aria-expanded') === 'false'); };
window.$sel = async (el, v) => {
  if (!el) throw new Error('$sel: no element');
  if (!$isSelectMenu(el)) {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  const list = await $selOpen(el);
  if (!list) throw new Error('$sel: menu did not open');
  const opt = [...list.querySelectorAll('[role=option]')].find((o) => o.dataset.value === String(v));
  if (!opt) { await $selClose(el); throw new Error('$sel: no option ' + v); }
  opt.click();
  await $selWait(() => el.dataset.value === String(v) || el.getAttribute('aria-expanded') === 'true');
  return true;
};
window.$selLabel = (el) => ($isSelectMenu(el) ? el.dataset.label : el.options[el.selectedIndex]?.text);
window.$selValue = (el) => ($isSelectMenu(el) ? el.dataset.value : el.value);
window.$selOptions = async (el) => {
  if (!$isSelectMenu(el)) return [...el.options].map((o) => ({ value: o.value, label: o.textContent, text: o.text, textContent: o.textContent }));
  const wasOpen = el.getAttribute('aria-expanded') === 'true';
  const list = await $selOpen(el);
  const out = [...list.querySelectorAll('[role=option]')].map((o) => { const l = o.textContent.trim(); return { value: o.dataset.value, label: l, text: l, textContent: l }; });
  if (!wasOpen) await $selClose(el);
  return out;
};
`;
module.exports = { SELECT_HELPERS };
