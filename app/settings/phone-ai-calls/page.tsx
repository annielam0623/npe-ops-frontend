import type { Metadata } from "next";

import { VoiceCallsView } from "@/components/voice-calls/voice-calls-view";

export const metadata: Metadata = {
  title: "Phone AI Calls",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function PhoneAiCallsPage() {
  return <VoiceCallsView />;
}
