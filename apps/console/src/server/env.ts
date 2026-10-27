// The console's environment (IPB-11 §11.4; PL5 plan §9.6). Read once through `@infrabyx/config/env`,
// which applies the production guards; no other file reads the process environment.
import { z } from "zod";
import { AppEnv } from "@infrabyx/contracts/env";
import { envBool, envUrl, envVar, loadAndValidate } from "@infrabyx/config/env";

/** Environments where the fixture sign-in, AUTHZ and port fixtures may run. */
export const FIXTURE_ENVS = ["local", "dev", "test", "preview"] as const;

export const consoleEnvSchema = z.object({
  APP_ENV: envVar(AppEnv, {
    desc: "Deployment environment",
    example: "local",
    required: "all",
    sens: "C",
    port: "APP",
  }),
  APP_BASE_URL: envVar(envUrl(), {
    desc: "Canonical https origin of the console",
    example: "https://studio.example.org",
    required: "all",
    sens: "C",
    port: "APP",
  }),
  APP_SITE_URL: envVar(envUrl(), {
    desc: "Origin of the public site the content is published to (preview and resource links)",
    example: "https://group.example.org",
    required: "all",
    sens: "C",
    port: "APP",
  }),
  DB_URL: envVar(envUrl(), {
    desc: "PostgreSQL URL of the platform database (through the kernel as app_rw)",
    example: "postgres://app@localhost:5432/group",
    required: "all",
    sens: "C",
    port: "DB",
  }),
  STORAGE_DIR: envVar(z.string().min(1).optional(), {
    desc: "Directory storage for brand and media files; local, dev, test and preview only",
    example: ".storage",
    required: "opt",
    sens: "C",
    port: "STORAGE",
  }),
  APP_FIXTURE_ADAPTERS: envVar(envBool().default(false), {
    desc: "Fixture sign-in and AUTHZ, and fixture CRM, billing, OH desk and trust feed; refused from staging upwards",
    example: "true",
    required: "opt",
    sens: "C",
    port: "APP",
  }),
});
export type ConsoleEnv = z.output<typeof consoleEnvSchema>;

let cached: Promise<ConsoleEnv> | undefined;

/** The validated environment; exits with code 78 on a missing or refused value (IPB-11-08). */
export function consoleEnv(): Promise<ConsoleEnv> {
  cached ??= loadAndValidate(consoleEnvSchema).then((v) => {
    const fixtures = (FIXTURE_ENVS as readonly string[]).includes(v.APP_ENV);
    if (!fixtures && (v.APP_FIXTURE_ADAPTERS || v.STORAGE_DIR))
      throw new Error(
        `APP_FIXTURE_ADAPTERS and STORAGE_DIR are refused in ${v.APP_ENV} (fixtures run in ${FIXTURE_ENVS.join(", ")} only)`,
      );
    return v;
  });
  return cached;
}
