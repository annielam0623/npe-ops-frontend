import localFont from "next/font/local";

/**
 * IBM Plex Sans 放在仓库里（components/ui/fonts/ibm-plex-sans，SIL OFL 1.1，许可见 OFL.txt），build 不用联网。
 * 原来是 next/font/google，build 时去 Google 拉字体偶尔失败（2026-10-28 92 查的根因，主窗口 11 定方案甲）。
 * 文件是 Google Fonts 的 latin 子集（@fontsource/ibm-plex-sans 5.1.1），参数照原来：latin、display swap、
 * 只有正体；unicode-range 同 Google 的 latin 子集（next/font 的参数只能直接写字面量，两处各写一遍）。
 */
/** 深色页面、Dashboard、Daily report、Notifications 用的 300–700。 */
export const plex = localFont({
  src: [
    {
      path: "./fonts/ibm-plex-sans/ibm-plex-sans-latin-300-normal.woff2",
      weight: "300",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-sans/ibm-plex-sans-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-sans/ibm-plex-sans-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-sans/ibm-plex-sans-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-sans/ibm-plex-sans-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});

/** 三个 tracking 旧页面用的 400–700（照旧）。 */
export const plexTracking = localFont({
  src: [
    {
      path: "./fonts/ibm-plex-sans/ibm-plex-sans-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-sans/ibm-plex-sans-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-sans/ibm-plex-sans-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-sans/ibm-plex-sans-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});
