// The site's environment (IPB-11 §11.4; PL5 plan §9.3). Read once through `@infrabyx/config/env`,
// which applies the production guards; no other file reads the process environment.
import { z } from "zod";
import { AppEnv } from "@infrabyx/contracts/env";
import { envBool, envUrl, envVar, loadAndValidate } from "@infrabyx/config/env";

/** Environments where fixture adapters and directory storage may run (never demo, staging or above). */
export const FIXTURE_ENVS = ["local", "dev", "test", "preview"] as const;

export const siteEnvSchema = z.object({
  APP_ENV: envVar(AppEnv, {
    desc: "Deployment environment",
    example: "local",
    required: "all",
    sens: "C",
    port: "APP",
  }),
  APP_BASE_URL: envVar(envUrl(), {
    desc: "Canonical https origin of the site (sitemap, canonical links, security.txt)",
    example: "https://group.example.org",
    required: "all",
    sens: "C",
    port: "APP",
  }),
  APP_BRAND_PRODUCT: envVar(z.enum(["GRP", "LD", "LDC", "EQ", "FBX", "UDF", "OH"]).default("GRP"), {
    desc: "Brand product whose default pack the site serves when the host is not mapped",
    example: "GRP",
    required: "opt",
    sens: "C",
    port: "APP",
  }),
  DB_URL: envVar(envUrl(), {
    desc: "PostgreSQL URL of the platform database (read through the kernel as app_rw)",
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
    desc: "Use the fixture CRM, HR, OH desk and trust feed; refused from staging upwards",
    example: "true",
    required: "opt",
    sens: "C",
    port: "APP",
  }),
});
export type SiteEnv = z.output<typeof siteEnvSchema>;

let cached: Promise<SiteEnv> | undefined;

/** The validated environment; exits with code 78 on a missing or refused value (IPB-11-08). */
export function siteEnv(): Promise<SiteEnv> {
  cached ??= loadAndValidate(siteEnvSchema).then((v) => {
    const fixtures = (FIXTURE_ENVS as readonly string[]).includes(v.APP_ENV);
    if (!fixtures && (v.APP_FIXTURE_ADAPTERS || v.STORAGE_DIR))
      throw new Error(
        `APP_FIXTURE_ADAPTERS and STORAGE_DIR are refused in ${v.APP_ENV} (fixtures run in ${FIXTURE_ENVS.join(", ")} only)`,
      );
    return v;
  });
  return cached;
}
