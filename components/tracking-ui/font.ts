import { IBM_Plex_Sans } from "next/font/google";

/** 三个 tracking 旧页面都用 IBM Plex Sans（各自 <head> 里挂的 Google Fonts），照旧。 */
export const trackingFont = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
