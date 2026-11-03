// CAPTCHA port (Udofin PR-UDF-029; ADR-0004; R1-D-50): server-side validation of a challenge
// token from a public form. Only the token and the site's secret go to the vendor: never the
// customer's IP address, login, name or any other identifier. A token is valid once. A vendor that
// reports an expired and a reused token with one code (Turnstile) is read as `duplicate`.
import { z } from "zod";
import type { Port } from "./common.js";

export const CaptchaVerifyRequest = z.object({
  /** The widget's response token, as the browser sent it. */
  token: z.string().min(1).max(4096),
  /** The action the page declared (Turnstile `action`), checked when given. */
  expectedAction: z
    .string()
    .regex(/^[a-z0-9_-]{1,32}$/)
    .optional(),
  /** The hostname the widget ran on, checked when given. */
  expectedHostname: z
    .string()
    .regex(/^[a-z0-9.-]{1,253}$/)
    .optional(),
});
export type CaptchaVerifyRequest = z.infer<typeof CaptchaVerifyRequest>;

export const CAPTCHA_FAILURES = [
  "invalid",
  "expired",
  "duplicate",
  "action_mismatch",
  "hostname_mismatch",
] as const;
export type CaptchaFailure = (typeof CAPTCHA_FAILURES)[number];

export type CaptchaVerdict =
  | { ok: true; hostname?: string; action?: string; challengedAt?: string }
  | { ok: false; reason: CaptchaFailure };

export interface CaptchaPort extends Port {
  /**
   * Validate a token. A refused or reused token is a verdict, not an error; an unreachable vendor
   * throws `IPB-PORT-002`, so a caller under attack fails closed.
   */
  verify(req: CaptchaVerifyRequest): Promise<CaptchaVerdict>;
}
