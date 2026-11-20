// GRC reference adapter `generic-grc` (Finbyx PR-FBX-51, R1-D-220, ADR-0013): the Ecosystem
// Specification §9.2 generic GRC connector contract, spoken over the egress client to one configured
// counterparty (LawDocsComply's connector, Finbyx's embedded module, or an RE's tool behind a certified
// adapter). No SDK, no vendor (IPB-02-43). Every shape below that §9.2 and §6.15 do not fix is
// STUB-SHAPED, TO CONFIRM AGAINST THE FIRST COUNTERPARTY'S SANDBOX ([VERIFY]), each in one small
// mapping function:
// - auth: `authorization: Bearer <token>` (SECRETS `secrets/<env>/grc/generic/token`). §9.2 has
//   machines on mTLS-bound client credentials: the token comes from the product's credential source
//   and the mTLS binding is the transport's, neither built here ([ASSUMED – owner review] #159);
// - obligations: `GET /v1/grc/obligations?updated_since=<ts>&cursor=<c>&limit=<n>` (§6.15 names the
//   path and `updated_since`), answered `{ items: [Obligation], next_cursor? }`;
// - each POST: the §6.15 event's data as the JSON body to the resource's path (`GRC_POST_METHODS`),
//   with `idempotency-key` (draft-ietf-httpapi-idempotency-key-header), answered `{ id, received_at }`;
//   a key reused with another body is `422 { code: "idempotency_key_reused" }`, an incident update
//   out of order `409 { code: "out_of_order" }`, a request still in flight under the key `409`;
// - health: `GET /v1/grc/health`.
// A keyed POST is safe to resend, so the egress client retries it like a read. Nothing is kept here
// (no migration): the counterparty is the system of record, the product keeps its own evidence.
// Off behind `int.grc.generic.enabled` (default false) and `unproven`.
import {
  GRC_OBLIGATIONS_PATH,
  GRC_POST_METHODS,
  GrcObligation,
  grcRefusal,
  prepareGrcObligationQuery,
  prepareGrcPost,
  type AdapterDescriptor,
  type GrcObligationPage,
  type GrcObligationQuery,
  type GrcPort,
  type GrcPost,
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
import { createEgress, type EgressResponse } from "../core/http.js";
import { vendorError } from "../messaging/common.js";

const PORT = "GRC";
const ADAPTER = "generic-grc";
const HOST =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export interface GenericGrcOptions {
  /** `int.grc.generic.enabled`, read on every call; off by default. */
  enabled: () => Promise<boolean> | boolean;
  /** `int.grc.generic.host`, read on every call; empty refuses `adapter_unconfigured`. */
  host: () => Promise<string> | string;
  /** `secrets/<env>/grc/generic/token`. */
  token: () => Promise<string> | string;
  now?: () => Date;
  /** Tests only: the stub's base URL instead of `https://<host>`. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
}

// ---- stub-shaped mappings (to confirm against the first counterparty's sandbox) -----------------

/** STUB-SHAPED [VERIFY]: the obligations page, cut to the port's fields. */
export function mapGrcObligationPage(body: unknown): GrcObligationPage {
  const b = body as { items?: unknown; next_cursor?: unknown } | undefined;
  if (!Array.isArray(b?.items))
    throw vendorError(PORT, ADAPTER, 502, "obligations answer without items");
  const items = b.items.map((o) => {
    const r = GrcObligation.safeParse(o);
    if (!r.success) throw vendorError(PORT, ADAPTER, 502, "an obligation outside §9.2's shape");
    return r.data;
  });
  const next = b.next_cursor;
  if (next !== undefined && next !== null && (typeof next !== "string" || next.length === 0))
    throw vendorError(PORT, ADAPTER, 502, "obligations answer with a bad cursor");
  return { items, ...(typeof next === "string" ? { nextCursor: next } : {}) };
}

/** STUB-SHAPED [VERIFY]: a refusal the counterparty answered, as the port's. */
export function grcHttpRefusal(status: number, body: unknown, what: string): Error {
  const c = (body as { code?: unknown } | undefined)?.code;
  if (status === 422 && c === "idempotency_key_reused")
    return grcRefusal(
      "IPB-PORT-004",
      ADAPTER,
      "idempotency_conflict",
      "the GRC system took this key with another body",
    );
  if (status === 409 && c === "out_of_order")
    return grcRefusal(
      "IPB-PORT-001",
      ADAPTER,
      "out_of_order",
      "the GRC system holds a later update of this incident",
    );
  if (status === 400 && c === "invalid_cursor")
    return grcRefusal(
      "IPB-PORT-001",
      ADAPTER,
      "invalid_cursor",
      "the GRC system refused the cursor",
    );
  // 409 otherwise: a request under this key is still in flight; resend it later with the same key.
  if (status === 409) return vendorError(PORT, ADAPTER, 503, what);
  return vendorError(PORT, ADAPTER, status, what);
}

/** STUB-SHAPED [VERIFY]: a POST's answer, as the port's receipt. */
export function mapGrcReceipt(post: GrcPost, body: unknown, now: Date): GrcReceipt {
  const b = body as { id?: unknown; received_at?: unknown } | undefined;
  if (typeof b?.id !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(b.id))
    throw vendorError(PORT, ADAPTER, 502, "receipt without the record's id");
  const at = typeof b.received_at === "string" ? Date.parse(b.received_at) : NaN;
  return {
    resource: post.resource,
    ref: b.id,
    idempotencyKey: post.idempotencyKey,
    adapter: ADAPTER,
    receivedAt: (Number.isNaN(at) ? now : new Date(at)).toISOString(),
  };
}

export class GenericGrc implements GrcPort {
  readonly descriptor: AdapterDescriptor = {
    port: PORT,
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  private readonly now: () => Date;
  private readonly egress = new Map<string, ReturnType<typeof createEgress>>();

  constructor(private readonly o: GenericGrcOptions) {
    this.now = o.now ?? (() => new Date());
  }

  private async target(): Promise<{ base: string; egress: ReturnType<typeof createEgress> }> {
    if (!(await this.o.enabled()))
      throw grcRefusal(
        "IPB-PORT-001",
        ADAPTER,
        "adapter_disabled",
        "the generic GRC connector is off (int.grc.generic.enabled)",
      );
    const host = String(await this.o.host())
      .trim()
      .toLowerCase();
    if (!HOST.test(host))
      throw grcRefusal(
        "IPB-PORT-001",
        ADAPTER,
        "adapter_unconfigured",
        "no GRC host (int.grc.generic.host)",
      );
    let egress = this.egress.get(host);
    if (!egress) {
      egress = createEgress({
        port: PORT,
        adapter: ADAPTER,
        allow: [host],
        // Every POST carries its Idempotency-Key, so a resend is safe (§9.2).
        retryUnsafe: true,
        retries: 2,
        timeoutMs: 10_000,
        maxBytes: 4 * 1024 * 1024,
        ...(this.o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
      });
      this.egress.set(host, egress);
    }
    return { base: (this.o.baseUrl ?? `https://${host}`).replace(/\/$/, ""), egress };
  }

  private async headers(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.o.token()}`, accept: "application/json" };
  }

  private static json(res: EgressResponse): unknown {
    try {
      return res.json();
    } catch {
      return undefined;
    }
  }

  async listObligations(q?: GrcObligationQuery, call?: PortCall): Promise<GrcObligationPage> {
    const query = prepareGrcObligationQuery(ADAPTER, q, call);
    const { base, egress } = await this.target();
    const qs = new URLSearchParams();
    if (query.updatedSince) qs.set("updated_since", query.updatedSince);
    if (query.cursor) qs.set("cursor", query.cursor);
    if (query.limit) qs.set("limit", String(query.limit));
    const s = qs.toString();
    const res = await egress(`${base}${GRC_OBLIGATIONS_PATH}${s ? `?${s}` : ""}`, {
      headers: await this.headers(),
    });
    if (res.status !== 200)
      throw grcHttpRefusal(res.status, GenericGrc.json(res), "obligations read");
    return mapGrcObligationPage(GenericGrc.json(res));
  }

  private async post(method: GrcPostMethod, raw: unknown, call?: PortCall): Promise<GrcReceipt> {
    const post = prepareGrcPost(ADAPTER, method, raw, call);
    const { base, egress } = await this.target();
    const res = await egress(`${base}${GRC_POST_METHODS[method].path}`, {
      method: "POST",
      headers: {
        ...(await this.headers()),
        "content-type": "application/json",
        "idempotency-key": post.idempotencyKey,
      },
      body: JSON.stringify(post.data),
    });
    if (res.status !== 200 && res.status !== 201)
      throw grcHttpRefusal(res.status, GenericGrc.json(res), `${post.resource} create`);
    return mapGrcReceipt(post, GenericGrc.json(res), this.now());
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

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      const { base, egress } = await this.target();
      const res = await egress(`${base}/v1/grc/health`, { headers: await this.headers() });
      if (res.status !== 200) status = "down";
    } catch {
      status = "down";
    }
    return {
      status,
      latency_ms: Math.round(performance.now() - started),
      checked_at: this.now().toISOString(),
    };
  }
}
