/**
 * 全深色主题（Annie 2026-10-11）：主样子照旧是「深色外框 + 白卡片」（同旧后台）；全深色另外做，
 * 做好的页面先藏着，以后一批开放给 staff 选。
 *
 * - 开着时 <html data-theme="night">；样式用 globals.css 里的 `night:` 变体写（不用 `dark:`——
 *   那个跟着电脑系统的深色模式走，error / not-found 页在用）。没开时页面和现在完全一样。
 * - 现在还没有给 staff 的开关：网址带 `?theme=night` 打开、`?theme=day` 关掉，记在这个浏览器里。
 *   以后开放时在用户菜单加开关、改成跟账号走（user-prefs），这里的 key 一并换掉。
 */
export const THEME_STORAGE_KEY = "npe_ops_theme";

/**
 * 页面画出来之前就设好 data-theme（放在 <head> 里同步执行），不然打开全深色时会先闪一下白卡片。
 * 内容是写死的字符串，不拼任何外部输入。
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var u=new URLSearchParams(location.search).get("theme");if(u==="night")localStorage.setItem(k,"night");else if(u==="day")localStorage.removeItem(k);if(localStorage.getItem(k)==="night")document.documentElement.setAttribute("data-theme","night");}catch(e){}})();`;
