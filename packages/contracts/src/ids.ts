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
  run: "seed, job or AI run (IPB-03 §03.2)",
  evt: "internal event",
  org: "organisation (Ecosystem Spec §4.1)",
  re: "regulated entity (Ecosystem Spec §4.1)",
  brd: "brand pack (IPB-D-10)",
  idm: "port idempotency record (PL2 plan §3.5)",
  rvk: "revoked session or user (IDENTITY, IPB-02-05)",
  rls: "rule set (RULES, PL3)",
  dcs: "rule decision (RULES decision log)",
  sca: "scheduled action (workflow timers, IPB-02-80)",
  ibx: "Work Inbox item (IPB-07 §07.4.9)",
  ntf: "notification (NOTIFY)",
  dlv: "notification delivery (NOTIFY)",
  sup: "suppression entry (NOTIFY)",
  ptk: "push device token (NOTIFY)",
  inm: "in-app message (NOTIFY)",
  exj: "export job (export)",
  arc: "export archive (Ecosystem entity 40)",
  esr: "e-sign envelope (ESIGN)",
  skl: "Vidhi skill (IPB-03 §03.2)",
  tsk: "Vidhi task",
  msn: "Vidhi mission",
  sch: "Vidhi scheduled task",
  agt: "Vidhi agent identity",
  nbk: "knowledge notebook",
  src: "notebook source",
  out: "notebook output",
  fbk: "feedback item (IPB-04 feedback widget; Vidhi AI feedback, IPB-03-84)",
  img: "generated image (IMAGE_GEN)",
  idx: "retrieval index",
  chk: "retrieval chunk",
  grt: "autonomy grant",
  // PL5 (IPB-04 §04.4.1, IPB-05, IPB-08 §08.4.2; Ecosystem §5.2–§5.4).
  brv: "brand pack revision",
  pg: "CMS page",
  sec: "CMS reusable section",
  nav: "CMS navigation menu",
  ftr: "CMS footer",
  ofc: "CMS office record",
  faq: "CMS FAQ item",
  job: "CMS job posting",
  tm: "CMS team member",
  prs: "CMS press item",
  pst: "CMS blog post",
  vlg: "CMS vlog item",
  res: "CMS resource",
  lgl: "CMS legal page",
  frm: "CMS form",
  fsb: "CMS form submission",
  prc: "CMS pricing copy",
  chg: "CMS changelog entry",
  cs: "CMS case study",
  tst: "CMS testimonial",
  lp: "CMS landing page",
  gco: "CMS group company",
  rev: "CMS revision",
  cap: "CMS approval",
  med: "CMS media",
  rdr: "CMS redirect",
  clm: "Claims Register claim",
  prv: "CMS preview token",
  pol: "policy set (IPB-05)",
  pin: "policy instance (IPB-05)",
  cns: "consent receipt (Ecosystem entity 29)",
  ctx: "consent text version",
  acc: "policy acceptance record",
  vad: "vendor assurance document (IPB-08, mirrored)",
  vada: "vendor assurance acknowledgement",
  vadr: "vendor assurance request",
  nda: "NDA acceptance",
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
