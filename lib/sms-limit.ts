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

// ── 规则一律照后端 app/services/sms.py（唯一标准，ae 2026-11-18 核对 9eb7396c 时指出）──
// ① 先把弯引号 / 长破折号 / 省略号换成普通字符（normalize_sms_punctuation，后端发出去的就是换过的），这几个不算坏字；
// ② 坏字 = 换完之后不在 GSM 基本表里的字（_GSM_BASIC_CHARS；扩展表 ^ { } \ [ ~ ] | € 也算坏字）；
//    群发 / Main manifest 先挖掉一模一样的 {first_name} {tour_date}（SMS_PLACEHOLDERS），对话框回复不挖；
// ③ 限制是段数（SMS_MAX_SEGMENTS = 2），按每位客人实际收到的文字（含 "Hi 名字, " 开头、展开名字和日期、换过排版符号）算：
//    有任何一个字 > U+00FF（含 Δ Φ 这类 GSM 希腊字母、名字里的 Ł / 中文）⇒ 每段 70 / 67，否则 160 / 153（sms_segments）。

export const SMS_MAX_SEGMENTS = 2;

/** 后端 _SMS_PUNCTUATION_NORMALIZE，一字不差。 */
const PUNCT_NORMALIZE: readonly [string, string][] = [
  ["‘", "'"],
  ["’", "'"],
  ["“", '"'],
  ["”", '"'],
  ["–", "-"],
  ["—", "-"],
  ["…", "..."],
];
const PUNCT_CHARS = new Set(PUNCT_NORMALIZE.map(([c]) => c));

/** 后端 SMS_PLACEHOLDERS。 */
const SMS_PLACEHOLDERS = ["{first_name}", "{tour_date}"] as const;

/** normalize_sms_punctuation：发出去之前后端会这样换。 */
export function normalizeSmsPunctuation(text: string): string {
  let s = text;
  for (const [c, to] of PUNCT_NORMALIZE) s = s.split(c).join(to);
  return s;
}

/** 这个字 SMS 能不能发：GSM 基本表，或后端会自动换掉的排版符号。 */
export function isSmsChar(ch: string): boolean {
  return GSM_BASIC.has(ch) || PUNCT_CHARS.has(ch);
}

/**
 * 逐字（按码位）标出哪些是坏字。placeholders = 群发 / Main manifest：一模一样的 {first_name} {tour_date} 不算。
 * 返回和 Array.from(text) 一样长的数组。
 */
export function smsBadMask(text: string, placeholders: boolean): boolean[] {
  const chars = Array.from(text);
  const out = chars.map(() => false);
  for (let i = 0; i < chars.length; i++) {
    if (placeholders) {
      const tok = SMS_PLACEHOLDERS.find(
        (t) => chars.slice(i, i + t.length).join("") === t,
      );
      if (tok) {
        i += tok.length - 1;
        continue;
      }
    }
    out[i] = !isSmsChar(chars[i]);
  }
  return out;
}

/** 坏字去重、按出现顺序。 */
export function smsBadChars(text: string, placeholders: boolean): string[] {
  const chars = Array.from(text);
  const mask = smsBadMask(text, placeholders);
  const out: string[] = [];
  chars.forEach((c, i) => {
    if (mask[i] && !out.includes(c)) out.push(c);
  });
  return out;
}

/** 消息里有几个 SMS 发不了的字（算重复的，给「SMS can't send N characters」用）。 */
export function badCharCount(text: string, placeholders: boolean): number {
  return smsBadMask(text, placeholders).filter(Boolean).length;
}

/** 两段最多几个字：纯 GSM 306（153 × 2），有 > U+00FF 的字 134（67 × 2）。 */
export function smsMaxChars(ucs2: boolean): number {
  return SMS_MAX_SEGMENTS * (ucs2 ? 67 : 153);
}

/** 一条实际发出去的短信：几个字（按码位，同后端 len()）、是不是 UCS-2、让它变 UCS-2 的第一个字。 */
function measure(final: string): {
  length: number;
  ucs2: boolean;
  wideChar: string | null;
} {
  const chars = Array.from(normalizeSmsPunctuation(final));
  const wide = chars.find((c) => (c.codePointAt(0) ?? 0) > 0xff) ?? null;
  return { length: chars.length, ucs2: wide !== null, wideChar: wide };
}

export interface SmsVerdict {
  /** staff 写的字里的坏字（去重）。 */
  bad: string[];
  /** 最紧的那位客人实际收到的字数 / 两段上限。 */
  length: number;
  limit: number;
  /** 让这条变成 70 / 67 一段的字（没有 ⇒ null），以及它是不是 staff 自己写的。 */
  wideChar: string | null;
  wideInTyped: boolean;
  long: boolean;
  /** 不能按短信发（坏字或超两段）。 */
  over: boolean;
}

/**
 * typed = staff 写的原文（群发含签名）；finals = 每位有手机号的客人实际收到的短信（展开、加开头之后，换排版符号之前）。
 * finals 为空（没人有手机号，后端不查段数）⇒ 只按 display 显示字数，不算超。
 */
export function smsVerdict({
  typed,
  finals,
  placeholders,
  display = typed,
}: {
  typed: string;
  finals: readonly string[];
  placeholders: boolean;
  display?: string;
}): SmsVerdict {
  const bad = smsBadChars(typed, placeholders);
  const pool = finals.length ? finals : [display];
  let worst = measure(pool[0] ?? "");
  for (const f of pool.slice(1)) {
    const m = measure(f);
    if (
      m.length - smsMaxChars(m.ucs2) >
      worst.length - smsMaxChars(worst.ucs2)
    )
      worst = m;
  }
  const limit = smsMaxChars(worst.ucs2);
  const long = finals.length > 0 && worst.length > limit;
  return {
    bad,
    length: worst.length,
    limit,
    wideChar: worst.wideChar,
    wideInTyped:
      worst.wideChar !== null &&
      normalizeSmsPunctuation(typed).includes(worst.wideChar),
    long,
    over: long || bad.length > 0,
  };
}

/** 后端 broadcast_send.personalise 的 first_name：first_name，没有用 customer_name 第一个词，再没有用 Guest。 */
export function smsFirstName(firstName: string, customerName: string): string {
  if (firstName) return firstName;
  const parts = (customerName || "Guest").trim().split(/\s+/).filter(Boolean);
  return parts[0] ?? "Guest";
}

/** 后端 broadcast_send.sms_message：一位客人实际收到的短信（"Hi 名字, " + 展开后的正文）。 */
export function broadcastSmsText(
  body: string,
  firstName: string,
  tourDate: string,
): string {
  const msg = body
    .split("{first_name}")
    .join(firstName)
    .split("{tour_date}")
    .join(tourDateText(tourDate));
  return `Hi ${firstName}, ${msg}`;
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
    else if (GSM_EXTENDED.has(c))
      // ^ { } \ [ ~ ] | €：后端不收（只认 GSM 基本表）。
      out.push({
        chars: [c],
        text: "is a character SMS can't send. Remove it.",
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
  v: Pick<SmsVerdict, "length" | "limit" | "wideChar" | "wideInTyped">,
  counted = "",
  noEmail = false,
): string {
  const { length, limit } = v;
  // 有 > U+00FF 的字（Δ、Ł、中文…）⇒ 上限 134，要写清是哪个字、在哪（staff 写的 / 客人名字里）。
  const why = v.wideChar
    ? `${v.wideInTyped ? "This message has" : "A guest name has"} ${v.wideChar}, so an SMS can be at most ${limit} characters (2 text messages)`
    : `An SMS can be at most ${limit} characters (2 text messages)`;
  return `Too long for SMS: ${length.toLocaleString("en-US")} / ${limit} characters (${(length - limit).toLocaleString("en-US")} over${counted ? `, ${counted}` : ""}). ${why}; longer ones are cut off or not delivered. ${
    noEmail
      ? "This guest has no email: shorten the message to send it."
      : "Shorten it to send by SMS, or it goes by Email only."
  }`;
}
