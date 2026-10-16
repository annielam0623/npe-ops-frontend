/**
 * 短信的规矩（Annie 2026-10-15 深夜）：「全部短信都限制在 300 以内」，而且不能有 emoji / 特殊字符。
 * staff 能写短信的地方（两处群发、对话弹窗回复、Content Studio 短信模板）都用这里的 smsCheck()；
 * 超了或有特殊字符 ⇒ 群发和回复问要不要改发 Email，模板不让存。后端（-ec）会照同一条规矩拒收。
 */
export const SMS_CHAR_LIMIT = 300;

/**
 * GSM-7 基本表 + 扩展表，**照抄后端 app/services/gsm7.py**（那边是单一真源，改了这里要跟着改）。
 * 表外的字符（弯引号、长破折号、emoji、中文、á ç ê …）会让整条短信变成 UCS-2、每段只装 67 个字 ⇒ 算「特殊字符」。
 * ⚠️ 大小写不对称：大写 Ç 在表里，小写 ç 不在；表里有 à ä ö ñ ü è é ù ì ò，没有 á í ó ú â ê î ô û。
 */
const GSM_BASIC = new Set(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅå" +
      "Δ_ΦΓΛΩΠΨΣΘΞÆæßÉ" +
      " !\"#¤%&'()*+,-./0123456789:;<=>?" +
      "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§" +
      "¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);
/** 扩展表：能发，但每个占 2 个字符位。 */
const GSM_EXTENDED = new Set(Array.from("^{}\\[~]|€"));

/** 短信不能用的字符（去重，按出现顺序）。 */
export function nonGsmChars(text: string): string[] {
  const out: string[] = [];
  for (const ch of Array.from(text)) {
    if (!GSM_BASIC.has(ch) && !GSM_EXTENDED.has(ch) && !out.includes(ch))
      out.push(ch);
  }
  return out;
}

/** 计费字数：扩展表字符算 2 个（同后端 count_segments 的 GSM-7 算法）。 */
export function smsLength(text: string): number {
  let n = 0;
  for (const ch of Array.from(text)) n += GSM_EXTENDED.has(ch) ? 2 : 1;
  return n;
}

/**
 * 「N / 300 chars」；超了 / 有特殊字符时加一句怎么办（email 大小写跟着各页原来的写法）。
 * over = 不能按短信发（太长或有特殊字符）。
 * typed：staff 自己写的原文——特殊字符只查它（字数按展开后的 text 算）；客人名字里的字符不是 staff 能改的。
 */
export function smsCheck(
  text: string,
  emailWord: "Email" | "email" = "Email",
  typed: string = text,
): { text: string; over: boolean; length: number; bad: string[] } {
  const length = smsLength(text);
  const bad = nonGsmChars(typed);
  const long = length > SMS_CHAR_LIMIT;
  const head = `${length.toLocaleString("en-US")} / ${SMS_CHAR_LIMIT} chars`;
  const tail = bad.length
    ? ` - SMS can't use these characters: ${bad.join(" ")}. Remove them or send it by ${emailWord} only.`
    : long
      ? ` - too long for SMS. Shorten it or send it by ${emailWord} only.`
      : "";
  return { text: head + tail, over: long || bad.length > 0, length, bad };
}

/** 提问框里那句「为什么不能按短信发」。 */
export function smsProblem(
  check: { length: number; bad: string[] },
  counted = "",
): string {
  if (check.bad.length)
    return `SMS can't use these characters: ${check.bad.join(" ")}. Only plain letters, numbers and simple punctuation can go by SMS.`;
  return `This message is too long for SMS: ${check.length.toLocaleString("en-US")} characters${counted}. SMS allows up to ${SMS_CHAR_LIMIT}.`;
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
