// The Operations Hub provisioning adapter (LawDocsComply PR-LDC-11; R1-plan M38; R1-D-68, R1-D-70)
// for Ecosystem Spec v1.3 §6.29 (PR-040, signed off by the owner on 4 Nov 2026, OWNER-QUESTIONS
// #105). Three regulated messages (Spec §3.6), each with a detached JWS kept beside the event:
//
// - `request(tx, input)` (v1.3): writes `ProvisioningRequested` for a provisional tenant the
//   product already holds (M37's `bootstrapTenant`) to the product's outbox, in the caller's
//   transaction in that tenant. Idempotent on `provisioning_request_id`: the same request again is
//   a no-op, the same id with another payload is refused (`idempotency-conflict`, IPB-PORT-004).
//   The product's relay signs each outgoing event at delivery with `signForDelivery` (the JWS
//   lives 5 minutes, so it is never made at write time) and sends both to the Hub;
// - `receive(event, jws)`, before the HTTP 2xx (Spec §3.4), for `TenantProvisioned` and (v1.3)
//   `ProvisioningFailed`:
//   1. the envelope is a valid CloudEvent of one of the two types from the Hub
//      (`urn:infrabyx:oh:<legal entity>`), of this deployment's `live` or `test` environment;
//   2. its detached JWS verifies against the Hub's pinned key ring (ES256, `kid`, `iat` window,
//      `jti` replay; C-22), and the product keeps it beside the event (`proofs.save`);
//   3. the payload names this product and this environment. For `TenantProvisioned`: a PRODUCTION
//      request carries the MSA, DPA and OUT clause-matrix refs (else `regulatory-guard`), and a
//      first-admin email comes with `legalbasis = CONTRACT_PERFORMANCE_VENDOR`. For
//      `ProvisioningFailed`: the reason is in the code table, `retryable` matches it, and
//      `detail` carries no personal data;
//   4. the event enters the product's Ecosystem inbox with the request id as its business key.
//      One request has one outcome (Spec v1.3): a second event for the same request, of either
//      type, is acknowledged as `business_duplicate` and never processed (the product logs it as a
//      conflict).
// - `drain()` processes the inbox: a `TenantProvisioned` creates the tenant (the provisional id
//   when present, else an id derived from the request id, the same on every retry) and runs
//   `onProvisioned(tx, tenant)` in that transaction; a `ProvisioningFailed` runs
//   `onFailed(tx, failure)` with the Spec's purge deadline, `failed_at` + 30 days. The product
//   purges the provisional tenant and its first-admin contact data by then, ledgered, unless a
//   retry under a new request id is open (Spec v1.3 retention rule; DPDP Act 2023 s.8(7)).
import { IpbError } from "@infrabyx/contracts/errors";
import {
  EcosystemEnvelope,
  PROVISIONAL_TENANT_PURGE_DAYS,
  PROVISIONING_FAILED_TYPE,
  PROVISIONING_PRODUCTS,
  PROVISIONING_REQUESTED_TYPE,
  ProvisioningFailedData,
  ProvisioningRequestedData,
  TENANT_PROVISIONED_TYPE,
  TenantProvisionedData,
  type ProvisioningEnvironment,
  type ProvisioningFailureReason,
  type ProvisioningProduct,
} from "@infrabyx/contracts/events";
import type { KernelContext, OutboxWriter, Tx } from "@infrabyx/contracts/kernel";
import {
  deterministicId,
  randomBytes,
  signRegulatedMessage,
  toHex,
  verifyRegulatedMessage,
  type DerSigner,
  type RegulatedKeyRing,
  type ReplayStore,
} from "@infrabyx/crypto";
import type { EcosystemInbox, InboxEvent, TenantBootstrap, TenantProduct } from "@infrabyx/tenancy";

/** A tenant the Hub provisioned, as the product's hook sees it inside the creation transaction. */
export interface ProvisionedTenant {
  tenantId: string;
  provisioningRequestId: string;
  /** The verified payload (business particulars only). */
  data: TenantProvisionedData;
  /** The event's id, under which `proofs.save` kept its JWS. */
  eventId: string;
}

export interface OperationsHubProvisioningOptions {
  /** The product module's Ecosystem inbox (`tenancy.create_ecosystem_inbox('<schema>')`). */
  inbox: EcosystemInbox;
  tenants: TenantBootstrap;
  /** The platform context the adapter writes in: a PLT_* service principal (the kernel checks). */
  platformCtx: KernelContext;
  /** This product's short code (`LDC`, `FBX`, …); an event for another product is refused. */
  product: TenantProduct;
  /** This deployment's provisioning environment; an event for another one is refused. */
  environment: ProvisioningEnvironment;
  /** The Hub's ecosystem signing keys, pinned (Spec §3.6; C-22). */
  keys: RegulatedKeyRing;
  /** `jti` replay store, durable in production. */
  replay: ReplayStore;
  /** Keeps the JWS beside the event, so the proof can be re-verified later (Spec §3.6). */
  proofs: { save(eventId: string, jws: string): Promise<void> };
  /** The product's own first rows for the tenant, in the tenant's creation transaction. */
  onProvisioned: (tx: Tx, tenant: ProvisionedTenant) => Promise<void>;
  /**
   * v1.3: the product's reaction to a `ProvisioningFailed`, in the inbox's transaction (record the
   * outcome, schedule the purge by `purgeBy`, tell the requester). Without it the adapter refuses
   * `ProvisioningFailed` (`type`), so a product never acknowledges a failure it cannot act on.
   */
  onFailed?: (tx: Tx, failure: ProvisioningFailure) => Promise<void>;
  /** v1.3: where `request` writes `ProvisioningRequested` (the product module's outbox). */
  outbox?: { writer: OutboxWriter; schema: string };
  /** v1.3: the product's ecosystem signing key, for `signForDelivery` (KMS; R1-D-08). */
  signer?: { kid: string; sign: DerSigner };
  /** The tenant's name; default the first legal entity's name, else the org id. */
  nameOf?: (data: TenantProvisionedData) => string;
  /** v1.3: the registry base of `dataschema` (Spec §3.3; default the Spec's placeholder host). */
  registryBase?: string;
  /** v1.3: the envelope `environment` of outgoing events (`test` in sandbox and UAT; Spec §3.2). */
  envelopeEnvironment?: "live" | "test";
  now?: () => Date;
}

/** A `ProvisioningFailed` the Hub sent for one of the product's requests (Spec v1.3 §6.29). */
export interface ProvisioningFailure {
  provisioningRequestId: string;
  provisionalTenantId: string;
  reasonCode: ProvisioningFailureReason;
  retryable: boolean;
  detail?: string;
  failedAt: Date;
  /** `failedAt` + 30 days: the provisional tenant and its first-admin contact data are purged by
   * then, ledgered, unless a retry under a new request id is open (Spec v1.3 retention rule). */
  purgeBy: Date;
  /** The event's id, under which `proofs.save` kept its JWS. */
  eventId: string;
}

/** What the product sends to ask the Hub for a tenant (Spec v1.3 `ProvisioningRequested`). */
export interface ProvisioningRequestInput {
  /** UUIDv7 minted by the product; minted here when absent. A new request needs a new id. */
  provisioningRequestId?: string;
  /** The provisional tenant the product holds (M37); the transaction's tenant. */
  provisionalTenantId: string;
  planId: string;
  modules: readonly string[];
  /** The residency cell. */
  homeCell: string;
  orgName: string;
  /** CIN, LLPIN or GSTIN where known (a business identifier only). */
  orgRef?: string;
  /** The requester's acceptance of the terms, by reference. */
  consentRef: string;
  /** Business contact data (`legalbasis = CONTRACT_PERFORMANCE_VENDOR`); never a password. */
  firstAdminEmail?: string;
  requestedAt?: Date;
}

/** The product's `source` label for a tenant product (Spec §3.2). */
const SOURCE_LABEL: Readonly<Record<TenantProduct, string>> = {
  LDC: "ldc",
  LD: "lawdocs",
  FBX: "finbyx",
  UDF: "udofin",
  EQ: "equator",
  OH: "oh",
};
const LONG_FORM = Object.fromEntries(
  Object.entries(PROVISIONING_PRODUCTS).map(([long, short]) => [short, long]),
) as Record<TenantProduct, ProvisioningProduct>;

/** A UUIDv7 (RFC 9562): 48-bit Unix milliseconds, version 7, variant 10, random bits. */
export function uuidv7(ms = Date.now()): string {
  const b = randomBytes(16);
  const t = BigInt(ms);
  for (let i = 0; i < 6; i++) b[i] = Number((t >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Personal data that must never be in `ProvisioningFailed.detail` (Spec v1.3 §6.29): an email
 * address, an Indian mobile number, a PAN, an Aadhaar-like 12-digit number or any run of nine or
 * more digits (an account or card number). Conservative: a false positive only refuses the event,
 * which the Hub resends without the detail.
 */
const PERSONAL_DATA = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/,
  /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/,
  /\b[A-Z]{5}[0-9]{4}[A-Z]\b/i,
  /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/,
  /\d{9,}/,
];
export const carriesPersonalData = (text: string): boolean =>
  PERSONAL_DATA.some((re) => re.test(text));

const DAY_MS = 86_400_000;

/** Anchors derived tenant ids, so a request id always gives the same tenant id. */
const PROVISIONING_EPOCH = new Date("2026-01-01T00:00:00Z");
const DEFAULT_REGISTRY = "https://registry.infrabyx.example";
const sortKeys = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v as object)
            .sort()
            .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
        )
      : v;
const HUB_SOURCE = /^urn:infrabyx:oh:[A-Za-z0-9_-]+$/;

const refused = (reason: string, detail: string, type = "TenantProvisioned"): IpbError =>
  new IpbError("IPB-API-005", { detail: `${type} refused: ${detail}`, meta: { reason } });

/** The tenant id for a request: PR-040's provisional id, else one derived from the request id. */
export function provisionedTenantId(data: TenantProvisionedData): string {
  return (
    data.provisional_tenant_id ??
    deterministicId(
      "tnt",
      "tenancy.tenant.provisioning",
      data.provisioning_request_id,
      PROVISIONING_EPOCH,
    )
  );
}

export class OperationsHubProvisioning {
  constructor(private readonly o: OperationsHubProvisioningOptions) {}

  /**
   * v1.3: write `ProvisioningRequested` to the product's outbox in `tx`, whose tenant is the
   * provisional tenant. Returns the request id; the same request again returns it unchanged.
   */
  async request(
    tx: Tx,
    input: ProvisioningRequestInput,
  ): Promise<{ provisioningRequestId: string; eventId: string; created: boolean }> {
    const out = this.o.outbox;
    if (!out) throw new Error("request() needs the `outbox` option (Spec v1.3 §6.29)");
    if (!/^[a-z][a-z0-9_]*$/.test(out.schema))
      throw new Error(`invalid module schema ${out.schema}`);
    if (tx.ctx.tenantId !== input.provisionalTenantId)
      throw new Error("request() runs in the provisional tenant's transaction");
    const now = this.o.now?.() ?? new Date();
    const requestId = input.provisioningRequestId ?? uuidv7(now.getTime());
    const data = ProvisioningRequestedData.parse({
      provisioning_request_id: requestId,
      provisional_tenant_id: input.provisionalTenantId,
      product: LONG_FORM[this.o.product],
      environment: this.o.environment,
      plan_id: input.planId,
      modules: [...input.modules],
      home_cell: input.homeCell,
      org_name: input.orgName,
      ...(input.orgRef ? { org_ref: input.orgRef } : {}),
      consent_ref: input.consentRef,
      ...(input.firstAdminEmail ? { first_admin_email: input.firstAdminEmail } : {}),
      requested_at: (input.requestedAt ?? now).toISOString(),
    });
    // One request id, one payload (Spec v1.3 idempotency): look for the request in the outbox.
    const prior = await tx.query<{ id: string; data: Record<string, unknown> }>(
      `select id, envelope->'data' as data from ${out.schema}.outbox
        where type = $1 and envelope->>'subject' = $2`,
      [PROVISIONING_REQUESTED_TYPE, requestId],
    );
    const same = (a: Record<string, unknown>) => {
      const { requested_at: _x, ...rest } = a;
      const { requested_at: _y, ...want } = data as Record<string, unknown>;
      return JSON.stringify(sortKeys(rest)) === JSON.stringify(sortKeys(want));
    };
    if (prior.rows[0]) {
      if (!same(prior.rows[0].data))
        throw new IpbError("IPB-PORT-004", {
          detail: "ProvisioningRequested: the request id was used with another payload",
          meta: { reason: "idempotency-conflict" },
        });
      return { provisioningRequestId: requestId, eventId: prior.rows[0].id, created: false };
    }
    const eventId = uuidv7(now.getTime());
    await out.writer.publish(tx, out.schema, {
      envelope: {
        specversion: "1.0",
        id: eventId,
        source: `urn:infrabyx:${SOURCE_LABEL[this.o.product]}:${input.provisionalTenantId}`,
        type: PROVISIONING_REQUESTED_TYPE,
        subject: requestId,
        time: now.toISOString(),
        datacontenttype: "application/json",
        dataschema: `${this.o.registryBase ?? DEFAULT_REGISTRY}/schemas/ops/ProvisioningRequested/1.0.0.json`,
        tenantid: input.provisionalTenantId,
        reid: "none",
        productfamily: "na",
        ...(data.first_admin_email ? { legalbasis: "CONTRACT_PERFORMANCE_VENDOR" } : {}),
        dataclass: "INTERNAL",
        schemaver: "1.0.0",
        seq: 1,
        ...(this.o.envelopeEnvironment ? { environment: this.o.envelopeEnvironment } : {}),
        data,
      },
    });
    return { provisioningRequestId: requestId, eventId, created: true };
  }

  /**
   * v1.3: the detached JWS for one outgoing provisioning event, made by the product's relay at
   * delivery (Spec §3.6; the Hub checks it against the product's pinned key set).
   */
  async signForDelivery(event: Record<string, unknown>): Promise<string> {
    if (!this.o.signer) throw new Error("signForDelivery() needs the `signer` option");
    if (event.type !== PROVISIONING_REQUESTED_TYPE)
      throw new Error(`signForDelivery() signs ${PROVISIONING_REQUESTED_TYPE} only`);
    return signRegulatedMessage({
      event,
      kid: this.o.signer.kid,
      sign: this.o.signer.sign,
      ...(this.o.now ? { now: this.o.now() } : {}),
    });
  }

  /** Verify and store one `TenantProvisioned` or `ProvisioningFailed` before acknowledging it. */
  async receive(
    raw: unknown,
    jws: string,
  ): Promise<{ outcome: "accepted" | "duplicate" | "business_duplicate"; eventId: string }> {
    const parsed = EcosystemEnvelope.safeParse(raw);
    if (!parsed.success) throw refused("envelope", "not a valid Ecosystem CloudEvent");
    const e = parsed.data;
    const failed = e.type === PROVISIONING_FAILED_TYPE;
    const name = failed ? "ProvisioningFailed" : "TenantProvisioned";
    if (e.type !== TENANT_PROVISIONED_TYPE && !(failed && this.o.onFailed))
      throw refused("type", `expected ${TENANT_PROVISIONED_TYPE}`);
    if (!HUB_SOURCE.test(e.source)) throw refused("source", "not from the Operations Hub", name);
    const v = await verifyRegulatedMessage(raw as Record<string, unknown>, jws, {
      keys: this.o.keys,
      replay: this.o.replay,
      ...(this.o.now ? { now: this.o.now() } : {}),
    });
    if (!v.ok)
      throw new IpbError("IPB-API-018", {
        detail: `${name}'s JWS did not verify`,
        meta: { reason: v.reason },
      });
    const requestId = failed ? this.checkFailed(e) : this.checkProvisioned(e);
    if (e.subject !== requestId)
      throw refused("subject", "the subject is not the provisioning request id", name);
    await this.o.proofs.save(e.id, jws);
    return this.o.inbox.receive(this.o.platformCtx, e, {
      businessKey: `provisioning:${requestId}`,
      exclusiveWith: [TENANT_PROVISIONED_TYPE, PROVISIONING_FAILED_TYPE],
    });
  }

  private checkProvisioned(e: EcosystemEnvelope): string {
    const d = TenantProvisionedData.safeParse(e.data);
    if (!d.success) throw refused("payload", "the payload does not match TenantProvisioned");
    const data = d.data;
    this.checkAddressee(data.product, data.environment, "TenantProvisioned");
    if (
      data.environment === "PRODUCTION" &&
      (!data.msa_ref || !data.dpa_ref || !data.out_clause_matrix_ref)
    )
      throw refused(
        "regulatory-guard",
        "a PRODUCTION request needs the MSA, DPA and OUT clause-matrix refs",
      );
    if (data.first_admin_email && e.legalbasis !== "CONTRACT_PERFORMANCE_VENDOR")
      throw refused("legalbasis", "the first-admin email needs CONTRACT_PERFORMANCE_VENDOR");
    return data.provisioning_request_id;
  }

  private checkFailed(e: EcosystemEnvelope): string {
    const d = ProvisioningFailedData.safeParse(e.data);
    if (!d.success)
      throw refused(
        "payload",
        "the payload does not match ProvisioningFailed",
        "ProvisioningFailed",
      );
    const data = d.data;
    this.checkAddressee(data.product, data.environment, "ProvisioningFailed");
    if (data.detail && carriesPersonalData(data.detail))
      throw refused("personal-data", "detail carries personal data", "ProvisioningFailed");
    if (e.tenantid !== data.provisional_tenant_id)
      throw refused("tenantid", "tenantid is not the provisional tenant id", "ProvisioningFailed");
    return data.provisioning_request_id;
  }

  private checkAddressee(product: ProvisioningProduct, env: ProvisioningEnvironment, name: string) {
    if (PROVISIONING_PRODUCTS[product] !== this.o.product)
      throw refused("product", `the request is for ${product}`, name);
    if (env !== this.o.environment) throw refused("environment", `the request is for ${env}`, name);
  }

  /** Create each accepted request's tenant once, with the product's hook in its transaction. */
  async drain(opts: { limit?: number } = {}) {
    return this.o.inbox.drain(this.o.platformCtx, (tx, ev) => this.handle(tx, ev), opts);
  }

  private async handle(tx: Tx, ev: InboxEvent): Promise<void> {
    if (ev.type === PROVISIONING_FAILED_TYPE && this.o.onFailed) {
      const f = ProvisioningFailedData.parse(ev.envelope.data);
      const failedAt = new Date(f.failed_at);
      await this.o.onFailed(tx, {
        provisioningRequestId: f.provisioning_request_id,
        provisionalTenantId: f.provisional_tenant_id,
        reasonCode: f.reason_code,
        retryable: f.retryable,
        ...(f.detail ? { detail: f.detail } : {}),
        failedAt,
        purgeBy: new Date(failedAt.getTime() + PROVISIONAL_TENANT_PURGE_DAYS * DAY_MS),
        eventId: ev.eventId,
      });
      return;
    }
    if (ev.type !== TENANT_PROVISIONED_TYPE) return;
    const data = TenantProvisionedData.parse(ev.envelope.data);
    const tenantId = provisionedTenantId(data);
    const name = (this.o.nameOf?.(data) ?? data.legal_entities?.[0]?.name ?? data.org_id).slice(
      0,
      200,
    );
    await this.o.tenants.provision(this.o.platformCtx, {
      tenantId,
      product: this.o.product,
      name,
      orgId: data.org_id,
      ...(data.residency ? { residency: data.residency } : {}),
      ...(data.plan_ref ? { planRef: data.plan_ref } : {}),
      provisioningRequestId: data.provisioning_request_id,
      onCreated: (tx) =>
        this.o.onProvisioned(tx, {
          tenantId,
          provisioningRequestId: data.provisioning_request_id,
          data,
          eventId: ev.eventId,
        }),
    });
  }
}
