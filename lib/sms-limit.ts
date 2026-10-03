/**
 * 短信字数上限，与旧后台 app/static/sms-limit.js 同一套算法。
 * 超过 1600 字 Twilio 会整条拒收（2026-09-11 出过事），所以能写短信的地方都要显示字数。
 */
export const SMS_MAX = 1600;

/** 段数：纯 Latin-1 每段 160 / 153 字，含其他字符（中文、emoji 等）每段 70 / 67 字。 */
export function smsSegments(text: string): number {
  const len = text.length;
  if (!len) {
    return 0;
  }
  // 有任何 Latin-1 以外的字符（码位 > 0xFF）就按 UCS-2 计。
  const ucs2 = Array.from(text).some((ch) => (ch.codePointAt(0) ?? 0) > 0xff);
  const single = ucs2 ? 70 : 160;
  const multi = ucs2 ? 67 : 153;
  return len <= single ? 1 : Math.ceil(len / multi);
}

export function describeSmsLength(text: string): {
  text: string;
  over: boolean;
} {
  const n = text.length;
  const max = SMS_MAX.toLocaleString("en-US");
  if (n > SMS_MAX) {
    return {
      text: `${n.toLocaleString("en-US")} / ${max} chars - over by ${(n - SMS_MAX).toLocaleString("en-US")}. Twilio will reject this SMS.`,
      over: true,
    };
  }
  return {
    text: `${n.toLocaleString("en-US")} / ${max} chars, ${smsSegments(text)} SMS`,
    over: false,
  };
}
