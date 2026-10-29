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
  "ui.search.label": "Search",
  "ui.search.hint": "Search by name, reference, page or setting. Press Ctrl+K to come here.",
  "ui.search.submit": "Search",
  "ui.search.refused": "Search by name or reference instead.",
  "ui.search.too_short": "Type at least {min} characters.",
  "ui.search.too_long": "Use a shorter search.",
  "ui.search.recent": "Recent",
  "ui.search.count": "{count} results",
  "ui.search.count_one": "1 result",
  "ui.search.partial": "Some areas could not be searched just now; the results may be incomplete.",
  "ui.workspace.label": "Workspace",
  "ui.workspace.none": "No workspace is assigned to you yet.",
  "ui.workspace.home": "Go to Home",
  "ui.state.empty": "Nothing here yet",
  "ui.state.filtered_empty": "No results match these filters.",
  "ui.state.clear_filters": "Clear filters",
  "ui.state.loading": "Loading",
  "ui.state.error_saved": "Your changes were saved.",
  "ui.state.error_not_saved": "Nothing was saved.",
  "ui.state.error_unknown":
    "We could not confirm whether your changes were saved. Check before you try again.",
  "ui.state.denied": "You do not have access to this page",
  "ui.page.filters": "Filters and views",
  "ui.page.steps": "Steps",
  "ui.page.step_of": "Step {n} of {total}: {step}",
  "ui.approvals.request": "Request",
  "ui.approvals.maker": "Requested by",
  "ui.approvals.submitted": "Submitted",
  "ui.approvals.due": "Due",
  "ui.evidence.source": "Source: {class}",
  "ui.evidence.ledger": "ledger",
  "ui.evidence.computed": "calculation",
  "ui.evidence.external": "external system",
  "ui.evidence.ai": "AI run",
  "ui.table.columns": "Columns",
  "ui.table.columns_legend": "Columns to show, in order",
  "ui.table.pinned": "always shown",
  "ui.table.move_up": "Move {column} up",
  "ui.table.move_down": "Move {column} down",
  "ui.table.density": "Row density",
  "ui.table.density_comfortable": "Comfortable",
  "ui.table.density_compact": "Compact",
  "ui.table.apply": "Apply",
  "ui.table.reset": "Reset to default",
  "ui.views.title": "Saved views",
  "ui.views.mine": "My views",
  "ui.views.shared": "Shared views",
  "ui.views.none": "No saved views yet.",
  "ui.views.default": "default",
  "ui.views.save_label": "Save current view as",
  "ui.views.save": "Save view",
  "ui.keys.action": "Action",
  "ui.keys.keys": "Keys",
  "ui.keys.off": "off",
  "ui.keys.remap": "Change shortcuts",
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
  "ui.search.label": "खोजें",
  "ui.search.hint": "नाम, संदर्भ, पेज या सेटिंग से खोजें। यहाँ आने के लिए Ctrl+K दबाएँ।",
  "ui.search.submit": "खोजें",
  "ui.search.refused": "इसके बजाय नाम या संदर्भ से खोजें।",
  "ui.search.too_short": "कम से कम {min} अक्षर लिखें।",
  "ui.search.too_long": "छोटी खोज लिखें।",
  "ui.search.recent": "हाल के",
  "ui.search.count": "{count} परिणाम",
  "ui.search.count_one": "1 परिणाम",
  "ui.search.partial": "कुछ क्षेत्र अभी खोजे नहीं जा सके; परिणाम अधूरे हो सकते हैं।",
  "ui.workspace.label": "कार्यक्षेत्र",
  "ui.workspace.none": "आपको अभी कोई कार्यक्षेत्र नहीं सौंपा गया है।",
  "ui.workspace.home": "होम पर जाएँ",
  "ui.state.empty": "यहाँ अभी कुछ नहीं है",
  "ui.state.filtered_empty": "इन फ़िल्टर से कोई परिणाम नहीं मिला।",
  "ui.state.clear_filters": "फ़िल्टर हटाएँ",
  "ui.state.loading": "लोड हो रहा है",
  "ui.state.error_saved": "आपके बदलाव सहेज लिए गए।",
  "ui.state.error_not_saved": "कुछ भी सहेजा नहीं गया।",
  "ui.state.error_unknown":
    "हम पुष्टि नहीं कर सके कि आपके बदलाव सहेजे गए या नहीं। फिर से कोशिश करने से पहले जाँच लें।",
  "ui.state.denied": "आपको इस पेज की पहुँच नहीं है",
  "ui.page.filters": "फ़िल्टर और व्यू",
  "ui.page.steps": "चरण",
  "ui.page.step_of": "चरण {n} / {total}: {step}",
  "ui.approvals.request": "अनुरोध",
  "ui.approvals.maker": "अनुरोधकर्ता",
  "ui.approvals.submitted": "जमा किया गया",
  "ui.approvals.due": "नियत तिथि",
  "ui.evidence.source": "स्रोत: {class}",
  "ui.evidence.ledger": "लेजर",
  "ui.evidence.computed": "गणना",
  "ui.evidence.external": "बाहरी प्रणाली",
  "ui.evidence.ai": "एआई रन",
  "ui.table.columns": "कॉलम",
  "ui.table.columns_legend": "दिखाने वाले कॉलम, क्रम में",
  "ui.table.pinned": "हमेशा दिखता है",
  "ui.table.move_up": "{column} ऊपर ले जाएँ",
  "ui.table.move_down": "{column} नीचे ले जाएँ",
  "ui.table.density": "पंक्ति घनत्व",
  "ui.table.density_comfortable": "आरामदायक",
  "ui.table.density_compact": "सघन",
  "ui.table.apply": "लागू करें",
  "ui.table.reset": "डिफ़ॉल्ट पर लौटाएँ",
  "ui.views.title": "सहेजे गए व्यू",
  "ui.views.mine": "मेरे व्यू",
  "ui.views.shared": "साझा व्यू",
  "ui.views.none": "अभी कोई सहेजा गया व्यू नहीं है।",
  "ui.views.default": "डिफ़ॉल्ट",
  "ui.views.save_label": "मौजूदा व्यू को इस नाम से सहेजें",
  "ui.views.save": "व्यू सहेजें",
  "ui.keys.action": "कार्य",
  "ui.keys.keys": "कुंजियाँ",
  "ui.keys.off": "बंद",
  "ui.keys.remap": "शॉर्टकट बदलें",
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
