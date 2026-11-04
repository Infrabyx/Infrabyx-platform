// The consent ledger behind the CONSENT port (IPB-04-78; Ecosystem Part 6; PL5 plan §6.1).
//   pg_local   the platform's own append-only PostgreSQL ledger (built and proven here)
//   oh_ledger  the Operations Hub ledger over HTTP (built against a stub; unproven until OH exposes it)
// Every record is a new row (a changed choice never overwrites one), keeps the exact text shown
// (IPB-05 `@IPB-05-AT-10`), is ledgered in the audit chain, and emits `ConsentRecorded` (internal).
// The Ecosystem `MarketingConsentUpdated` emitter stays off until v1.2 is approved (#46).
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
} from "@infrabyx/contracts/kernel";
import {
  ConsentRecordInput as ConsentRecordSchema,
  type AdapterDescriptor,
  type ConsentChoice,
  type ConsentPort,
  type ConsentReceipt,
  type ConsentRecordInput,
  type ConsentRegion,
  type ConsentState,
  type PortCall,
  type PortHealth,
  type PrincipalPurposeConsent,
} from "@infrabyx/contracts/ports";
import { CONSENT_EVENTS, ConsentRecordedData } from "@infrabyx/contracts";
import { internalEvent } from "@infrabyx/config/events";
import { newId } from "@infrabyx/crypto";
import type { ConsentTexts } from "./texts.js";

export const CONSENT_LEDGER_PRINCIPAL_ID = "svc_consent_ledger";

const up = async (): Promise<PortHealth> => ({
  status: "up",
  latency_ms: 0,
  checked_at: new Date().toISOString(),
});

interface RecordRow {
  id: string;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
  text_version: string;
  region: ConsentRegion;
  gpc: boolean;
  recorded_at: Date;
}

export class PgConsentLedger implements ConsentPort {
  readonly descriptor: AdapterDescriptor = {
    port: "CONSENT",
    adapter: "pg_local",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  health = up;
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      texts: ConsentTexts;
      product: string;
      outbox?: OutboxWriter;
      /** The tenant of anonymous site visitors; product apps pass the tenant per call. */
      defaultTenantId?: string;
    },
  ) {}

  private ctx(call?: PortCall): KernelContext {
    return {
      tenantId: call?.tenantId ?? this.o.defaultTenantId ?? PLATFORM_TENANT_ID,
      principal: { id: CONSENT_LEDGER_PRINCIPAL_ID, type: "service", roles: [] },
    };
  }

  async recordConsent(input: ConsentRecordInput, call?: PortCall): Promise<ConsentReceipt> {
    const v = ConsentRecordSchema.parse(input);
    // The exact text shown: the stored version of the key for the region (IPB-05 AT-10).
    const text = await this.o.texts.version(v.textKey, v.textVersion, v.region);
    if (!text)
      throw new IpbError("IPB-CMS-001", {
        detail: `no consent text ${v.textKey} v${v.textVersion}`,
      });
    const c: Partial<ConsentChoice> = v.choice ?? {};
    return this.o.kernel.mutate(
      this.ctx(call),
      async (tx) => {
        const id = newId("cns");
        const r = await tx.query<{ recorded_at: Date }>(
          `insert into consent.record (id, tenant_id, cid, principal_ref, brand_pack_id, method, functional, analytics, marketing,
             purposes, text_key, text_version, text_shown, policy_version, region, gpc, ua_class)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning recorded_at`,
          [
            id,
            tx.ctx.tenantId,
            v.cid ?? null,
            v.principalRef ?? null,
            v.brandPackId ?? null,
            v.method,
            c.functional ?? null,
            c.analytics ?? null,
            c.marketing ?? null,
            v.purposes,
            v.textKey,
            v.textVersion,
            text.body,
            v.policyVersion ?? null,
            v.region,
            v.gpc,
            v.uaClass ?? null,
          ],
        );
        await this.o.audit.record(tx, {
          action: "consent.record",
          resourceType: "consent_record",
          resourceId: id,
          after: {
            method: v.method,
            text: `${v.textKey}@${v.textVersion}`,
            region: v.region,
            gpc: v.gpc,
          },
        });
        if (this.o.outbox) {
          const categories = Object.entries(c)
            .filter(([, on]) => on)
            .map(([k]) => k);
          await this.o.outbox.publish(tx, "consent", {
            envelope: internalEvent({
              product: this.o.product,
              event: CONSENT_EVENTS.ConsentRecorded,
              tenantId: tx.ctx.tenantId,
              dataclass: "CONFIDENTIAL",
              data: ConsentRecordedData.parse({
                receipt_id: id,
                categories: [...categories, ...v.purposes],
                region: v.region,
                text_version: v.textVersion,
                gpc: v.gpc,
              }),
            }),
          });
        }
        return { receiptId: id, recordedAt: r.rows[0]!.recorded_at.toISOString() };
      },
      { action: "consent.record" },
    );
  }

  async getConsent(cid: string, call?: PortCall): Promise<ConsentState | null> {
    return this.o.kernel.read(this.ctx(call), async (tx) => {
      const r = await tx.query<RecordRow>(
        `select id, functional, analytics, marketing, text_version, region, gpc, recorded_at from consent.record
          where tenant_id = $1 and cid = $2 and method in ('CMP_BANNER', 'PREFERENCE_CENTRE')
          order by recorded_at desc, id desc limit 1`,
        [tx.ctx.tenantId, cid],
      );
      const x = r.rows[0];
      if (!x) return null;
      return {
        receiptId: x.id,
        choice: { functional: x.functional, analytics: x.analytics, marketing: x.marketing },
        textVersion: x.text_version,
        region: x.region,
        gpc: x.gpc,
        recordedAt: x.recorded_at.toISOString(),
      };
    });
  }

  /**
   * The latest record per purpose for a principal reference, in the call's tenant only (PR-LDC-14;
   * R1-plan M41; R1-D-72): the Ecosystem purposes of its ledger records (`consent.record`, granted
   * purposes only) and the product purposes of its purpose-consent records
   * (`consent.purpose_record`, grants and withdrawals, against a tenant or platform notice).
   */
  async latestByPrincipal(
    principalRef: string,
    call?: PortCall,
  ): Promise<PrincipalPurposeConsent[]> {
    if (principalRef.length < 3 || principalRef.length > 120)
      throw new RangeError("principalRef is 3 to 120 characters");
    return this.o.kernel.read(this.ctx(call), async (tx) => {
      const r = await tx.query<{
        purpose: string;
        granted: boolean;
        id: string;
        recorded_at: Date;
        shown: string | null;
        sha256: string | null;
        platform: boolean;
      }>(
        `with ledger as (
           select distinct on (p.purpose) p.purpose, true as granted, r.id, r.recorded_at,
                  r.text_key || '@' || r.text_version as shown, null::text as sha256, false as platform
             from consent.record r cross join lateral unnest(r.purposes) as p(purpose)
            where r.tenant_id = $1 and r.principal_ref = $2
            order by p.purpose, r.recorded_at desc, r.id desc),
         purposes as (
           select distinct on (r.purpose) r.purpose, r.action = 'granted' as granted, r.id,
                  r.recorded_at,
                  case when r.notice_id is null then null
                       else r.notice_id || '@' || r.notice_version end as shown,
                  r.notice_sha256 as sha256, coalesce(n.tenant_id = $3, false) as platform
             from consent.purpose_record r
             left join consent.purpose_notice n on n.id = r.notice_id
            where r.tenant_id = $1 and r.subject_ref = $2
            order by r.purpose, r.recorded_at desc, r.id desc)
         select * from ledger union all select * from purposes order by purpose`,
        [tx.ctx.tenantId, principalRef, PLATFORM_TENANT_ID],
      );
      return r.rows.map((x) => ({
        purpose: x.purpose,
        granted: x.granted,
        receiptId: x.id,
        recordedAt: x.recorded_at.toISOString(),
        shown: x.shown,
        noticeSha256: x.sha256,
        platformNotice: x.platform,
      }));
    });
  }
}

/**
 * The Operations Hub ledger (Ecosystem §6.14) over HTTP. Built against a stub; unproven until OH
 * exposes the ledger. `fetch` is injected (the product's EGRESS-guarded fetch in production).
 */
export class OhConsentLedger implements ConsentPort {
  readonly descriptor: AdapterDescriptor = {
    port: "CONSENT",
    adapter: "oh_ledger",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
    // The OH ledger offers no read by principal (PR-LDC-14; R1-D-72).
    capabilities: { latestByPrincipal: "unsupported" },
  };
  constructor(
    private readonly o: {
      baseUrl: string;
      token: () => Promise<string>;
      fetch: (
        url: string,
        init: { method: string; headers: Record<string, string>; body?: string },
      ) => Promise<{ status: number; json(): Promise<unknown> }>;
    },
  ) {}

  async health(): Promise<PortHealth> {
    const t0 = Date.now();
    const r = await this.o.fetch(new URL("/v1/health", this.o.baseUrl).toString(), {
      method: "GET",
      headers: {},
    });
    return {
      status: r.status === 200 ? "up" : "down",
      latency_ms: Date.now() - t0,
      checked_at: new Date().toISOString(),
    };
  }

  async recordConsent(input: ConsentRecordInput, call?: PortCall): Promise<ConsentReceipt> {
    const v = ConsentRecordSchema.parse(input);
    const r = await this.o.fetch(new URL("/v1/consent/records", this.o.baseUrl).toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.o.token()}`,
        "content-type": "application/json",
        ...(call?.idempotencyKey ? { "idempotency-key": call.idempotencyKey } : {}),
      },
      body: JSON.stringify(v),
    });
    if (r.status !== 201)
      throw new IpbError("IPB-WEB-001", { detail: `consent ledger answered ${r.status}` });
    const body = (await r.json()) as { receipt_id: string; recorded_at: string };
    return { receiptId: body.receipt_id, recordedAt: body.recorded_at };
  }

  async getConsent(cid: string): Promise<ConsentState | null> {
    const r = await this.o.fetch(
      new URL(
        `/v1/consent/records/latest?cid=${encodeURIComponent(cid)}`,
        this.o.baseUrl,
      ).toString(),
      {
        method: "GET",
        headers: { authorization: `Bearer ${await this.o.token()}` },
      },
    );
    if (r.status === 404) return null;
    if (r.status !== 200)
      throw new IpbError("IPB-WEB-001", { detail: `consent ledger answered ${r.status}` });
    return (await r.json()) as ConsentState;
  }

  /** Not offered by the OH ledger (PR-LDC-14; R1-D-72): IPB-PORT-001, reason `unsupported`. */
  latestByPrincipal(): Promise<PrincipalPurposeConsent[]> {
    return Promise.reject(
      new PortError("IPB-PORT-001", "CONSENT", {
        adapter: "oh_ledger",
        detail: "the Operations Hub ledger has no read by principal",
        meta: { reason: "unsupported" },
      }),
    );
  }
}
