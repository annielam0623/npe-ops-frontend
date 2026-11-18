/**
 * 短信的规矩（Annie 2026-10-15 深夜）：「全部短信都限制在 300 以内」，而且不能有 emoji / 特殊字符。
 * staff 能写短信的地方（两处群发、对话弹窗回复、Content Studio 短信模板）都用这里的 smsCheck()；
 * 超了或有特殊字符 ⇒ 群发、Main manifest Send message、对话框回复的 SMS 灰掉只发 Email（2026-11-17），模板不让存。后端（-ec）会照同一条规矩拒收。
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

// ── SMS 超字数 / 坏字 ⇒ SMS 灰掉、只能发 Email（Annie 2026-11-17「同意全部推荐，动手」，样稿 KnNXFz77T9jQerCUYBMrNz v2）──
// 三个入口（群发 broadcast-dialog、Main manifest Send message、对话框回复 conversation-modal）共用这里的判断和原文。

/** 能自动换成普通字符的字：换成什么、是什么、用什么代替（原因原文照样稿题 1 A）。 */
const PLAIN_GROUPS: readonly {
  chars: string;
  to: string;
  what: string;
  use: string;
}[] = [
  { chars: "“”„", to: '"', what: "curly quotes", use: 'straight quotes "' },
  {
    chars: "‘’‚",
    to: "'",
    what: "curly apostrophes",
    use: "a straight apostrophe '",
  },
  { chars: "—–", to: "-", what: "a long dash", use: "a short dash -" },
  {
    chars: "…",
    to: "...",
    what: "an ellipsis (one character)",
    use: "three dots ...",
  },
  {
    chars: " ",
    to: " ",
    what: "a non-breaking space",
    use: "a normal space",
  },
];

/** 带重音、SMS 发不了的字母 ⇒ 普通字母（表里有的 à ä é è ö ñ ü 等不在这里）。 */
const ACCENT_TO_PLAIN: Readonly<Record<string, string>> = {
  á: "a",
  â: "a",
  ã: "a",
  í: "i",
  î: "i",
  ï: "i",
  ó: "o",
  ô: "o",
  õ: "o",
  ú: "u",
  û: "u",
  ç: "c",
  ê: "e",
  ë: "e",
  Á: "A",
  Â: "A",
  Í: "I",
  Ó: "O",
  Ô: "O",
  Ú: "U",
  Ê: "E",
  È: "E",
  Ë: "E",
};

const EMOJI = /\p{Extended_Pictographic}/u;

/** 这个字 SMS 能不能发（GSM-7 基本表 + 扩展表）。 */
export function isSmsChar(ch: string): boolean {
  return GSM_BASIC.has(ch) || GSM_EXTENDED.has(ch);
}

/** 消息里有几个 SMS 发不了的字（算重复的，给「SMS can't send N characters」用）。 */
export function badCharCount(text: string): number {
  return Array.from(text).filter((ch) => !isSmsChar(ch)).length;
}

/** 坏字在页面上怎么显示：不换行空格看不见，写成 (space)。 */
export function showSmsChar(ch: string): string {
  return ch === " " ? "(space)" : ch;
}

function codePoint(ch: string): string {
  return `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * 每种坏字一句（只列消息里真有的）：chars = 这一句说的几个字，text = 后半句原文。
 * 例 { chars: ["“", "”"], text: 'are curly quotes. Use straight quotes " instead.' }。
 */
export function explainSmsChars(
  bad: readonly string[],
): { chars: string[]; text: string }[] {
  const out: { chars: string[]; text: string }[] = [];
  const done = new Set<string>();
  for (const g of PLAIN_GROUPS) {
    const hit = bad.filter((c) => g.chars.includes(c));
    if (!hit.length) continue;
    hit.forEach((c) => done.add(c));
    out.push({
      chars: hit,
      text: `${hit.length > 1 ? "are" : "is"} ${g.what}. Use ${g.use} instead.`,
    });
  }
  for (const c of bad) {
    if (done.has(c)) continue;
    if (ACCENT_TO_PLAIN[c])
      out.push({
        chars: [c],
        text: `is a letter with an accent SMS can't send. Use ${ACCENT_TO_PLAIN[c]} instead.`,
      });
    else if (EMOJI.test(c))
      out.push({
        chars: [c],
        text: "is an emoji. SMS can't send emoji. Remove it.",
      });
    else
      out.push({
        chars: [c],
        text: `(${codePoint(c)}) is a character SMS can't send. Remove it.`,
      });
  }
  return out;
}

/** Replace with plain characters：能换的都换掉（emoji、不认识的字留着）。 */
export function toPlainSms(text: string): string {
  let s = text;
  for (const g of PLAIN_GROUPS)
    for (const c of Array.from(g.chars)) s = s.split(c).join(g.to);
  for (const [c, to] of Object.entries(ACCENT_TO_PLAIN))
    s = s.split(c).join(to);
  return s;
}

/** 有没有能自动换的坏字（没有就不出 Replace 键）。 */
export function canMakePlain(bad: readonly string[]): boolean {
  return bad.some((c) => toPlainSms(c) !== c);
}

/** 第一句（有坏字时）。noEmail = 对话框里这位客人没邮箱。 */
export function badCharsHead(count: number, noEmail = false): string {
  return `SMS can't send ${count} character${count === 1 ? "" : "s"} in this message (marked in red below). ${
    noEmail
      ? "This guest has no email, so it can't be sent until you fix it."
      : "Fix them to send by SMS, or it goes by Email only."
  }`;
}

/**
 * 超字数那一句。counted = 括号里怎么算的半句（群发 "counting the signature and the longest guest name"、
 * Main manifest "counting the longest guest name and the date"、对话框不写）。
 */
export function tooLongText(
  length: number,
  counted = "",
  noEmail = false,
): string {
  return `Too long for SMS: ${length.toLocaleString("en-US")} / ${SMS_CHAR_LIMIT} characters (${(length - SMS_CHAR_LIMIT).toLocaleString("en-US")} over${counted ? `, ${counted}` : ""}). An SMS can be at most ${SMS_CHAR_LIMIT} characters (2 text messages); longer ones are cut off or not delivered. ${
    noEmail
      ? "This guest has no email: shorten the message to send it."
      : "Shorten it to send by SMS, or it goes by Email only."
  }`;
}
