// Plain-text rules shared by the event payloads (internal: not exported from the package index).
// `lenderText` and `LINK_IN_TEXT` were first written for the origination events (R1-D-232) and are
// reused by the execution pack's `re_instructions` (PR-UDF-061 item 18; R1-D-252).
import { z } from "zod";

/** A control character other than tab, line feed and carriage return. */
export const isControl = (ch: string): boolean => {
  const c = ch.charCodeAt(0);
  return (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f;
};

/** The lender's own words (a status, a reason, terms): plain text, no control characters. */
export const lenderText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => ![...v].some(isControl), "plain text");

/** A URL or a web address inside text: a payment instruction carries none (R1-D-232). */
export const LINK_IN_TEXT =
  /\b[a-z][a-z0-9+.-]*:\/\/|\bupi:|www\.|\b[a-z0-9-]+\.(?:in|com|net|org|co|io|app|link|ly)\//i;

/** The lender's words with no link (R1-D-232's rule): plain text, 1 to `max` characters. */
export const linkFreeText = (max: number) =>
  lenderText(max).refine((v) => !LINK_IN_TEXT.test(v), "no link");
