// The public Trust Centre (`/trust`, IPB-08 §08.3.3; `@IPB-08-AT-04`, `-17`; PL5 plan §7.2) and
// `/.well-known/security.txt` (RFC 9116). The Trust Centre is built from the mirror only:
//   - certifications actually held: PUBLIC, VISIBLE certificates whose validity has not ended;
//   - an expired or withdrawn certificate shows its claim's fallback wording, never a badge;
//   - "in progress" and "planned" items carry a target quarter and never a badge (IPB-08-25);
//   - public documents (sub-processor list, accessibility statement, policy and VAPT summaries);
//   - audit reports, insurance and anything gated are never linked: only a count for the
//     "Request access" action (IPB-08-13, 08-26);
//   - when OH has not been heard from for 7 days the page says "as of" (Ecosystem STALE).
import type { MirrorRow, TrustMirror } from "./mirror.js";

export interface PlannedItem {
  name: string;
  status: "in_progress" | "planned";
  /** `2027-Q2`; required: a plan without a quarter is not shown (IPB-08-25). */
  targetQuarter: string;
}

export interface CertificationClaim {
  /** The certification's IPB-08 type key (`cert_iso27001`) the claim rests on. */
  typeKey: string;
  clmId: string;
  /** The Claims Register's wording when the evidence lapses (`@IPB-08-AT-04`). */
  fallbackText: string;
}

export interface TrustCentre {
  certifications: {
    vadId: string;
    title: string;
    issuer: string | null;
    validUntil: string | null;
    summary: string;
    badge: boolean;
  }[];
  /** Claims whose evidence lapsed: shown as their fallback wording, without a badge. */
  fallbacks: { clmId: string; text: string }[];
  planned: { name: string; status: PlannedItem["status"]; targetQuarter: string; badge: false }[];
  documents: {
    vadId: string;
    title: string;
    category: MirrorRow["category"];
    summary: string;
    validFrom: string;
    sha256: string;
  }[];
  gatedAvailable: number;
  asOf: string | null;
  stale: boolean;
  links: { status?: string; vdp: string; dpaRequest: string; requestAccess: string };
}

const PUBLIC_DOCUMENTS: readonly MirrorRow["category"][] = [
  "STATEMENT",
  "ACCESSIBILITY_STATEMENT",
  "POLICY",
  "PENTEST_SUMMARY",
  "DPA",
  "BOM",
  "EXIT_RUNBOOK",
];
const QUARTER = /^20\d{2}-Q[1-4]$/;
const day = (d: unknown): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);

export async function trustCentre(
  mirror: TrustMirror,
  o: {
    planned?: readonly PlannedItem[];
    claims?: readonly CertificationClaim[];
    links?: { status?: string; vdp?: string; dpaRequest?: string; requestAccess?: string };
    now?: Date;
  } = {},
): Promise<TrustCentre> {
  const today = (o.now ?? new Date()).toISOString().slice(0, 10);
  const rows = await mirror.rows();
  const s = await mirror.staleness();
  const current = (r: MirrorRow) => {
    const until = day(r.valid_until);
    return r.oh_state === "PUBLISHED" && (!until || until >= today);
  };
  const shown = rows.filter((r) => r.mirror_state === "VISIBLE");
  const publicRows = shown.filter((r) => r.visibility === "PUBLIC");
  const certs = publicRows.filter((r) => r.category === "CERTIFICATE" && current(r));
  const heldTypes = new Set(certs.map((c) => c.type_key).filter(Boolean));
  // A claim lapses when no current certificate of its type is held (expired, withdrawn, missing).
  const fallbacks = (o.claims ?? [])
    .filter((c) => !heldTypes.has(c.typeKey))
    .map((c) => ({ clmId: c.clmId, text: c.fallbackText }));
  return {
    certifications: certs.map((c) => ({
      vadId: c.vad_id,
      title: c.title,
      issuer: c.issuer_name,
      validUntil: day(c.valid_until),
      summary: c.summary,
      badge: (o.claims ?? []).some((x) => x.typeKey === c.type_key),
    })),
    fallbacks,
    planned: (o.planned ?? [])
      .filter((p) => QUARTER.test(p.targetQuarter))
      .map((p) => ({
        name: p.name,
        status: p.status,
        targetQuarter: p.targetQuarter,
        badge: false,
      })),
    documents: publicRows
      .filter((r) => PUBLIC_DOCUMENTS.includes(r.category) && current(r))
      .map((r) => ({
        vadId: r.vad_id,
        title: r.title,
        category: r.category,
        summary: r.summary,
        validFrom: day(r.valid_from)!,
        sha256: r.sha256,
      })),
    gatedAvailable: shown.filter((r) => r.visibility !== "PUBLIC" && current(r)).length,
    asOf: s.asOf,
    stale: s.stale,
    links: {
      ...(o.links?.status ? { status: o.links.status } : {}),
      vdp: o.links?.vdp ?? "/.well-known/security.txt",
      dpaRequest: o.links?.dpaRequest ?? "/dpa-request",
      requestAccess: o.links?.requestAccess ?? "/trust/request",
    },
  };
}

/**
 * `/.well-known/security.txt` (RFC 9116; IPB-02 VDP). `Expires` is required and at most a year
 * away; the file is regenerated on every build, so it never lapses while the site is maintained.
 */
export function securityTxt(o: {
  contacts: readonly string[];
  canonical: string;
  policy: string;
  languages?: readonly string[];
  expires?: Date;
  now?: Date;
}): string {
  const now = o.now ?? new Date();
  const expires = o.expires ?? new Date(now.getTime() + 180 * 86_400_000);
  if (expires.getTime() > now.getTime() + 365 * 86_400_000 || expires <= now)
    throw new Error("security.txt Expires must be in the future and within one year");
  if (!o.contacts.length) throw new Error("security.txt needs at least one Contact");
  const uri = (c: string) =>
    /^(mailto:|https:\/\/|tel:)/.test(c) ? c : c.includes("@") ? `mailto:${c}` : c;
  for (const u of [o.canonical, o.policy])
    if (!u.startsWith("https://")) throw new Error("security.txt URIs must be https");
  return [
    ...o.contacts.map((c) => `Contact: ${uri(c)}`),
    `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    `Policy: ${o.policy}`,
    `Preferred-Languages: ${(o.languages ?? ["en", "hi"]).join(", ")}`,
    `Canonical: ${o.canonical}`,
    "",
  ].join("\n");
}
