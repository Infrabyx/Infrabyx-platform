// Identifier formats: prefix + ULID (IPB-01 §01.4.6; Ecosystem Spec §5.1).
// Format only; generation lives in @infrabyx/crypto (randomness is a crypto concern, IPB-12-05).
import { z } from "zod";

/** Crockford base32 ULID (26 characters, first character 0–7). */
export const ULID_PATTERN = "[0-7][0-9A-HJKMNP-TV-Z]{25}";
export const ULID_REGEX = new RegExp(`^${ULID_PATTERN}$`);

/** Prefixes used by the PL1 kernel. Products register their own (e.g. `doc`, `cas`). */
export const ID_PREFIXES = {
  tnt: "tenant",
  ent: "legal entity",
  usr: "user",
  mbr: "membership",
  apr: "approval request",
  apd: "approval decision",
  bgr: "break-glass grant",
  imp: "impersonation session",
  led: "audit ledger entry",
  anc: "audit anchor",
  set: "setting value",
  run: "seed or job run",
  evt: "internal event",
  org: "organisation (Ecosystem Spec §4.1)",
  re: "regulated entity (Ecosystem Spec §4.1)",
  brd: "brand pack (IPB-D-10)",
  idm: "port idempotency record (PL2 plan §3.5)",
} as const;
export type IdPrefix = keyof typeof ID_PREFIXES | (string & {});

/** Reserved well-known IDs (IPB-11-26 platform, demo and sandbox tenants). */
export const RESERVED_IDS = ["tnt_platform", "tnt_demo", "tnt_sandbox"] as const;
export const PLATFORM_TENANT_ID = "tnt_platform";

const PREFIX_REGEX = /^[a-z]{2,6}$/;

/** Zod schema for `<prefix>_<ULID>`; reserved IDs with the same prefix are accepted. */
export function idSchema(prefix: IdPrefix) {
  if (!PREFIX_REGEX.test(prefix)) throw new Error(`invalid id prefix "${prefix}"`);
  const re = new RegExp(`^${prefix}_${ULID_PATTERN}$`);
  const reserved = RESERVED_IDS.filter((r) => r.startsWith(`${prefix}_`)) as readonly string[];
  return z
    .string()
    .refine((v) => re.test(v) || reserved.includes(v), { message: `expected ${prefix}_<ULID>` });
}

/** Any prefixed ID. */
export const AnyId = z
  .string()
  .regex(
    new RegExp(`^[a-z]{2,6}_(${ULID_PATTERN}|[a-z][a-z0-9]{1,30})$`),
    "expected <prefix>_<ULID>",
  );

export function prefixOf(id: string): string {
  const i = id.indexOf("_");
  return i > 0 ? id.slice(0, i) : "";
}

export const TenantId = idSchema("tnt");
export type TenantId = string;
