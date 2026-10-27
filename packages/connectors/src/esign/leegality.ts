// ESIGN interim reference adapter `leegality` (PL3 plan §8, PL3-D-04, PL3-D-23): the Leegality
// Document Execution API over the egress client, no SDK. India-hosted (IN), test mode until its
// sandbox leg runs (`unproven`, port-contract issue). Vendor facts below are [VERIFY] until then:
// - auth: the `X-Auth-Token` header (never a bearer token); sandbox `sandbox.leegality.com/api`,
//   production `app1.leegality.com/api`;
// - create: `POST /v3.1/sign/request` with the workflow `profileId`, the PDF in base64 and the
//   invitees; the response gives `documentId` and one `signUrl` per invitation;
// - status: `GET /v3.2/sign/request?documentId=`; signed files: `GET /v3.0/document/details`;
// - cancel: `DELETE /v3.0/sign/request/invitation?signUrl=` for each unsigned invitation.
// Signature types come from the Leegality workflow, so each method maps to one configured profile
// and a method without a profile is refused (no downgrade); positions come from the workflow too.
// Webhooks: the `mac` is HMAC-SHA1 of the document id with the private salt, checked by C-25
// (PL3-C-02: constant time, replay window when a timestamp is sent); the envelope is then read
// back from the API and only that status is returned.
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
import { deterministicId, newId, verifyLeegalityMac } from "@infrabyx/crypto";
import { createEgress } from "../core/http.js";
import { parseJson, vendorError, webhookRefused } from "../messaging/common.js";
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

const HOSTS = { sandbox: "sandbox.leegality.com", production: "app1.leegality.com" } as const;
const IDEMPOTENCY_ANCHOR = new Date("2026-01-01T00:00:00Z");
const LEEGALITY_METHODS: readonly SigningMethod[] = [
  "AADHAAR_OTP_ESIGN",
  "AADHAAR_BIO_ESIGN",
  "DSC",
  "E_ACCEPTANCE_OTP",
];

export interface LeegalityOptions {
  store: EsignEnvelopeStore;
  storage: StoragePort;
  /** `secrets/<env>/esign/leegality/auth_token`. */
  authToken: () => Promise<string> | string;
  /** `secrets/<env>/esign/leegality/private_salt` (webhook `mac`, C-25). */
  privateSalt: () => Promise<string> | string;
  /** Leegality workflow (profile) id for each signing method offered. */
  profiles: Partial<Record<SigningMethod, string>>;
  /** Test mode until the owner's account exists (default `sandbox`). */
  mode?: "sandbox" | "production";
  /** Tests only: the Leegality stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
  now?: () => number;
}

interface Invitation {
  name?: string;
  signUrl: string;
  signed?: boolean;
  rejected?: boolean;
  expired?: boolean;
  signedAt?: string;
}

interface Details {
  documentId: string;
  status?: string;
  invitations?: Invitation[];
  files?: { name: string; file: string }[];
}

export class LeegalityEsign implements EsignPort {
  readonly descriptor: AdapterDescriptor;
  private readonly egress;
  private readonly base: string;

  constructor(private readonly o: LeegalityOptions) {
    const mode = o.mode ?? "sandbox";
    this.descriptor = {
      port: ESIGN,
      adapter: "leegality",
      residency: "IN",
      maxDataClass: "REGULATED",
      capabilities: { verifySignature: "unsupported" },
    };
    this.base = (o.baseUrl ?? `https://${HOSTS[mode]}/api`).replace(/\/$/, "");
    this.egress = createEgress({
      port: ESIGN,
      adapter: "leegality",
      allow: [HOSTS[mode]],
      retries: 1,
      maxBytes: 64 * 1024 * 1024,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private profileFor(signers: readonly Signer[]): string {
    const methods = new Set(signers.map((s) => s.method));
    for (const m of methods)
      if (!LEEGALITY_METHODS.includes(m) || !this.o.profiles[m])
        throw methodRefused("leegality", m);
    if (methods.size > 1)
      throw new PortError("IPB-PORT-001", ESIGN, {
        adapter: "leegality",
        detail:
          "one Leegality workflow per envelope: give every signer the same method, or split the envelope",
        meta: { reason: "method_unsupported" },
      });
    return this.o.profiles[[...methods][0] as SigningMethod] as string;
  }

  async createEnvelope(
    doc: DocumentRef,
    signers: Signer[],
    order: "sequential" | "parallel",
    fields: Parameters<EsignPort["createEnvelope"]>[3],
    call?: PortCall,
  ): Promise<{ envelopeId: string }> {
    const v = validateEnvelope("leegality", doc, signers, fields);
    if (v.fields.length)
      throw unsupported("leegality", "signature fields (set in the Leegality workflow)");
    const profileId = this.profileFor(v.signers);
    const envelopeId = call?.idempotencyKey
      ? deterministicId("esr", "esign.leegality", call.idempotencyKey, IDEMPOTENCY_ANCHOR)
      : newId("esr");
    if (await this.o.store.get(envelopeId)) return { envelopeId };
    const pdf = await readDocument(this.o.storage, "leegality", v.doc);
    const res = await this.call("POST", "/v3.1/sign/request", {
      profileId,
      file: { name: `${v.doc.documentId}.pdf`, file: Buffer.from(pdf).toString("base64") },
      invitees: v.signers.map((s) => ({
        name: s.name,
        ...(s.email ? { email: s.email } : {}),
        ...(s.phone ? { phone: s.phone.replace(/^\+91/, "") } : {}),
      })),
      irn: envelopeId,
    });
    const data = (res as { data?: { documentId?: string; invitations?: Invitation[] } }).data;
    const invitations = data?.invitations ?? [];
    if (!data?.documentId || invitations.length !== v.signers.length)
      throw vendorError(
        ESIGN,
        "leegality",
        502,
        "create response without one invitation per signer",
      );
    await this.o.store.save({
      envelopeId,
      adapter: "leegality",
      vendorRef: data.documentId,
      doc: v.doc,
      order,
      signers: v.signers.map((s, i) => ({
        ref: s.ref,
        method: s.method,
        vendorKey: (invitations[i] as Invitation).signUrl,
      })),
      createdAt: new Date(this.o.now?.() ?? Date.now()).toISOString(),
    });
    return { envelopeId };
  }

  /** Leegality sends the invitations when the request is created (workflow setting) [VERIFY]. */
  async sendForSignature(envelopeId: string): Promise<EnvelopeStatus> {
    return this.getStatus(envelopeId);
  }

  async getStatus(envelopeId: string): Promise<EnvelopeStatus> {
    const r = await loadEnvelope(this.o.store, "leegality", envelopeId);
    const d = await this.details("/v3.2/sign/request", r.vendorRef);
    const byUrl = new Map((d.invitations ?? []).map((i) => [i.signUrl, i]));
    const signers = r.signers.map((s) => {
      const i = byUrl.get(s.vendorKey);
      return {
        ref: s.ref,
        method: s.method,
        state: i?.signed
          ? ("signed" as const)
          : i?.rejected
            ? ("declined" as const)
            : ("pending" as const),
        ...(i?.signedAt ? { at: i.signedAt } : {}),
      };
    });
    const status = (d.status ?? "").toUpperCase();
    return {
      envelopeId,
      vendorRef: r.vendorRef,
      signers,
      state: overallState(signers, {
        cancelled: status === "CANCELLED",
        expired: status === "EXPIRED" || (d.invitations ?? []).some((i) => i.expired && !i.signed),
      }),
    };
  }

  async downloadSigned(
    envelopeId: string,
  ): Promise<{ storageKey: string; sha256: string; signatures: SignatureRecord[] }> {
    const st = await this.getStatus(envelopeId);
    if (st.state !== "completed")
      throw new PortError("IPB-PORT-001", ESIGN, {
        adapter: "leegality",
        detail: `envelope ${envelopeId} is ${st.state}, not completed`,
        meta: { reason: "not_completed" },
      });
    const r = await loadEnvelope(this.o.store, "leegality", envelopeId);
    const d = await this.details("/v3.0/document/details", r.vendorRef);
    const file = (d.files ?? []).find((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (!file) throw vendorError(ESIGN, "leegality", 502, "details without the signed PDF");
    const pdf = Buffer.from(file.file, "base64");
    if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-")
      throw vendorError(ESIGN, "leegality", 502, "the signed file is not a PDF");
    const stored = await storeSigned(this.o.storage, r.doc, pdf);
    return {
      ...stored,
      signatures: st.signers.map((s) => ({
        alg: `esp:leegality:${s.method.toLowerCase()}`,
        keyId: r.vendorRef,
        certChainRef: `leegality:${r.vendorRef}:audit-trail`,
        signerRef: s.ref,
        signedAt: s.at ?? "",
      })),
    };
  }

  private async session(
    envelopeId: string,
    signerRef: string,
    allowed: readonly SigningMethod[],
    asked: SigningMethod,
  ): Promise<{ redirectUrl: string }> {
    const r = await loadEnvelope(this.o.store, "leegality", envelopeId);
    const s = r.signers.find((x) => x.ref === signerRef);
    if (!s)
      throw unsupported("leegality", `a session for unknown signer ${signerRef}`, "not_found");
    if (s.method !== asked || !allowed.includes(s.method)) throw methodRefused("leegality", asked);
    return { redirectUrl: s.vendorKey };
  }

  aadhaarEsign(session: {
    envelopeId: string;
    signerRef: string;
    method: "AADHAAR_OTP_ESIGN" | "AADHAAR_BIO_ESIGN";
  }): Promise<{ redirectUrl: string }> {
    return this.session(
      session.envelopeId,
      session.signerRef,
      ["AADHAAR_OTP_ESIGN", "AADHAAR_BIO_ESIGN"],
      session.method,
    );
  }

  dscSign(session: { envelopeId: string; signerRef: string }): Promise<{ redirectUrl: string }> {
    return this.session(session.envelopeId, session.signerRef, ["DSC"], "DSC");
  }

  async verifySignature(): Promise<{ valid: boolean; signatures: SignatureRecord[] }> {
    throw unsupported("leegality", "verifySignature");
  }

  async cancel(envelopeId: string): Promise<void> {
    const st = await this.getStatus(envelopeId);
    const r = await loadEnvelope(this.o.store, "leegality", envelopeId);
    for (const s of r.signers)
      if (st.signers.find((x) => x.ref === s.ref)?.state === "pending")
        await this.call(
          "DELETE",
          `/v3.0/sign/request/invitation?signUrl=${encodeURIComponent(s.vendorKey)}`,
        );
  }

  async handleWebhook(
    rawBody: Uint8Array,
    _headers: Readonly<Record<string, string>>,
    _meta?: WebhookRequestMeta,
  ): Promise<EnvelopeStatus> {
    const body = parseJson(ESIGN, "leegality", rawBody) as Record<string, unknown>;
    const documentId = typeof body.documentId === "string" ? body.documentId : "";
    const mac = typeof body.mac === "string" ? body.mac : "";
    const ts = body.timestamp ?? body.createdAt;
    const ok = verifyLeegalityMac(await this.o.privateSalt(), documentId, mac, {
      ...(typeof ts === "string" || typeof ts === "number" ? { timestamp: ts } : {}),
      ...(this.o.now ? { now: this.o.now() } : {}),
    });
    if (!ok)
      throw webhookRefused(
        ESIGN,
        "leegality",
        "mac missing or wrong, or outside the replay window",
      );
    const r = await this.o.store.byVendorRef("leegality", documentId);
    if (!r) throw webhookRefused(ESIGN, "leegality", "unknown document");
    // The webhook is only a trigger: the status returned is the one read back from the API.
    return this.getStatus(r.envelopeId);
  }

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      const res = await this.egress(`${this.base}/v3.2/sign/request?documentId=ipb-health`, {
        method: "GET",
        headers: { "x-auth-token": await this.o.authToken(), accept: "application/json" },
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

  private async details(path: string, documentId: string): Promise<Details> {
    const res = (await this.call(
      "GET",
      `${path}?documentId=${encodeURIComponent(documentId)}`,
    )) as {
      data?: Details;
    };
    if (!res.data) throw vendorError(ESIGN, "leegality", 502, "details response without data");
    return res.data;
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.egress(`${this.base}${path}`, {
      method,
      headers: {
        "x-auth-token": await this.o.authToken(),
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status !== 200) throw vendorError(ESIGN, "leegality", res.status, "Leegality API");
    const json = res.json<{ status?: number; messages?: unknown }>();
    // Leegality reports failures as `status: 0` with messages, even on HTTP 200 [VERIFY].
    if (json.status === 0)
      throw vendorError(ESIGN, "leegality", 400, "Leegality refused the request");
    return json;
  }
}
