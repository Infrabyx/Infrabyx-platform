// Fakes and fixtures for the PL5 website ports (PL5 plan §8): CONSENT, CRM, HR, SUPPORT, BACKLOG,
// TRUST, BILLING (catalogue), TAG_MANAGER, ANALYTICS, EGRESS, CLAIMS and LAW_REGISTER. Every fake
// records what it received so tests can assert minimisation; none calls a network. The fixture
// catalogue carries no real price (the repository is public) and the fixture trust feed no real
// certificate: only a sub-processor list and an accessibility statement.
import type {
  AdapterDescriptor,
  AnalyticsPort,
  ApplicationInput,
  BacklogPort,
  BillingCataloguePort,
  Catalogue,
  ClaimsPort,
  ConsentChoice,
  ConsentPort,
  ConsentReceipt,
  ConsentRecordInput,
  ConsentState,
  CrmPort,
  EgressPort,
  FeedbackStatus,
  GatedScript,
  HrPort,
  LawRegisterPort,
  LeadInput,
  PortHealth,
  SupportPort,
  TagManagerPort,
  TicketInput,
  TrustPort,
  VadDocument,
} from "@infrabyx/contracts/ports";
import { ConsentRecordInput as ConsentRecordSchema } from "@infrabyx/contracts/ports";
import { newId, sha256Hex } from "@infrabyx/crypto";

const up = async (): Promise<PortHealth> => ({
  status: "up",
  latency_ms: 0,
  checked_at: new Date().toISOString(),
});
const desc = (port: string, adapter: string): AdapterDescriptor => ({
  port,
  adapter,
  residency: "IN",
  maxDataClass: "CONFIDENTIAL",
});

/** In-memory consent ledger: append-only, like the PostgreSQL adapter in `@infrabyx/consent`. */
export class FakeConsentLedger implements ConsentPort {
  readonly descriptor = desc("CONSENT", "fake");
  readonly records: (ConsentRecordInput & ConsentReceipt)[] = [];
  health = up;
  async recordConsent(input: ConsentRecordInput): Promise<ConsentReceipt> {
    const parsed = ConsentRecordSchema.parse(input);
    const receipt = { receiptId: newId("cns"), recordedAt: new Date().toISOString() };
    this.records.push({ ...parsed, ...receipt });
    return receipt;
  }
  async getConsent(cid: string): Promise<ConsentState | null> {
    const last = [...this.records].reverse().find((r) => r.cid === cid && r.choice);
    if (!last?.choice) return null;
    return {
      receiptId: last.receiptId,
      choice: last.choice as ConsentChoice,
      textVersion: last.textVersion,
      region: last.region,
      gpc: last.gpc,
      recordedAt: last.recordedAt,
    };
  }
}

/** CRM fixture: keeps the leads it was given (the platform itself never stores field values). */
export class FakeCrm implements CrmPort {
  readonly descriptor = desc("CRM", "fixture");
  readonly leads: (LeadInput & { leadId: string })[] = [];
  /** Set to make the next call fail, to test that nothing is kept on failure. */
  failNext = false;
  health = up;
  async upsertLead(input: LeadInput): Promise<{ leadId: string }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("CRM unavailable (fixture)");
    }
    const leadId = `lead_${this.leads.length + 1}`;
    this.leads.push({ ...input, leadId });
    return { leadId };
  }
}

export class FakeHr implements HrPort {
  readonly descriptor = desc("HR", "fixture");
  readonly applications: (ApplicationInput & { applicationId: string })[] = [];
  health = up;
  async createApplication(input: ApplicationInput): Promise<{ applicationId: string }> {
    const applicationId = `app_${this.applications.length + 1}`;
    this.applications.push({ ...input, applicationId });
    return { applicationId };
  }
}

/** SUPPORT and BACKLOG fixture with a settable status per reference (the OH status loop). */
export class FakeOhDesk implements SupportPort, BacklogPort {
  readonly descriptor = desc("SUPPORT", "fixture");
  readonly tickets: (TicketInput & { ref: string })[] = [];
  readonly statuses = new Map<string, FeedbackStatus>();
  health = up;
  async createTicket(input: TicketInput): Promise<{ ref: string }> {
    const ref = `OH-${String(this.tickets.length + 1).padStart(5, "0")}`;
    this.tickets.push({ ...input, ref });
    this.statuses.set(ref, "RECEIVED");
    return { ref };
  }
  async createIdea(input: Omit<TicketInput, "kind"> & { kind: string }): Promise<{ ref: string }> {
    return this.createTicket({ ...(input as TicketInput), kind: "support" });
  }
  async getStatus(ref: string): Promise<FeedbackStatus> {
    return this.statuses.get(ref) ?? "RECEIVED";
  }
}

const fixtureDoc = (
  o: Partial<VadDocument> & Pick<VadDocument, "vad_id" | "title">,
): VadDocument => ({
  category: "STATEMENT",
  cadence: "EVENT",
  valid_from: "2026-10-01",
  valid_until: null,
  version: 1,
  storage_ref: `assurance/fixture/${o.vad_id}.pdf`,
  sha256: sha256Hex(`fixture:${o.vad_id}`),
  visibility: "PUBLIC",
  publication_targets: ["OH"],
  nda_required: false,
  summary: "",
  state: "PUBLISHED",
  ...o,
});

/** The fixture trust feed: no certification is claimed, because none is held. */
export function fixtureTrustDocuments(): VadDocument[] {
  return [
    fixtureDoc({
      vad_id: "vad_01JB00000000000000000SUBP1",
      title: "Sub-processor list",
      summary: "The organisations that process data on our behalf, their purpose and location.",
    }),
    fixtureDoc({
      vad_id: "vad_01JB00000000000000000A11Y1",
      title: "Accessibility statement",
      category: "ACCESSIBILITY_STATEMENT",
      summary: "How we test against WCAG 2.2 AA and the known issues we are fixing.",
    }),
    fixtureDoc({
      vad_id: "vad_01JB00000000000000000SOC21",
      title: "SOC 2 Type II report",
      category: "AUDIT_REPORT",
      visibility: "GATED_NDA",
      nda_required: true,
      summary: "Fixture of a gated document; never shown on the public Trust Centre.",
    }),
  ];
}

export class FakeTrustFeed implements TrustPort {
  readonly descriptor = desc("TRUST", "fixture");
  docs: VadDocument[];
  reachable = true;
  constructor(docs: VadDocument[] = fixtureTrustDocuments()) {
    this.docs = docs;
  }
  health = up;
  async listDocuments(): Promise<VadDocument[]> {
    if (!this.reachable) throw new Error("OH unreachable (fixture)");
    return structuredClone(this.docs);
  }
  async fileUrl(vadId: string): Promise<{ url: string; sha256: string; expiresAt: string }> {
    if (!this.reachable) throw new Error("OH unreachable (fixture)");
    const d = this.docs.find((x) => x.vad_id === vadId);
    if (!d) throw new Error(`unknown ${vadId}`);
    return {
      url: `https://assurance.example.org/${d.storage_ref}?sig=fixture`,
      sha256: d.sha256,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
  }
  async publicationDigest(): Promise<string> {
    return sha256Hex(
      this.docs
        .map((d) => `${d.vad_id}:${d.version}:${d.state}:${d.sha256}`)
        .sort()
        .join("\n"),
    );
  }
}

/** A catalogue with made-up plans and round placeholder amounts; never a real price. */
export function fixtureCatalogue(product = "OH"): Catalogue {
  const plans = [
    {
      plan_key: "fixture_basic",
      name: "Fixture Basic",
      features: ["fixture.feature_a"],
      prices: [
        {
          currency: "INR",
          amount_minor: 100_00,
          period: "month" as const,
          gst_rate_bp: 1800,
          tax_inclusive: false,
        },
      ],
      trial_days: null,
    },
    {
      plan_key: "fixture_plus",
      name: "Fixture Plus",
      features: ["fixture.feature_a", "fixture.feature_b"],
      prices: [
        {
          currency: "INR",
          amount_minor: 200_00,
          period: "month" as const,
          gst_rate_bp: 1800,
          tax_inclusive: false,
        },
      ],
      trial_days: 14,
    },
  ];
  return {
    product,
    brand_pack_id: null,
    catalogue_version: "fixture-1",
    catalogue_hash: sha256Hex(JSON.stringify(plans)),
    plans,
    coupons: [],
    fetched_at: new Date().toISOString(),
  };
}

export class FakeCatalogue implements BillingCataloguePort {
  readonly descriptor = desc("BILLING", "fixture");
  catalogue: Catalogue | null;
  calls = 0;
  constructor(c: Catalogue | null = fixtureCatalogue()) {
    this.catalogue = c;
  }
  health = up;
  async getCatalogue(): Promise<Catalogue> {
    this.calls++;
    if (!this.catalogue) throw new Error("catalogue unavailable (fixture)");
    return structuredClone(this.catalogue);
  }
}

/** The launch adapters (OWN-09): nothing to load, nothing tracked. */
export class NoneTagManager implements TagManagerPort {
  readonly descriptor = desc("TAG_MANAGER", "none");
  health = up;
  scripts(): GatedScript[] {
    return [];
  }
}

export class NoneAnalytics implements AnalyticsPort {
  readonly descriptor = desc("ANALYTICS", "none");
  health = up;
  async track(): Promise<void> {}
}

/** Egress fixture: serves canned responses for allow-listed URLs only. */
export class FakeEgress implements EgressPort {
  readonly descriptor = desc("EGRESS", "fixture");
  readonly requested: string[] = [];
  constructor(private readonly responses: Record<string, string> = {}) {}
  health = up;
  async fetch(url: string) {
    this.requested.push(url);
    const body = this.responses[url];
    if (body === undefined) throw new Error(`not allow-listed (fixture): ${url}`);
    return { status: 200, contentType: "application/json", body: new TextEncoder().encode(body) };
  }
}

/** Claims gate fixture: blocks any text containing one of the given phrases. */
export class FakeClaimsGate implements ClaimsPort {
  readonly descriptor = desc("CLAIMS", "fixture");
  constructor(private readonly blocked: readonly string[] = []) {}
  health = up;
  async check(input: { text: string }) {
    const hit = this.blocked.find((b) => input.text.toLowerCase().includes(b.toLowerCase()));
    return hit ? { status: "BLOCKED" as const, reason: hit } : { status: "PASS" as const };
  }
}

/** Law register fixture: the IPB-04-45 outdated-law examples are repealed or superseded. */
export class FakeLawRegister implements LawRegisterPort {
  readonly descriptor = desc("LAW_REGISTER", "fixture");
  health = up;
  async checkCitations(
    citations: readonly string[],
  ): ReturnType<LawRegisterPort["checkCitations"]> {
    const stale: Record<string, string> = {
      "section 66a of the it act": "struck down (Shreya Singhal, 2015)",
      "companies act 1956": "Companies Act 2013",
      "privacy shield": "EU–US Data Privacy Framework",
      "rbi 2017 nbfc outsourcing directions":
        "RBI (NBFC – Managing Risks in Outsourcing) Directions 2025",
    };
    return citations.map((c) => {
      const key = Object.keys(stale).find((k) => c.toLowerCase().includes(k));
      return key
        ? { citation: c, status: "superseded" as const, replacement: stale[key]! }
        : { citation: c, status: "current" as const };
    });
  }
}
