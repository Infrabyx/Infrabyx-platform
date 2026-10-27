// @infrabyx/ui — server-rendered React components for every Infrabyx product (IPB-06, IPB-07).
// Tokens are in `@infrabyx/ui/tokens`, formatters and catalogues in `@infrabyx/ui/i18n`, and the
// component stylesheet in `@infrabyx/ui/styles.css` (token stylesheets: `@infrabyx/ui/tokens/<product>.css`).
export const PACKAGE_NAME = "@infrabyx/ui" as const;
export * from "./components/shell.js";
export * from "./components/footer.js";
export * from "./components/forms.js";
export * from "./components/help.js";
export * from "./components/status.js";
export * from "./components/data.js";
export * from "./components/media.js";
export { COMPONENT_CSS } from "./styles.js";
export { messages, type Messages } from "./i18n/messages.js";
