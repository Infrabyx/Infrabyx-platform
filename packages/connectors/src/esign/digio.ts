// ESIGN alternative adapter `digio` (PL3 plan §8, PL3-D-04, PL3-D-23): the Digio eSign API v2 over
// the egress client, no SDK. India-hosted (IN), test mode until its sandbox leg runs (`unproven`,
// port-contract issue). Vendor facts below are [VERIFY] until then:
// - auth: HTTP Basic with client id and secret; sandbox `ext.digio.in`, production `api.digio.in`;
// - create: `POST /v2/client/document/uploadpdf` (PDF in base64, signers with one identifier each,
//   `sign_type` aadhaar | electronic | dsc, `sequential`, `sign_coordinates`);
// - status: `GET /v2/client/document/{id}`; signed PDF: `GET /v2/client/document/download`;
//   cancel: `POST /v2/client/document/{id}/cancel`.
// Methods map one to one (Aadhaar OTP → aadhaar, e-acceptance OTP → electronic, DSC → dsc);
// biometric Aadhaar and account eSign have no Digio type here and are refused (no downgrade).
// Digio documents no webhook signature, so the callback URL carries our C-19 secret as
// `ipb_token` (as for Gupshup, PL2-D-65), and the envelope is always read back from the API.
import { PortError } from "@infrabyx/contracts/errors";
import type {
  AdapterDescriptor,
  DocumentRef,
  EnvelopeStatus,
  EsignEnvelopeStore,
  EsignPort,
  PortCall,
  PortHealth,
  SignatureRecord,
  Signer,
  SigningMethod,
  StoragePort,
  WebhookRequestMeta,
} from "@infrabyx/contracts/ports";
import { deterministicId, newId, toBase64Url, randomBytes } from "@infrabyx/crypto";
import { createEgress } from "../core/http.js";
import { checkSharedSecret, parseJson, vendorError, webhookRefused } from "../messaging/common.js";
import {
  ESIGN,
  loadEnvelope,
  methodRefused,
  overallState,
  readDocument,
  storeSigned,
  unsupported,
  validateEnvelope,
} from "./common.js";

const HOSTS = { sandbox: "ext.digio.in", production: "api.digio.in" } as const;
const SIGN_HOSTS = { sandbox: "ext.digio.in", production: "app.digio.in" } as const;
const IDEMPOTENCY_ANCHOR = new Date("2026-01-01T00:00:00Z");
const SIGN_TYPE: Partial<Record<SigningMethod, string>> = {
  AADHAAR_OTP_ESIGN: "aadhaar",
  E_ACCEPTANCE_OTP: "electronic",
  DSC: "dsc",
};

export interface DigioOptions {
  store: EsignEnvelopeStore;
  storage: StoragePort;
  /** `secrets/<env>/esign/digio/client_id` and `client_secret`. */
  clientId: () => Promise<string> | string;
  clientSecret: () => Promise<string> | string;
  /** Our C-19 URL secret for the callback (`ipb_token`), at least 32 random bytes. */
  webhookToken: () => Promise<string> | string;
  /** Test mode until the owner's account exists (default `sandbox`). */
  mode?: "sandbox" | "production";
  expireInDays?: number;
  /** Tests only: the Digio stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
  now?: () => number;
}

interface Party {
  identifier: string;
  status?: string;
  updated_at?: string;
}
interface DigioDocument {
  id: string;
  agreement_status?: string;
  signing_parties?: Party[];
}

export class DigioEsign implements EsignPort {
  readonly descriptor: AdapterDescriptor;
  private readonly egress;
  private readonly base: string;
  private readonly signBase: string;

  constructor(private readonly o: DigioOptions) {
    const mode = o.mode ?? "sandbox";
    this.descriptor = {
      port: ESIGN,
      adapter: "digio",
      residency: "IN",
      maxDataClass: "REGULATED",
      capabilities: { verifySignature: "unsupported" },
    };
    this.base = (o.baseUrl ?? `https://${HOSTS[mode]}`).replace(/\/$/, "");
    this.signBase = o.baseUrl ? this.base : `https://${SIGN_HOSTS[mode]}`;
    this.egress = createEgress({
      port: ESIGN,
      adapter: "digio",
      allow: [HOSTS[mode]],
      retries: 1,
      maxBytes: 64 * 1024 * 1024,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private identifier(s: Signer): string {
    const id = s.email ?? s.phone;
    if (!id)
      throw new PortError("IPB-PORT-001", ESIGN, {
        adapter: "digio",
        detail: "a Digio signer needs an e-mail address or a mobile number",
        meta: { reason: "invalid_request" },
      });
    return s.email ? id : id.replace(/^\+91/, "");
  }

  async createEnvelope(
    doc: DocumentRef,
    signers: Signer[],
    order: "sequential" | "parallel",
    fields: Parameters<EsignPort["createEnvelope"]>[3],
    call?: PortCall,
  ): Promise<{ envelopeId: string }> {
    const v = validateEnvelope("digio", doc, signers, fields);
    for (const s of v.signers) if (!SIGN_TYPE[s.method]) throw methodRefused("digio", s.method);
    const envelopeId = call?.idempotencyKey
      ? deterministicId("esr", "esign.digio", call.idempotencyKey, IDEMPOTENCY_ANCHOR)
      : newId("esr");
    if (await this.o.store.get(envelopeId)) return { envelopeId };
    const ids = v.signers.map((s) => this.identifier(s));
    const pdf = await readDocument(this.o.storage, "digio", v.doc);
    const coordinates: Record<string, Record<string, Array<Record<string, number>>>> = {};
    for (const f of v.fields) {
      const id = ids[v.signers.findIndex((s) => s.ref === f.signerRef)] as string;
      const page = (coordinates[id] ??= {});
      (page[String(f.page)] ??= []).push({
        llx: f.x,
        lly: f.y,
        urx: f.x + f.width,
        ury: f.y + f.height,
      });
    }
    const res = (await this.call("POST", "/v2/client/document/uploadpdf", {
      file_name: `${v.doc.documentId}.pdf`,
      file_data: Buffer.from(pdf).toString("base64"),
      signers: v.signers.map((s, i) => ({
        identifier: ids[i],
        name: s.name,
        sign_type: SIGN_TYPE[s.method],
        reason: "Signing",
      })),
      expire_in_days: this.o.expireInDays ?? 10,
      sequential: order === "sequential",
      notify_signers: true,
      send_sign_link: true,
      ...(v.fields.length ? { sign_coordinates: coordinates } : {}),
    })) as DigioDocument;
    if (!res.id) throw vendorError(ESIGN, "digio", 502, "upload response without a document id");
    await this.o.store.save({
      envelopeId,
      adapter: "digio",
      vendorRef: res.id,
      doc: v.doc,
      order,
      signers: v.signers.map((s, i) => ({
        ref: s.ref,
        method: s.method,
        vendorKey: ids[i] as string,
      })),
      createdAt: new Date(this.o.now?.() ?? Date.now()).toISOString(),
    });
    return { envelopeId };
  }

  /** Digio notifies the signers on upload (`notify_signers`) [VERIFY]. */
  async sendForSignature(envelopeId: string): Promise<EnvelopeStatus> {
    return this.getStatus(envelopeId);
  }

  async getStatus(envelopeId: string): Promise<EnvelopeStatus> {
    const r = await loadEnvelope(this.o.store, "digio", envelopeId);
    const d = (await this.call(
      "GET",
      `/v2/client/document/${encodeURIComponent(r.vendorRef)}`,
    )) as DigioDocument;
    const parties = new Map((d.signing_parties ?? []).map((p) => [p.identifier, p]));
    const signers = r.signers.map((s) => {
      const p = parties.get(s.vendorKey);
      const st = (p?.status ?? "").toLowerCase();
      return {
        ref: s.ref,
        method: s.method,
        state:
          st === "signed"
            ? ("signed" as const)
            : st === "rejected"
              ? ("declined" as const)
              : ("pending" as const),
        ...(st === "signed" && p?.updated_at ? { at: p.updated_at } : {}),
      };
    });
    const status = (d.agreement_status ?? "").toLowerCase();
    return {
      envelopeId,
      vendorRef: r.vendorRef,
      signers,
      state: overallState(signers, {
        cancelled: status === "cancelled",
        expired: status === "expired",
      }),
    };
  }

  async downloadSigned(
    envelopeId: string,
  ): Promise<{ storageKey: string; sha256: string; signatures: SignatureRecord[] }> {
    const st = await this.getStatus(envelopeId);
    if (st.state !== "completed")
      throw new PortError("IPB-PORT-001", ESIGN, {
        adapter: "digio",
        detail: `envelope ${envelopeId} is ${st.state}, not completed`,
        meta: { reason: "not_completed" },
      });
    const r = await loadEnvelope(this.o.store, "digio", envelopeId);
    const res = await this.egress(
      `${this.base}/v2/client/document/download?document_id=${encodeURIComponent(r.vendorRef)}`,
      { method: "GET", headers: { authorization: await this.basic(), accept: "application/pdf" } },
    );
    if (res.status !== 200) throw vendorError(ESIGN, "digio", res.status, "Digio download");
    if (Buffer.from(res.body.subarray(0, 5)).toString("latin1") !== "%PDF-")
      throw vendorError(ESIGN, "digio", 502, "the signed file is not a PDF");
    const stored = await storeSigned(this.o.storage, r.doc, res.body);
    return {
      ...stored,
      signatures: st.signers.map((s) => ({
        alg: `esp:digio:${s.method.toLowerCase()}`,
        keyId: r.vendorRef,
        certChainRef: `digio:${r.vendorRef}`,
        signerRef: s.ref,
        signedAt: s.at ?? "",
      })),
    };
  }

  private async session(
    envelopeId: string,
    signerRef: string,
    asked: SigningMethod,
  ): Promise<{ redirectUrl: string }> {
    const r = await loadEnvelope(this.o.store, "digio", envelopeId);
    const s = r.signers.find((x) => x.ref === signerRef);
    if (!s) throw unsupported("digio", `a session for unknown signer ${signerRef}`, "not_found");
    if (s.method !== asked || !SIGN_TYPE[asked]) throw methodRefused("digio", asked);
    const txn = toBase64Url(randomBytes(9));
    return {
      redirectUrl: `${this.signBase}/#/gateway/login/${encodeURIComponent(r.vendorRef)}/${txn}/${encodeURIComponent(s.vendorKey)}`,
    };
  }

  aadhaarEsign(session: {
    envelopeId: string;
    signerRef: string;
    method: "AADHAAR_OTP_ESIGN" | "AADHAAR_BIO_ESIGN";
  }): Promise<{ redirectUrl: string }> {
    return this.session(session.envelopeId, session.signerRef, session.method);
  }

  dscSign(session: { envelopeId: string; signerRef: string }): Promise<{ redirectUrl: string }> {
    return this.session(session.envelopeId, session.signerRef, "DSC");
  }

  async verifySignature(): Promise<{ valid: boolean; signatures: SignatureRecord[] }> {
    throw unsupported("digio", "verifySignature");
  }

  async cancel(envelopeId: string): Promise<void> {
    const r = await loadEnvelope(this.o.store, "digio", envelopeId);
    await this.call("POST", `/v2/client/document/${encodeURIComponent(r.vendorRef)}/cancel`, {});
  }

  async handleWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<EnvelopeStatus> {
    await checkSharedSecret(
      ESIGN,
      "digio",
      { secret: this.o.webhookToken },
      headers,
      meta?.sourceIp,
      meta?.query,
    );
    const body = parseJson(ESIGN, "digio", rawBody) as {
      payload?: { document?: { id?: unknown } };
      document_id?: unknown;
    };
    const id = body.payload?.document?.id ?? body.document_id;
    if (typeof id !== "string" || !id) throw webhookRefused(ESIGN, "digio", "no document id");
    const r = await this.o.store.byVendorRef("digio", id);
    if (!r) throw webhookRefused(ESIGN, "digio", "unknown document");
    // The webhook is only a trigger: the status returned is the one read back from the API.
    return this.getStatus(r.envelopeId);
  }

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      const res = await this.egress(`${this.base}/v2/client/document/ipb-health`, {
        method: "GET",
        headers: { authorization: await this.basic(), accept: "application/json" },
      });
      if (res.status >= 500 || res.status === 401 || res.status === 403) status = "down";
    } catch {
      status = "down";
    }
    return {
      status,
      latency_ms: Math.round(performance.now() - started),
      checked_at: new Date().toISOString(),
    };
  }

  private async basic(): Promise<string> {
    const raw = `${await this.o.clientId()}:${await this.o.clientSecret()}`;
    return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.egress(`${this.base}${path}`, {
      method,
      headers: {
        authorization: await this.basic(),
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status !== 200) throw vendorError(ESIGN, "digio", res.status, "Digio API");
    return res.json();
  }
}
