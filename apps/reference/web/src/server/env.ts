// The web app's environment (IPB-11 §11.4; PL6 plan §8.3). Read once through `@infrabyx/config/env`,
// which applies the production guards; no other file reads the process environment.
import { z } from "zod";
import { AppEnv } from "@infrabyx/contracts/env";
import { envUrl, envVar, loadAndValidate } from "@infrabyx/config/env";

/** Environments where the API may be reached over plain HTTP on loopback (the Compose stack). */
export const LOOPBACK_ENVS = ["local", "dev", "test", "preview"] as const;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export const webEnvSchema = z.object({
  APP_ENV: envVar(AppEnv, {
    desc: "Deployment environment",
    example: "local",
    required: "all",
    sens: "C",
    port: "APP",
  }),
  APP_BASE_URL: envVar(envUrl(), {
    desc: "Origin of this web app: the browser's only origin (sign-in, cookies, pages)",
    example: "https://app.example.test",
    required: "all",
    sens: "C",
    port: "APP",
  }),
  APP_API_URL: envVar(envUrl(), {
    desc: "Origin of the reference API this app calls server to server; https, or loopback HTTP below staging",
    example: "https://api.internal.example.test",
    required: "all",
    sens: "C",
    port: "APP",
  }),
});
export type WebEnv = z.output<typeof webEnvSchema>;

/** Refusals after parsing: plain HTTP to the API only on loopback, and only below staging (IPB-SEC-018). */
export function checkWebEnv(v: WebEnv): WebEnv {
  const api = new URL(v.APP_API_URL);
  if (api.protocol !== "https:") {
    const loopbackEnv = (LOOPBACK_ENVS as readonly string[]).includes(v.APP_ENV);
    if (!loopbackEnv || !LOOPBACK.has(api.hostname))
      throw new Error(
        `APP_API_URL must be https in ${v.APP_ENV} (plain HTTP is allowed to loopback in ${LOOPBACK_ENVS.join(", ")} only)`,
      );
  }
  return v;
}

let cached: Promise<WebEnv> | undefined;

/** The validated environment; exits with code 78 on a missing or refused value (IPB-11-08). */
export function webEnv(): Promise<WebEnv> {
  cached ??= loadAndValidate(webEnvSchema).then(checkWebEnv);
  return cached;
}
