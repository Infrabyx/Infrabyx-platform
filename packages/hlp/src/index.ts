// @infrabyx/hlp (IPB-07 §07.3.4–§07.3.5): the glossary registry and "i" popover content, the
// public glossary, hlp-lint and onboarding tours.
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "@infrabyx/hlp" as const;

export * from "./entry.js";
export * from "./registry.js";
export * from "./lint.js";
export * from "./tours.js";

/** The platform's own help entries (`registry/<module>.yaml`), shipped with this package. */
export const PLATFORM_REGISTRY_DIR = fileURLToPath(new URL("../registry/", import.meta.url));
