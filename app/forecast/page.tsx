import type { Metadata } from "next";

import { ForecastView } from "@/components/forecast/forecast-view";

export const metadata: Metadata = {
  title: "60 Days Forecast",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function ForecastPage() {
  return <ForecastView />;
}
