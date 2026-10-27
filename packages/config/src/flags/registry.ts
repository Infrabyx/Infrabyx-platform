// Flag registry (IPB-09-24): every flag is registered here with owner, created date, expiry,
// default and description before code reads it. `kill.*` per IPB-02-83; `fut.*` per IPB-12 §12.5.
import { IpbError } from "@infrabyx/contracts/errors";

export const FLAG_KINDS = ["mod", "exp", "ops", "kill", "fut"] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];
export type FlagState = "proposed" | "active" | "graduating" | "removed";

export interface FlagDef {
  key: string;
  kind: FlagKind;
  /** Owner role or named owner from the register. */
  owner: string;
  created: string;
  /** ISO date; null = never expires (`kill.*`) or retired by trigger (`fut.*`). */
  expiry: string | null;
  default: boolean;
  description: string;
  state: FlagState;
  /** Not switchable (fut.ai-provenance-label). */
  locked?: boolean;
  /** Product-qualified defaults keyed by product code, e.g. "ON (UDF)" → { UDF: true }. */
  productDefaults?: Readonly<Record<string, boolean>>;
  /** Templated keys such as kill.ai.{provider}. */
  pattern?: string;
  source: string;
}

const CREATED = "2026-10-26";

const kill = <K extends string>(
  key: K,
  description: string,
  pattern?: string,
): FlagDef & { key: K } => ({
  key,
  kind: "kill",
  owner: "PLT_SECURITY_OFFICER",
  created: CREATED,
  expiry: null,
  default: false,
  description,
  state: "active",
  ...(pattern ? { pattern } : {}),
  source: "IPB-02-83, IPB-02 §02.5",
});

export const KILL_SWITCHES = [
  kill("kill.ai.all", "Disable all AI gateway calls"),
  kill("kill.ai.{provider}", "Disable one AI provider", "^kill\\.ai\\.[a-z][a-z0-9_-]*$"),
  kill(
    "kill.msg.{channel}",
    "Disable outbound messaging on one channel",
    "^kill\\.msg\\.[a-z][a-z0-9_-]*$",
  ),
  // NOTIFY channels (PL3 plan §3.5); exact keys so flags.defaults.json lists them.
  kill("kill.msg.email", "Disable outbound email"),
  kill("kill.msg.sms", "Disable outbound SMS"),
  kill("kill.msg.whatsapp", "Disable outbound WhatsApp"),
  kill("kill.msg.push", "Disable push notifications"),
  kill("kill.msg.inapp", "Disable in-app notifications"),
  kill("kill.payments", "Disable checkout and payment collection"),
  kill("kill.payouts", "Disable payouts"),
  kill("kill.signup", "Disable public sign-up"),
  kill("kill.webhooks", "Pause outbound webhooks"),
  kill("kill.mcp", "Disable the MCP server"),
  kill("kill.integrations", "Disable the integrations marketplace"),
] as const satisfies readonly FlagDef[];

/** IPB-12 §12.5 register: [slug, register default text, owner]. */
export const FUT_REGISTER = [
  ["passkeys-default", "OFF → ON by Q2 2027", "PLT_SECURITY_OFFICER"],
  ["webauthn-conditional-ui", "ON", "PLT_SECURITY_OFFICER"],
  ["webauthn-related-origins", "OFF", "PLT_SECURITY_OFFICER"],
  ["fapi2-partner-profile", "OFF", "Platform architect"],
  ["pqc-hybrid-sign", "OFF", "PLT_SECURITY_OFFICER"],
  ["tls-hybrid-kem", "ON", "PLT_RELEASE_MANAGER"],
  ["cbom-export", "OFF", "PLT_SECURITY_OFFICER"],
  ["digilocker-pull", "OFF", "FBX lead"],
  ["digilocker-vc", "OFF", "FBX lead"],
  ["vc-verify", "OFF", "PLT_SECURITY_OFFICER"],
  ["eudi-wallet-verify", "OFF", "EQ lead"],
  ["upi-credit-line", "OFF", "FBX lead"],
  ["upi-autopay-collections", "OFF", "FBX lead"],
  ["cbdc-rail", "OFF", "FBX lead"],
  ["aa-fiu", "ON where licensed", "FBX lead"],
  ["uli-gateway", "OFF", "FBX lead"],
  ["ondc-credit-channel", "OFF", "UDF lead"],
  ["dpdp-consent-manager-api", "OFF → ON after 13 Nov 2026", "PLT_DPO"],
  ["dpdp-consent-ledger", "ON", "PLT_DPO"],
  ["dpdp-sdf-controls", "OFF", "PLT_DPO"],
  ["ai-provenance-label", "ON (locked)", "PLT_LEGAL_REVIEWER"],
  ["dla-multi-lender-view", "ON (UDF)", "UDF lead"],
  ["kfs-digital-sign", "ON", "UDF lead"],
  ["outsourcing-evidence-pack", "ON", "PLT_SECURITY_OFFICER"],
  ["sebi-odr-v2", "OFF", "EQ lead"],
  ["eu-ai-act-annex3", "OFF", "PLT_LEGAL_REVIEWER"],
  ["ai-inventory", "ON", "PLT_SECURITY_OFFICER"],
  ["sbom-aibom-publish", "ON", "PLT_RELEASE_MANAGER"],
  ["mcp-server", "OFF (per tenant)", "Platform architect"],
  ["a2a-agent-card", "OFF", "Platform architect"],
  ["webmcp-page-tools", "OFF", "PLT_RELEASE_MANAGER"],
  ["edge-local-inference", "OFF", "AI lead"],
  ["sovereign-model-primary", "OFF", "AI lead"],
  ["confidential-inference", "OFF", "PLT_SECURITY_OFFICER"],
  ["otel-genai-stable", "OFF", "PLT_RELEASE_MANAGER"],
  ["guardrails-v2", "ON", "PLT_SECURITY_OFFICER"],
  ["node26-runtime", "OFF", "PLT_RELEASE_MANAGER"],
  ["nest12-esm", "OFF", "PLT_RELEASE_MANAGER"],
  ["pg19", "OFF", "PLT_RELEASE_MANAGER"],
] as const;

/**
 * Register text → registry default (PL1-D-10). "OFF → ON by/after <date>" stays OFF until an
 * ADR flips it (IPB-12-03); "ON where licensed" and "ON (UDF)" are OFF at platform with the
 * product default ON; "ON (locked)" is ON and not switchable.
 */
export function futDefault(text: string): Pick<FlagDef, "default" | "locked" | "productDefaults"> {
  if (text === "ON (locked)") return { default: true, locked: true };
  if (text === "ON where licensed") return { default: false, productDefaults: { FBX: true } };
  if (text === "ON (UDF)") return { default: false, productDefaults: { UDF: true } };
  if (text === "ON") return { default: true };
  if (text.startsWith("OFF")) return { default: false };
  throw new Error(`unknown register default "${text}"`);
}

export const FUT_FLAGS: readonly FlagDef[] = FUT_REGISTER.map(([slug, text, owner]) => ({
  key: `fut.${slug}`,
  kind: "fut",
  owner,
  created: CREATED,
  expiry: null,
  ...futDefault(text),
  description: `IPB-12 §12.4 watch item ${slug} (register default: ${text})`,
  state: "active",
  source: "IPB-12 §12.5",
}));

type FutSlug = (typeof FUT_REGISTER)[number][0];
type ExactKill = Exclude<(typeof KILL_SWITCHES)[number]["key"], `${string}{${string}}`>;
export type KillSwitchKey = ExactKill | `kill.ai.${string}` | `kill.msg.${string}`;
export type FutFlagKey = `fut.${FutSlug}`;
/** Every registered flag. Reading any other key fails typecheck (IPB-ENG-008, @IPB-09-AT-09). */
export type FlagKey = KillSwitchKey | FutFlagKey;

const TAXONOMY =
  /^(?:mod\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*|exp\.[a-z][a-z0-9_-]*|ops\.[a-z][a-z0-9_.-]*|kill\.[a-z][a-z0-9_.{}-]*|fut\.[a-z][a-z0-9-]*)$/;
const DAY = 86_400_000;
const MAX_LIFETIME_DAYS: Partial<Record<FlagKind, number>> = { exp: 60, mod: 180 };

/** Registry lint (IPB-09-24, IPB-09-25): taxonomy, required metadata and expiry rules. */
export function lintFlags(defs: readonly FlagDef[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.key)) errors.push(`${d.key}: registered twice`);
    seen.add(d.key);
    if (!TAXONOMY.test(d.key))
      errors.push(`${d.key}: not in the mod./exp./ops./kill./fut. taxonomy`);
    if (!d.key.startsWith(`${d.kind}.`))
      errors.push(`${d.key}: kind ${d.kind} does not match prefix`);
    if (!d.owner || !d.description || !/^\d{4}-\d{2}-\d{2}$/.test(d.created))
      errors.push(`${d.key}: owner, description and created date are required`);
    const max = MAX_LIFETIME_DAYS[d.kind];
    if (max !== undefined) {
      if (!d.expiry) errors.push(`${d.key}: ${d.kind}. flags need an expiry`);
      else if ((Date.parse(d.expiry) - Date.parse(d.created)) / DAY > max)
        errors.push(`${d.key}: ${d.kind}. flags expire within ${max} days`);
    }
    if (d.kind === "kill" && d.expiry !== null) errors.push(`${d.key}: kill. flags never expire`);
    if (d.kind === "kill" && d.default !== false)
      errors.push(`${d.key}: kill switches default off`);
  }
  return errors;
}

export class FlagRegistry {
  private readonly exact = new Map<string, FlagDef>();
  private readonly patterns: Array<{ re: RegExp; def: FlagDef }> = [];

  constructor(defs: readonly FlagDef[] = [...KILL_SWITCHES, ...FUT_FLAGS]) {
    const errors = lintFlags(defs);
    if (errors.length) throw new Error(`flag registry invalid:\n${errors.join("\n")}`);
    for (const d of defs) {
      if (d.pattern) this.patterns.push({ re: new RegExp(d.pattern), def: d });
      else this.exact.set(d.key, d);
    }
  }

  find(key: string): FlagDef | undefined {
    return this.exact.get(key) ?? this.patterns.find((p) => p.re.test(key))?.def;
  }

  /** Throws IPB-ENG-008 for an unregistered flag. */
  require(key: string): FlagDef {
    const d = this.find(key);
    if (!d)
      throw new IpbError("IPB-ENG-008", {
        detail: `flag "${key}" is not registered`,
        meta: { key },
      });
    return d;
  }

  all(): FlagDef[] {
    return [...this.exact.values(), ...this.patterns.map((p) => p.def)];
  }

  /** `{ key: default }` for every exact flag — the shape of flags.defaults.json (IPB-12-03). */
  defaults(): Record<string, boolean> {
    return Object.fromEntries([...this.exact.values()].map((d) => [d.key, d.default]));
  }
}

export const defaultFlagRegistry = new FlagRegistry();
