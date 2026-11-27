// The default applicability packs (owner answer 6, R1-D-301): the owner's rule tables, versioned,
// built by scripts/app-packs.mjs from docs/regulatory-models and checked against the filed
// workbooks' formulas. A product may load a stricter pack of its own; it is checked the same way.
import { APP_M01 } from "./app-m01.js";
import { APP_M02 } from "./app-m02.js";
import { APP_M03 } from "./app-m03.js";
import { APP_M04 } from "./app-m04.js";
import { APP_M05 } from "./app-m05.js";
import { APP_M06 } from "./app-m06.js";
import { APP_M07 } from "./app-m07.js";

export { APP_M01, APP_M02, APP_M03, APP_M04, APP_M05, APP_M06, APP_M07 };

/** The default pack of each model, by model code. */
export const DEFAULT_APPLICABILITY_PACKS = Object.freeze({
  "APP-M01": APP_M01,
  "APP-M02": APP_M02,
  "APP-M03": APP_M03,
  "APP-M04": APP_M04,
  "APP-M05": APP_M05,
  "APP-M06": APP_M06,
  "APP-M07": APP_M07,
});
