// 三个 tracking 页共用的检查（Annie 2026-10-14：「header 的宽窄没有办法调整」「页面下方的横向滑条也没有 —— 是屏幕的页面不是表格的页面」）：
// 拖表头右边缘调列宽、按内容自动定列宽、拖过以后刷新不还原、窗口底部的横向浮条（public/window-hscroll.js）。
// 调用时表格要已经画好行。opts.skipWidths：{ 列名文字: "200px" }，写死宽度、不参与自动列宽的列。
async function resizeChecks({ evaluate, check, sleep, page, refresh, skipWidths = {} }) {
  const P = `[${page}]`;
  const heads = "[...document.querySelectorAll('thead th[draggable=true]')]";

  check(
    `${P} 每个系统列表头右边都有拖宽手柄`,
    await evaluate(`const h = ${heads}; return h.length > 3 && h.every(th => { const r = th.querySelector('.col-resizer'); return r && getComputedStyle(r).cursor === 'col-resize' && getComputedStyle(r).position === 'absolute'; });`),
  );
  check(
    `${P} 自动列宽：不跳过的列表头都写了 px 宽度`,
    await evaluate(`return ${heads}.filter(th => th.dataset.autofit !== 'skip').every(th => /^\\d+px$/.test(th.style.width));`),
    await evaluate(`return ${heads}.map(th => th.textContent.trim().slice(0, 12) + '=' + th.style.width).join(', ');`),
  );
  for (const [name, width] of Object.entries(skipWidths)) {
    check(
      `${P} ${name} 列不参与自动列宽，保持 ${width}`,
      await evaluate(`const th = ${heads}.find(t => t.textContent.includes(${JSON.stringify(name)})); return !!th && th.dataset.autofit === 'skip' && th.style.width === ${JSON.stringify(width)};`),
    );
  }

  // 拖第二个系统列（第一列有时是单号，窄）的右边缘往右 80px。
  const order0 = await evaluate(`return ${heads}.map(th => th.textContent.trim()).join('|');`);
  const before = await evaluate(`return ${heads}[1].offsetWidth;`);
  await evaluate(`
    const th = ${heads}[1]; const r = th.querySelector('.col-resizer').getBoundingClientRect();
    const x = r.left + 2, y = r.top + 5;
    th.querySelector('.col-resizer').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + 80, clientY: y }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + 80, clientY: y }));`);
  await sleep(100);
  const after = await evaluate(`return ${heads}[1].offsetWidth;`);
  check(`${P} 拖表头右边缘：这一列变宽约 80px`, Math.abs(after - before - 80) <= 3, `${before} → ${after}`);
  check(
    `${P} 拖宽不会顺带拖动列的位置`,
    (await evaluate(`return ${heads}.map(th => th.textContent.trim()).join('|');`)) === order0,
  );
  const styleW = await evaluate(`return ${heads}[1].style.width;`);
  await refresh();
  check(
    `${P} 拖过以后刷新数据（同一屏）：自动列宽不再覆盖手拖的宽度`,
    (await evaluate(`return ${heads}[1].style.width;`)) === styleW,
    `${styleW} → ${await evaluate(`return ${heads}[1].style.width;`)}`,
  );

  // 窗口底部的横向浮条：把表格的滚动框临时弄窄、弄高（底边出窗口），浮条应出现、左右对齐它、拖条能带表格。
  check(`${P} 窗口底部浮条已挂（全站 window-hscroll.js）`, await evaluate("return !!document.querySelector('.npe-hbar');"));

  // 真实场景（Annie 2026-10-14 截图：旧页面一打开，滑条就在屏幕底部，跟着页面往下滚，不用滚到页面底）：
  // 只把行复制到 60 行、窗口宽度不够放下整张表，不改任何样式。页面在顶部时浮条就该在屏幕底部；往下滚一段，仍贴屏幕底部。
  await evaluate(`
    const tb = document.querySelector('thead th[draggable=true]').closest('table').tBodies[0];
    window.__hsRows = tb.rows.length; const rows = [...tb.rows];
    for (let i = 0; i < 10; i++) rows.forEach(r => tb.appendChild(r.cloneNode(true)));
    document.querySelector('thead th[draggable=true]').closest('table').parentElement.style.maxWidth = '900px';
    window.scrollTo(0, 0);`);
  await sleep(600);
  check(
    `${P} 真实场景：页面在顶部、表格很长很宽 ⇒ 屏幕最底下已经有横向滑条（不用滚到页面底部）`,
    await evaluate("const b = document.querySelector('.npe-hbar'); return scrollY === 0 && b.classList.contains('on') && Math.abs(b.getBoundingClientRect().bottom - innerHeight) < 1;"),
    await evaluate("const sc = document.querySelector('thead th[draggable=true]').closest('table').parentElement; return 'vh=' + innerHeight + ' sc.bottom=' + Math.round(sc.getBoundingClientRect().bottom) + ' sw/cw=' + sc.scrollWidth + '/' + sc.clientWidth + ' bar=' + document.querySelector('.npe-hbar').className;"),
  );
  await evaluate("window.scrollBy(0, 300);");
  await sleep(400);
  check(
    `${P} 真实场景：页面往下滚，滑条跟着留在屏幕底部`,
    await evaluate("const b = document.querySelector('.npe-hbar'), sc = document.querySelector('thead th[draggable=true]').closest('table').parentElement; return sc.getBoundingClientRect().bottom <= innerHeight + 1 || (b.classList.contains('on') && Math.abs(b.getBoundingClientRect().bottom - innerHeight) < 1);"),
  );
  await evaluate(`
    const t = document.querySelector('thead th[draggable=true]').closest('table');
    [...t.tBodies[0].rows].slice(window.__hsRows).forEach(r => r.remove()); t.parentElement.style.maxWidth = ''; window.scrollTo(0, 0);`);
  await sleep(400);
  await evaluate(`
    const sc = document.querySelector('thead th[draggable=true]').closest('table').parentElement;
    window.__hs = sc; window.__hsOld = sc.getAttribute('style') || '';
    sc.style.maxWidth = '420px'; sc.style.maxHeight = 'none'; sc.style.paddingBottom = (innerHeight * 2) + 'px';`);
  await sleep(600);
  check(
    `${P} 表格比窗口宽、底边在窗口外：屏幕最底下出现横向浮条，左右对齐表格`,
    await evaluate(`const b = document.querySelector('.npe-hbar'), r = window.__hs.getBoundingClientRect(); return b.classList.contains('on') && getComputedStyle(b).position === 'fixed' && Math.abs(b.getBoundingClientRect().bottom - innerHeight) < 1 && Math.abs(parseFloat(b.style.left) - Math.max(r.left, 0)) < 1;`),
    await evaluate(`const b = document.querySelector('.npe-hbar'); return b.className + ' left=' + b.style.left + ' w=' + b.style.width + ' sc=' + JSON.stringify(window.__hs.getBoundingClientRect());`),
  );
  await evaluate(`
    const b = document.querySelector('.npe-hbar');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    b.scrollLeft = (b.scrollWidth - b.clientWidth) / 2;`);
  await sleep(200);
  check(
    `${P} 拖浮条：表格跟着左右滚`,
    await evaluate("return window.__hs.scrollLeft > 20;"),
    await evaluate("return window.__hs.scrollLeft;"),
  );
  await evaluate(`
    document.querySelector('.npe-hbar').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    window.__hs.scrollLeft = 0; window.__hs.setAttribute('style', window.__hsOld);`);
  await sleep(600);
  check(
    `${P} 表格放得下（不用横滑）时浮条藏起来`,
    await evaluate("const sc = window.__hs; return sc.scrollWidth > sc.clientWidth + 1 && sc.getBoundingClientRect().bottom > innerHeight + 1 || !document.querySelector('.npe-hbar').classList.contains('on');"),
  );
}

module.exports = { resizeChecks };
