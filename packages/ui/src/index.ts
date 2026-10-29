// @infrabyx/ui — server-rendered React components for every Infrabyx product (IPB-06, IPB-07).
// Tokens are in `@infrabyx/ui/tokens`, formatters and catalogues in `@infrabyx/ui/i18n`, and the
// component stylesheet in `@infrabyx/ui/styles.css` (token stylesheets: `@infrabyx/ui/tokens/<product>.css`).
// The search logic without React, for the browser, is `@infrabyx/ui/search`.
export const PACKAGE_NAME = "@infrabyx/ui" as const;
export * from "./components/shell.js";
export * from "./components/footer.js";
export * from "./components/forms.js";
export * from "./components/help.js";
export * from "./components/status.js";
export * from "./components/data.js";
export * from "./components/media.js";
export * from "./components/search.js";
export * from "./components/workspace.js";
export * from "./components/states.js";
export * from "./components/templates.js";
export * from "./components/table-views.js";
export * from "./components/keyboard-map.js";
export * from "./search/index.js";
export { COMPONENT_CSS } from "./styles.js";
export { messages, type Messages } from "./i18n/messages.js";
