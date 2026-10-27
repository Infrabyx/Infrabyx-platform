// Message catalogues for the shared components (IPB-06-43: strings externalised, no
// concatenation). Products add their own catalogues with `withMessages`. Interpolation is
// `{name}`; values are inserted as text, never as markup.
import { localeFallbacks } from "./format.js";

export type Catalogue = Readonly<Record<string, string>>;

const EN: Catalogue = {
  "ui.skip.main": "Skip to main content",
  "ui.skip.navigation": "Skip to navigation",
  "ui.nav.main": "Main",
  "ui.nav.footer": "Footer",
  "ui.nav.breadcrumb": "Breadcrumb",
  "ui.help.button": "Help: {label}",
  "ui.help.learn_more": "Learn more",
  "ui.help.regulatory_reference": "Regulatory reference",
  "ui.errors.summary": "There is a problem",
  "ui.errors.details": "Details",
  "ui.errors.reference": "Reference {code}",
  "ui.field.required": "required",
  "ui.field.optional": "optional",
  "ui.table.sorted_ascending": "sorted ascending",
  "ui.table.sorted_descending": "sorted descending",
  "ui.chart.view_table": "View as table",
  "ui.media.load": "Load {provider} content",
  "ui.media.notice": "Loads content from {provider}. See the Cookie Policy.",
  "ui.media.duration": "Duration {duration}",
  "ui.ai.label": "AI-generated",
  "ui.lang.unavailable": "{language} (not yet available)",
};

const HI: Catalogue = {
  "ui.skip.main": "मुख्य सामग्री पर जाएँ",
  "ui.skip.navigation": "नेविगेशन पर जाएँ",
  "ui.nav.main": "मुख्य",
  "ui.nav.footer": "फ़ुटर",
  "ui.nav.breadcrumb": "ब्रेडक्रम्ब",
  "ui.help.button": "सहायता: {label}",
  "ui.help.learn_more": "और जानें",
  "ui.help.regulatory_reference": "नियामक संदर्भ",
  "ui.errors.summary": "एक समस्या है",
  "ui.errors.details": "विवरण",
  "ui.errors.reference": "संदर्भ {code}",
  "ui.field.required": "आवश्यक",
  "ui.field.optional": "वैकल्पिक",
  "ui.table.sorted_ascending": "आरोही क्रम में",
  "ui.table.sorted_descending": "अवरोही क्रम में",
  "ui.chart.view_table": "तालिका के रूप में देखें",
  "ui.media.load": "{provider} सामग्री लोड करें",
  "ui.media.notice": "{provider} से सामग्री लोड होती है। कुकी नीति देखें।",
  "ui.media.duration": "अवधि {duration}",
  "ui.ai.label": "एआई द्वारा बनाया गया",
  "ui.lang.unavailable": "{language} (अभी उपलब्ध नहीं)",
};

const BASE: Readonly<Record<string, Catalogue>> = { "en-IN": EN, "hi-IN": HI };

export interface Messages {
  locale: string;
  t(key: string, vars?: Readonly<Record<string, string | number>>): string;
}

/** A translator for `locale`, falling back `<locale> → hi → en`; a missing key returns the key. */
export function messages(
  locale: string,
  extra: Readonly<Record<string, Catalogue>> = {},
): Messages {
  const chain = localeFallbacks(locale);
  return {
    locale,
    t(key, vars = {}) {
      for (const l of chain) {
        const text = extra[l]?.[key] ?? BASE[l]?.[key];
        if (text !== undefined)
          return text.replace(/\{([a-z_]+)\}/g, (m, name: string) =>
            name in vars ? String(vars[name]) : m,
          );
      }
      return key;
    },
  };
}

/** Every key of the base English catalogue (for the completeness test and products' lints). */
export const BASE_MESSAGE_KEYS: readonly string[] = Object.keys(EN);
export const baseCatalogue = (locale: string): Catalogue | undefined => BASE[locale];
