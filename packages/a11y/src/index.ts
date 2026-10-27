// @infrabyx/a11y (IPB-06): the journey registry and its lint, the WCAG 2.2 mapping, the release
// checklist, the accessibility statement generator, the shortcut registry, the overlay scan and
// the Lighthouse evaluator. Browser checks are in `@infrabyx/a11y/playwright`; React hooks in
// `@infrabyx/a11y/hooks`.
export const PACKAGE_NAME = "@infrabyx/a11y" as const;

export * from "./journeys.js";
export * from "./mapping.js";
export * from "./checklist.js";
export * from "./statement.js";
export * from "./shortcuts.js";
export * from "./overlay.js";
export * from "./lighthouse.js";
