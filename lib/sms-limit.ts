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

/**
 * staff 写的短信最多几段（Annie 2026-10-14 群发定、2026-10-15 再说「还是按照老规矩，最多两段，不可以超过，否则发邮件」）：
 * 群发和对话弹窗的单条回复都按它；超了建议改发 Email。后端那条 1,600 字是硬上限，前端两段先挡住。
 */
export const SMS_MAX_SEGMENTS = 2;

/** 「N chars, X of 2 SMS」，超了加一句改发 Email（email 小写 / 大写跟着各页原来的写法）。 */
export function describeTwoSms(
  text: string,
  emailWord: "Email" | "email" = "Email",
): { text: string; over: boolean; segments: number } {
  const segments = smsSegments(text);
  const over = segments > SMS_MAX_SEGMENTS;
  return {
    text: `${text.length.toLocaleString("en-US")} chars, ${segments} of ${SMS_MAX_SEGMENTS} SMS${
      over
        ? ` - too long for SMS. Shorten it or send it by ${emailWord} only.`
        : ""
    }`,
    over,
    segments,
  };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** 后端展开 {tour_date} 用 strftime('%B %d, %Y')（日补零），这里拼同样的串，字数才对得上。 */
export function tourDateText(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[3]}, ${m[1]}` : "";
}

/** 按最坏情况展开 {first_name} / {tour_date}：名字用最长的那个（没有用 Guest）。 */
export function expandForCount(
  body: string,
  firstNames: readonly string[],
  tourDate: string,
): string {
  const longest = firstNames.reduce(
    (a, n) => ((n || "Guest").length > a.length ? n || "Guest" : a),
    "Guest",
  );
  return body
    .split("{first_name}")
    .join(longest)
    .split("{tour_date}")
    .join(tourDateText(tourDate));
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
