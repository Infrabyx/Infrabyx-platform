// Seeds never run in production-group environments (IPB-11-14, IPB-11-22; PL1-D-06/D-17).
import { SEED_REFUSED_ENVS, type AppEnv } from "@infrabyx/contracts/env";
import { IpbError } from "@infrabyx/contracts/errors";

export const SEED_PROFILES = ["dev", "demo", "test", "load"] as const;
export type SeedProfile = (typeof SEED_PROFILES)[number];

export interface SeedEnv {
  APP_ENV: AppEnv;
  SEED_ENABLED?: boolean;
  SEED_LOAD_CONFIRM?: string;
}

/** Throws IPB-SEED-001 in prod/dr/pre-prod or unless SEED_ENABLED=true; IPB-SEED-002 for an unconfirmed load profile. */
export function assertSeedAllowed(env: SeedEnv, profile?: SeedProfile): void {
  if (SEED_REFUSED_ENVS.includes(env.APP_ENV)) {
    throw new IpbError("IPB-SEED-001", {
      detail: `seeding is refused in ${env.APP_ENV}`,
      meta: { env: env.APP_ENV },
    });
  }
  if (env.SEED_ENABLED !== true) {
    throw new IpbError("IPB-SEED-001", {
      detail: "SEED_ENABLED must be true",
      meta: { env: env.APP_ENV },
    });
  }
  if (profile === "load" && env.SEED_LOAD_CONFIRM !== "yes") {
    throw new IpbError("IPB-SEED-002", { detail: "the load profile needs SEED_LOAD_CONFIRM=yes" });
  }
}
