// Formatters for Indian locales (IPB-06-44, IPB-07 §07.5 `ux.appearance.*`). Amounts use Indian
// digit grouping (₹12,34,567.00); dates default to `DD MMM YYYY` in Asia/Kolkata; amounts in words
// appear on regulated steps in the active locale. en-IN and hi-IN now; the other ten locales of
// IPB-06-43 wait for `flg_i18n_locales_extended`.

export const SUPPORTED_LOCALES = ["en-IN", "hi-IN"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

/** `<locale> → hi → en` (IPB-06-43, IPB-07-45). */
export function localeFallbacks(locale: string): string[] {
  const out = [locale];
  if (!locale.startsWith("hi")) out.push("hi-IN");
  if (!locale.startsWith("en")) out.push("en-IN");
  return [...new Set(out)];
}

/** Integer minor units (paise) → "₹12,34,567.00". Never floating-point arithmetic on money. */
export function formatAmountInr(
  minor: number,
  o: { locale?: SupportedLocale; fractionDigits?: 0 | 2 } = {},
): string {
  if (!Number.isSafeInteger(minor)) throw new Error("amounts are integer minor units");
  const digits = o.fractionDigits ?? 2;
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const grouped = new Intl.NumberFormat("en-IN", { useGrouping: true }).format(rupees);
  const fraction = digits === 2 ? `.${String(paise).padStart(2, "0")}` : "";
  return `${sign}₹${grouped}${fraction}`;
}

const MONTHS_EN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `DD MMM YYYY` in the given zone (default Asia/Kolkata). */
export function formatDate(date: Date | string, o: { timeZone?: string } = {}): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: o.timeZone ?? DEFAULT_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${MONTHS_EN[Number(get("month")) - 1]} ${get("year")}`;
}

/** ISO date for `<time datetime>`, in the given zone. */
export function isoDate(date: Date | string, o: { timeZone?: string } = {}): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: o.timeZone ?? DEFAULT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

const ONES_EN = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS_EN = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

function below100En(n: number): string {
  if (n < 20) return ONES_EN[n]!;
  const t = TENS_EN[Math.floor(n / 10)]!;
  return n % 10 ? `${t}-${ONES_EN[n % 10]}` : t;
}
function below1000En(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const head = h ? `${ONES_EN[h]} hundred` : "";
  if (!r) return head;
  return head ? `${head} ${below100En(r)}` : below100En(r);
}

/** Hindi words 0–99 (irregular, so listed in full). */
const HI_0_99 = (
  "शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस " +
  "बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस " +
  "पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस " +
  "सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ " +
  "इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर " +
  "पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी " +
  "अट्ठासी नवासी नब्बे इक्यानबे बानबे तिरानबे चौरानबे पंचानबे छियानबे सत्तानबे अट्ठानबे निन्यानबे"
).split(" ");

function below1000Hi(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const head = h ? `${HI_0_99[h]} सौ` : "";
  if (!r) return head;
  return head ? `${head} ${HI_0_99[r]}` : HI_0_99[r]!;
}

/**
 * Indian-system words for a whole-rupee amount: crore, lakh, thousand, hundred (IPB-06-44).
 * Paise are written separately by the caller when non-zero.
 */
export function amountInWords(rupees: number, locale: SupportedLocale = "en-IN"): string {
  if (!Number.isSafeInteger(rupees) || rupees < 0) throw new Error("a non-negative whole amount");
  const hi = locale === "hi-IN";
  if (rupees === 0) return hi ? `${HI_0_99[0]} रुपये` : "zero rupees";
  const units: [number, string, string][] = [
    [10_000_000, "crore", "करोड़"],
    [100_000, "lakh", "लाख"],
    [1000, "thousand", "हज़ार"],
  ];
  const words: string[] = [];
  let rest = rupees;
  for (const [size, en, hin] of units) {
    const count = Math.floor(rest / size);
    if (count) {
      // Above 99 crore the count itself is written in the same system.
      const c =
        size === 10_000_000 && count > 999
          ? amountInWords(count, locale).replace(hi ? / रुपये$/ : / rupees$/, "")
          : hi
            ? below1000Hi(count)
            : below1000En(count);
      words.push(`${c} ${hi ? hin : en}`);
      rest %= size;
    }
  }
  if (rest) words.push(hi ? below1000Hi(rest) : below1000En(rest));
  return `${words.join(" ")} ${hi ? "रुपये" : rupees === 1 ? "rupee" : "rupees"}`;
}
