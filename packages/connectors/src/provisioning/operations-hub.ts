// The Operations Hub provisioning adapter (LawDocsComply PR-LDC-11; R1-plan M38; R1-D-68). It
// consumes the signed `TenantProvisioned` (Ecosystem Spec v1.2 §6.29, N11) and creates the tenant
// once per `provisioning_request_id` through `TenantBootstrap.provision` (M37), with the
// product's hook in the same transaction.
//
// `receive(event, jws)`, before the HTTP 2xx (Spec §3.4):
//   1. the envelope is a valid CloudEvent of type `in.infrabyx.ops.TenantProvisioned.v1` from the
//      Hub (`urn:infrabyx:oh:<legal entity>`), of this deployment's `live` or `test` environment;
//   2. its detached JWS verifies against the Hub's pinned key ring (ES256, `kid`, `iat` window,
//      `jti` replay; C-22), and the product keeps it beside the event (`proofs.save`);
//   3. the payload names this product and this environment; a PRODUCTION request carries the MSA,
//      DPA and OUT clause-matrix refs (Spec §6.29, else `regulatory-guard`); a first-admin email
//      comes with `legalbasis = CONTRACT_PERFORMANCE_VENDOR`;
//   4. the event enters the product's Ecosystem inbox with the request id as its business key, so
//      a second event for the same request is acknowledged and never processed.
// `drain()` then processes the inbox: for each accepted request, `provision` creates the tenant
// (the provisional id of PR-040 when present, else an id derived from the request id, the same on
// every retry) and runs `onProvisioned(tx, tenant)` in that transaction. The product then reports
// `READY` to the Hub by `PUT /v1/provisioning-requests/{id}` (its own call).
//
// Not built until PR-040 (Ecosystem Spec v1.3) is signed off: publishing `ProvisioningRequested`
// and consuming `ProvisioningFailed`. Nothing here sends anything to the Hub.
import { IpbError } from "@infrabyx/contracts/errors";
import {
  EcosystemEnvelope,
  PROVISIONING_PRODUCTS,
  TENANT_PROVISIONED_TYPE,
  TenantProvisionedData,
  type ProvisioningEnvironment,
} from "@infrabyx/contracts/events";
import type { KernelContext, Tx } from "@infrabyx/contracts/kernel";
import {
  deterministicId,
  verifyRegulatedMessage,
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
  /** The tenant's name; default the first legal entity's name, else the org id. */
  nameOf?: (data: TenantProvisionedData) => string;
  now?: () => Date;
}

/** Anchors derived tenant ids, so a request id always gives the same tenant id. */
const PROVISIONING_EPOCH = new Date("2026-01-01T00:00:00Z");
const HUB_SOURCE = /^urn:infrabyx:oh:[A-Za-z0-9_-]+$/;

const refused = (reason: string, detail: string): IpbError =>
  new IpbError("IPB-API-005", { detail: `TenantProvisioned refused: ${detail}`, meta: { reason } });

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

  /** Verify and store one `TenantProvisioned` before acknowledging it (Spec §3.4). */
  async receive(
    raw: unknown,
    jws: string,
  ): Promise<{ outcome: "accepted" | "duplicate" | "business_duplicate"; eventId: string }> {
    const parsed = EcosystemEnvelope.safeParse(raw);
    if (!parsed.success) throw refused("envelope", "not a valid Ecosystem CloudEvent");
    const e = parsed.data;
    if (e.type !== TENANT_PROVISIONED_TYPE)
      throw refused("type", `expected ${TENANT_PROVISIONED_TYPE}`);
    if (!HUB_SOURCE.test(e.source)) throw refused("source", "not from the Operations Hub");
    const v = await verifyRegulatedMessage(raw as Record<string, unknown>, jws, {
      keys: this.o.keys,
      replay: this.o.replay,
      ...(this.o.now ? { now: this.o.now() } : {}),
    });
    if (!v.ok)
      throw new IpbError("IPB-API-018", {
        detail: "TenantProvisioned's JWS did not verify",
        meta: { reason: v.reason },
      });
    const d = TenantProvisionedData.safeParse(e.data);
    if (!d.success) throw refused("payload", "the payload does not match TenantProvisioned");
    const data = d.data;
    if (PROVISIONING_PRODUCTS[data.product] !== this.o.product)
      throw refused("product", `the request is for ${data.product}`);
    if (data.environment !== this.o.environment)
      throw refused("environment", `the request is for ${data.environment}`);
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
    if (e.subject !== data.provisioning_request_id)
      throw refused("subject", "the subject is not the provisioning request id");
    await this.o.proofs.save(e.id, jws);
    return this.o.inbox.receive(this.o.platformCtx, e, {
      businessKey: `provisioning:${data.provisioning_request_id}`,
    });
  }

  /** Create each accepted request's tenant once, with the product's hook in its transaction. */
  async drain(opts: { limit?: number } = {}) {
    return this.o.inbox.drain(this.o.platformCtx, (_tx, ev) => this.handle(ev), opts);
  }

  private async handle(ev: InboxEvent): Promise<void> {
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
