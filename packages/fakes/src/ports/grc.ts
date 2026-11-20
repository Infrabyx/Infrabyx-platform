// GRC fake (Finbyx PR-FBX-51, R1-D-220, ADR-0013): an in-memory GRC system of record on the
// Ecosystem Specification §9.2 contract, the CI-green alternative to `generic-grc`. It keeps the
// port's rules as every adapter must: the class (at most CONFIDENTIAL) and no personal data before
// anything is taken; each POST keyed (the caller's key, else the event's own Specification key), the
// same key and body answering the same receipt with one record, the key with another body
// `IPB-PORT-004`; incident updates in `update_seq` order (`out_of_order` at or below one taken);
// obligations in pages by an opaque cursor bound to its query (`invalid_cursor` otherwise).
import {
  GRC_MAX_PAGE,
  GRC_POST_METHODS,
  GrcObligation,
  grcRefusal,
  prepareGrcObligationQuery,
  prepareGrcPost,
  type AdapterDescriptor,
  type GrcObligationPage,
  type GrcObligationQuery,
  type GrcPort,
  type GrcPostMethod,
  type GrcReceipt,
  type PortCall,
  type PortHealth,
} from "@infrabyx/contracts/ports";
import type {
  ComplianceIssueRaisedData,
  ControlTestResultPublishedData,
  EvidenceSubmittedData,
  PolicyAttestedData,
  ReturnStatusUpdatedData,
  SecurityIncidentNotifiedData,
} from "@infrabyx/contracts/events";
import { canonicalize, sha256Hex, ulid } from "@infrabyx/crypto";

const ADAPTER = "fake-grc";

/** Inputs a GRC adapter's contract run needs. */
export interface GrcFixtures<P extends GrcPort = GrcPort> {
  /** Puts these obligations at the GRC system, replacing any it held. */
  seedObligations(p: P, obligations: GrcObligation[]): Promise<void> | void;
  /** Records the GRC system has taken so far; a keyed resend never adds one. */
  accepted(p: P): number;
}

/** The fake's fixtures. */
export const grcFakeFixtures: GrcFixtures<GrcPort> = {
  seedObligations: (p, o) => (p as FakeGrc).seedObligations(o),
  accepted: (p) => (p as FakeGrc).accepted,
};

const DEFAULT_PAGE = 50;

const encodeCursor = (offset: number, since: string): string =>
  Buffer.from(JSON.stringify({ o: offset, s: since }), "utf8").toString("base64url");
const decodeCursor = (c: string): { o: number; s: string } | undefined => {
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as {
      o?: unknown;
      s?: unknown;
    };
    return Number.isInteger(v.o) && (v.o as number) >= 0 && typeof v.s === "string"
      ? { o: v.o as number, s: v.s }
      : undefined;
  } catch {
    return undefined;
  }
};

export class FakeGrc implements GrcPort {
  readonly descriptor: AdapterDescriptor = {
    port: "GRC",
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  /** Records taken (one per key); a keyed resend never adds one. */
  accepted = 0;
  /** The data of each record taken, by resource, in order. Test hook. */
  readonly records: Array<{ resource: string; data: Record<string, unknown>; key: string }> = [];
  private obligations: GrcObligation[] = [];
  private readonly keys = new Map<string, { body: string; receipt: GrcReceipt }>();
  private readonly incidentSeq = new Map<string, number>();
  private readonly now: () => Date;

  constructor(o: { now?: () => Date; obligations?: GrcObligation[] } = {}) {
    this.now = o.now ?? (() => new Date());
    if (o.obligations) this.seedObligations(o.obligations);
  }

  /** Test hook: the obligations the GRC system holds, replacing any (checked against §9.2). */
  seedObligations(obligations: GrcObligation[]): void {
    this.obligations = obligations
      .map((x) => GrcObligation.parse(x))
      .sort(
        (a, b) =>
          a.updated_at.localeCompare(b.updated_at) ||
          a.obligation_ref.localeCompare(b.obligation_ref),
      );
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: this.now().toISOString() };
  }

  async listObligations(q?: GrcObligationQuery, call?: PortCall): Promise<GrcObligationPage> {
    const query = prepareGrcObligationQuery(ADAPTER, q, call);
    const since = query.updatedSince ?? "";
    let offset = 0;
    if (query.cursor !== undefined) {
      const c = decodeCursor(query.cursor);
      if (!c || c.s !== since)
        throw grcRefusal(
          "IPB-PORT-001",
          ADAPTER,
          "invalid_cursor",
          "a cursor this query did not give",
        );
      offset = c.o;
    }
    const t = since ? Date.parse(since) : -Infinity;
    const all = this.obligations.filter((o) => Date.parse(o.updated_at) >= t);
    const limit = Math.min(query.limit ?? DEFAULT_PAGE, GRC_MAX_PAGE);
    const items = all.slice(offset, offset + limit).map((o) => structuredClone(o));
    const next = offset + limit < all.length ? encodeCursor(offset + limit, since) : undefined;
    return { items, ...(next ? { nextCursor: next } : {}) };
  }

  private async post(method: GrcPostMethod, raw: unknown, call?: PortCall): Promise<GrcReceipt> {
    const post = prepareGrcPost(ADAPTER, method, raw, call);
    const body = sha256Hex(canonicalize(post.data));
    const keyed = `${post.resource}|${post.idempotencyKey}`;
    const prior = this.keys.get(keyed);
    if (prior) {
      if (prior.body !== body)
        throw grcRefusal(
          "IPB-PORT-004",
          ADAPTER,
          "idempotency_conflict",
          "this key was taken with another body",
        );
      return structuredClone(prior.receipt);
    }
    if (method === "notifyIncident") {
      const id = String(post.data.incident_id);
      const seq = post.data.update_seq as number;
      const last = this.incidentSeq.get(id);
      if (last !== undefined && seq <= last)
        throw grcRefusal(
          "IPB-PORT-001",
          ADAPTER,
          "out_of_order",
          `update ${seq} of this incident is at or below the last one taken`,
        );
      this.incidentSeq.set(id, seq);
    }
    const receipt: GrcReceipt = {
      resource: GRC_POST_METHODS[method].resource,
      ref: `fake-grc-${ulid().toLowerCase()}`,
      idempotencyKey: post.idempotencyKey,
      adapter: ADAPTER,
      receivedAt: this.now().toISOString(),
    };
    this.keys.set(keyed, { body, receipt });
    this.records.push({
      resource: post.resource,
      data: structuredClone(post.data),
      key: post.idempotencyKey,
    });
    this.accepted++;
    return structuredClone(receipt);
  }

  publishControlTestResult(d: ControlTestResultPublishedData, call?: PortCall) {
    return this.post("publishControlTestResult", d, call);
  }
  submitEvidence(d: EvidenceSubmittedData, call?: PortCall) {
    return this.post("submitEvidence", d, call);
  }
  raiseIssue(d: ComplianceIssueRaisedData, call?: PortCall) {
    return this.post("raiseIssue", d, call);
  }
  notifyIncident(d: SecurityIncidentNotifiedData, call?: PortCall) {
    return this.post("notifyIncident", d, call);
  }
  updateReturnStatus(d: ReturnStatusUpdatedData, call?: PortCall) {
    return this.post("updateReturnStatus", d, call);
  }
  recordPolicyAttestation(d: PolicyAttestedData, call?: PortCall) {
    return this.post("recordPolicyAttestation", d, call);
  }
}
