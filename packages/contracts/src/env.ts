// Environment catalogue (IPB-09-15, binding) and guard groups (IPB-11 §11.2).
import { z } from "zod";

export const APP_ENVS = [
  "local",
  "dev",
  "test",
  "preview",
  "staging",
  "pre-prod",
  "demo",
  "prod",
  "dr",
] as const;
export const AppEnv = z.enum(APP_ENVS);
export type AppEnv = z.infer<typeof AppEnv>;

/** Environments where every prod/dr rule applies (IPB-11 §11.2: pre-prod holds a production snapshot). */
export const PROD_GUARD_ENVS: readonly AppEnv[] = ["prod", "dr", "pre-prod"];
/** Environments where every staging rule applies (staging, plus pre-prod and demo per IPB-11 §11.2) and every prod-group env. */
export const STAGING_GUARD_ENVS: readonly AppEnv[] = ["staging", "pre-prod", "demo", "prod", "dr"];
/** Environments where secrets must be `secret://` references (IPB-11 §11.4.1). */
export const SECRET_REF_ENVS: readonly AppEnv[] = STAGING_GUARD_ENVS;
/** Environments where seeds and seed credentials are refused (IPB-11-14, IPB-11-22; PL1-D-06). */
export const SEED_REFUSED_ENVS: readonly AppEnv[] = ["prod", "dr", "pre-prod"];
/** Environments where Supabase hosts are forbidden (IPB-01 §01.4.11 rule 6). */
export const NO_SUPABASE_ENVS: readonly AppEnv[] = ["staging", "pre-prod", "prod", "dr"];

export const isProdGuarded = (e: AppEnv): boolean => PROD_GUARD_ENVS.includes(e);
export const isStagingGuarded = (e: AppEnv): boolean => STAGING_GUARD_ENVS.includes(e);
export const isSeedRefused = (e: AppEnv): boolean => SEED_REFUSED_ENVS.includes(e);

/** Product codes (IPB-11 §11.4.3 `APP_PRODUCT`). */
export const PRODUCTS = ["LD", "LDC", "EQ", "FBX", "UDF", "OH"] as const;
export const ProductCode = z.enum(PRODUCTS);
export type ProductCode = z.infer<typeof ProductCode>;

/** Seed email domain label per product (IPB-11-33). */
export const PRODUCT_EMAIL_LABEL: Readonly<Record<ProductCode, string>> = Object.freeze({
  LD: "lawdocs",
  LDC: "ldc",
  EQ: "equator",
  FBX: "finbyx",
  UDF: "udofin",
  OH: "ophub",
});
