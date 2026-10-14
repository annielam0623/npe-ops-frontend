/* 窗口底部的横向滚动条 —— 后台所有页面共用（Annie 2026-10-01：「不管我的页面开多大，
 * 只要没有显示全部内容，底部的滑条永远在屏幕的底部而不是在页面的底部」，大部分时候是半屏）。
 *
 * 做什么：页面上任何一块能横向滚动（overflow-x: auto/scroll）、内容比它宽、
 * 而且**它的底边在窗口外面**的区域，在窗口最底下浮出一条和它同步的滚动条，左右对齐它。
 * 它的底边回到窗口里（自己的滚动条看得见了），浮动条就藏起来。
 *
 * 谁引它：`base.html`（所有 extends base.html 的后台页）+ 三个 tracking 页各自的 <head>
 * （它们不 extends base.html，同 sms-limit.js / user-prefs.js 的挂法）。
 * ops 新前端：照抄自后端 `app/static/window-hscroll.js`（origin/main 2026-10-14），由 `app/layout.tsx` 全站挂一次
 * （Annie 2026-10-14：tracking 页「页面下方的横向滑条」要在屏幕底部）。ops 唯一的改动：自己带浮条的区域
 * （HR 页 `data-own-hscroll`）跳过，免得出两条。改这里时对照后端那份。
 * 页面不用写任何东西 —— 表格是 fetch 回来之后才画的，靠 MutationObserver 自己发现。
 *
 * 🔴 **最坏情况是「没出现」，不是「页面坏了」**：不改页面的 DOM 结构、不改任何元素的样式，
 *    只在 body 末尾加一个 position:fixed 的条；出任何错都只是这条不显示。
 *
 * 判定（全部要成立才显示）：
 *   · scrollWidth > clientWidth（真有东西藏在右边 / 左边）；
 *   · 这块的顶边在窗口里、底边在窗口下面；
 *   · 把它裁掉的是**窗口**，不是别的滚动框（弹窗里的表格底边被弹窗裁掉时，浮在窗口底部
 *     会跟它对不上 —— 那种情况不管，照旧用它自己的滚动条）。
 *   同时有几块符合时，取在窗口里露出最多的那块。
 */
(function () {
  'use strict';
  if (window.__npeWindowHScroll) return;
  window.__npeWindowHScroll = true;

  var BAR_H = 14;
  var css =
    '.npe-hbar{position:fixed;bottom:0;z-index:90;height:' + BAR_H + 'px;overflow-x:scroll;overflow-y:hidden;' +
    'background:rgba(240,240,236,.97);border-top:1px solid rgba(0,0,0,.18);display:none;}' +
    '.npe-hbar.on{display:block;}' +
    '.npe-hbar>div{height:1px;}' +
    '.npe-hbar::-webkit-scrollbar{height:' + BAR_H + 'px;}' +
    '.npe-hbar::-webkit-scrollbar-track{background:transparent;}' +
    '.npe-hbar::-webkit-scrollbar-thumb{background:rgba(0,0,0,.38);border-radius:7px;border:3px solid rgba(240,240,236,.97);}' +
    '.npe-hbar::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.55);}';

  var bar, inner, target = null, candidates = [], scanTimer = null, raf = 0;

  function scrollsX(el) {
    var ox = getComputedStyle(el).overflowX;
    return ox === 'auto' || ox === 'scroll';
  }

  /* 找候选。跳过 <table> 内部（几千个单元格，里面不会有横向滚动框）和本条自己。 */
  function scan() {
    scanTimer = null;
    var out = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) {
        var t = n.tagName.toUpperCase();   // 内联 <svg> 的 tagName 是小写
        if (n === bar || t === 'TABLE' || t === 'SCRIPT' || t === 'SVG') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      try { if (scrollsX(n) && !n.hasAttribute('data-own-hscroll')) out.push(n); } catch (e) { /* 不在文档里了 */ }
    }
    candidates = out;
    schedule();
  }
  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 200);
  }

  /* 把 el 裁掉的那条底边：祖先里离它最近的、会裁内容的框，和窗口，取最小。
     返回 [底边, 是不是窗口在裁]。 */
  function clipBottom(el) {
    var vh = window.innerHeight, b = vh;
    for (var p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      var oy = getComputedStyle(p).overflowY;
      if (oy !== 'visible') {
        var pb = p.getBoundingClientRect().bottom;
        if (pb < b) b = pb;
      }
    }
    return [b, b >= vh - 2];
  }

  function pick() {
    var vh = window.innerHeight, vw = window.innerWidth, best = null, bestW = 0;
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!el.isConnected || el.scrollWidth <= el.clientWidth + 1) continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.top > vh - 40 || r.bottom <= vh + 1) continue;     // 没露出来 / 自己的滚动条看得见
      var c = clipBottom(el);
      if (!c[1]) continue;                                      // 被别的框裁掉，不归这条管
      var w = Math.min(r.right, vw) - Math.max(r.left, 0);
      if (w > bestW) { best = el; bestW = w; }
    }
    return best;
  }

  function update() {
    raf = 0;
    if (!bar) return;
    var el = pick();
    if (el !== target) {
      target = el;
      if (!el) { bar.classList.remove('on'); return; }
    }
    if (!el) return;
    var r = el.getBoundingClientRect(), vw = window.innerWidth;
    var left = Math.max(r.left, 0);
    bar.style.left = left + 'px';
    bar.style.width = (Math.min(r.right, vw) - left) + 'px';
    /* 🔴 先显示再量：display:none 时 clientWidth 是 0，量出来的内层宽度只有几像素，
       条出现了却拖不动（code-reviewer CR-1）。 */
    bar.classList.add('on');
    /* 内层宽度 = 目标的 scrollWidth 按「条宽 / 目标可视宽」放大，两边能滚的距离才一样。 */
    inner.style.width = (el.scrollWidth * bar.clientWidth / (el.clientWidth || 1)) + 'px';
    if (!barOwns()) setBar(el.scrollLeft * ratio(el));
  }
  function ratio(el) {
    var a = el.scrollWidth - el.clientWidth, b = bar.scrollWidth - bar.clientWidth;
    return a > 0 ? b / a : 0;
  }
  /* 🔴 谁带谁：只看**用户手在哪一边**，不猜回声。
     原来靠「上次写进去的值」判回声（10/01 上线版），Annie 当晚实测：触控板把表格往右滑再滑回来，
     底部条到了最左、表格却停在右边几十像素，最左一列被切掉 —— 某一下真实滚动被当成回声吞了。
     现在：手按在底部条上（或刚在它上面滚过滚轮）时底部条带表格，其余任何时候表格带底部条；
     另一边的 scroll 事件一律不反写，所以不存在回声，也不会打断触控板的惯性滚动。 */
  var barDown = false, barUntil = 0;
  function barOwns() { return barDown || Date.now() < barUntil; }
  function setBar(v) {
    if (Math.abs(bar.scrollLeft - v) > 1) bar.scrollLeft = v;
  }
  function setTarget(v) {
    if (Math.abs(target.scrollLeft - v) > 1) target.scrollLeft = v;
  }
  /* setTimeout 而不是 requestAnimationFrame：后台标签页 / 无头浏览器里 rAF 不跑，
     条就永远不更新；16ms 对滚动跟手来说一样。 */
  function schedule() {
    if (!raf) raf = setTimeout(update, 16);
  }

  function init() {
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    bar = document.createElement('div');
    bar.className = 'npe-hbar';
    bar.setAttribute('aria-hidden', 'true');
    inner = document.createElement('div');
    bar.appendChild(inner);
    document.body.appendChild(bar);

    /* 手在哪：按下 / 滚轮 / 触摸 / 键盘，落在底部条上就归它，落在别处就归表格。
       松手在窗口外收不到 pointerup 也没关系 —— 下一次在别处的任何操作都会把它交回表格。 */
    /* 条的接管期一过，按表格的位置补写一次条（code-reviewer SF-1）：接管期间表格若被别的原因挪动
       （重画后位置被夹紧、换成另一张表），条不会跟，要靠这一下对齐，不用等下一次滚动。 */
    var resyncTimer = null;
    function resyncLater() {
      if (resyncTimer) clearTimeout(resyncTimer);
      resyncTimer = setTimeout(function () { resyncTimer = null; if (barOwns()) resyncLater(); else schedule(); }, 450);
    }
    function onInput(e) {
      if (bar.contains(e.target)) {
        if (e.type === 'pointerdown' || e.type === 'mousedown' || e.type === 'touchstart') barDown = true;
        barUntil = Date.now() + 400;
        resyncLater();
      } else {
        barDown = false;
        barUntil = 0;
      }
    }
    ['pointerdown', 'mousedown', 'touchstart', 'wheel', 'keydown'].forEach(function (t) {
      document.addEventListener(t, onInput, { passive: true, capture: true });
    });
    function onRelease() {
      if (barDown) { barDown = false; barUntil = Date.now() + 400; resyncLater(); }   // 松手后惯性 / 最后一帧还算它的
    }
    ['pointerup', 'pointercancel', 'mouseup', 'touchend', 'touchcancel'].forEach(function (t) {
      document.addEventListener(t, onRelease, { passive: true, capture: true });
    });

    bar.addEventListener('scroll', function () {
      if (!target || !barOwns()) return;          // 不是手在条上 = 表格带过来的，不反写
      var r = ratio(target);
      if (r > 0) setTarget(bar.scrollLeft / r);
    });
    /* 捕获阶段：后台内容区（base.html 的 .content）和表格框都是自己滚动的，scroll 不冒泡。 */
    document.addEventListener('scroll', function (e) {
      if (e.target === bar) return;
      if (e.target === target) {
        if (!barOwns()) setBar(target.scrollLeft * ratio(target));
        return;
      }
      schedule();
    }, { passive: true, capture: true });
    window.addEventListener('resize', function () { schedule(); scheduleScan(); });
    /* 表格是 fetch 回来之后才画的、筛选会重画、弹窗会开关 —— DOM 一变就重新找。 */
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].target !== bar && !bar.contains(list[i].target)) { scheduleScan(); return; }
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    scan();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
