// ESIGN adapter `nsdl-esign` (Udofin PR-UDF-054, R1-D-245): NSDL e-Gov as an eSign Service Provider
// (ESP) under the Controller of Certifying Authorities' eSign API, for Aadhaar eSign (OTP and
// biometric). India-hosted (IN), REGULATED. Off behind `int.esign.nsdl.enabled` (default false) and
// `unproven` until the owner's NSDL ASP onboarding exists and its sandbox leg runs.
//
// AN ADAPTER SHELL: SIGNING IS NOT IMPLEMENTED. Under the CCA eSign API the application (the ASP)
// sends the ESP an `<Esign>` XML request carrying the document hash, **signed by the ASP with an
// enveloped XML-DSig signature using its certificate's RSA key**, and is answered with an
// XML-DSig-signed `<EsignResp>` carrying a PKCS#7 signature to embed in the PDF. RSA request
// signing is not an approved cryptography item (C-24 covers only Google service-account
// assertions), so the request is built unsigned and handed to an `EsignRequestSigner` that refuses
// (`IPB-PORT-001`, `unsupported`, `meta.step: "asp_request_signature"`); OWNER-QUESTIONS #177 (2).
// The signer is fixed inside the adapter: no option accepts another, so no unapproved primitive can
// be plugged in. Verifying the response and the signed PDF waits for the verify-only PAdES/CMS
// verifier (#162, PR-UDF-059); embedding the signature in the PDF waits for #177 (2). Until then
// `downloadSigned`, `verifySignature`, `handleWebhook`, `dscSign` and `cancel` are `unsupported`, and
// `health()` is down. The adapter makes no network call and holds no ESP host.
//
// What works when switched on: `createEnvelope` validates the envelope, accepts only Aadhaar OTP and
// biometric eSign (every other method is refused `method_unsupported`, never downgraded), reads the
// PDF from STORAGE and checks its SHA-256, and records the envelope locally; `getStatus` and
// `sendForSignature` report that local state. The signer types their Aadhaar number on the ESP's
// own page: no Aadhaar number ever passes through this adapter.
//
// CCA eSign API facts used below are [VERIFY] against the API version NSDL serves (2.1 or 3.x):
// the root element and attributes (`ver`, `sc`, `ts`, `txn`, `ekycIdType`, `aspId`, `AuthMode`,
// `responseSigType`, `responseUrl`), `AuthMode` 1 for OTP and 2 for biometric, `InputHash` with
// `hashAlgorithm="SHA256"` and `docInfo`, the `ts` format, and that the hash is of the prepared
// PDF's signed byte range (PAdES), which this shell does not prepare: it hashes the stored bytes.
//
// PR-UDF-070 (R1-D-251): no signature record exists while `downloadSigned` is `unsupported`, so
// `signerCertificate` is never set. When #177 (2) is answered, it is read from the verified
// `<EsignResp>`'s signer certificate ([VERIFY] `UserX509Certificate`) with
// `signerCertificateSummary`, or from the signed PDF. The CCA request carries up to five
// `InputHash` documents, but multi-document envelopes are refused `unsupported` until then.
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
  SignedEnvelopeDocument,
  Signer,
  SigningMethod,
  StoragePort,
} from "@infrabyx/contracts/ports";
import { deterministicId, newId, sha256Hex } from "@infrabyx/crypto";
import {
  ESIGN,
  loadEnvelope,
  methodRefused,
  NO_MULTI_DOCUMENT,
  readDocument,
  unsupported,
  validateEnvelope,
} from "./common.js";

const ADAPTER = "nsdl-esign";
const IDEMPOTENCY_ANCHOR = new Date("2026-11-20T00:00:00Z");

/** [VERIFY] the CCA eSign API's `AuthMode` codes: 1 OTP, 2 fingerprint (biometric). */
export const NSDL_AUTH_MODE: Partial<Record<SigningMethod, string>> = {
  AADHAAR_OTP_ESIGN: "1",
  AADHAAR_BIO_ESIGN: "2",
};

/** One document hash of an eSign request. */
export interface EsignInputHash {
  id: string;
  /** SHA-256, lower-case hex. */
  hash: string;
  /** Shown to the signer by the ESP: the document's title, no personal data. */
  docInfo: string;
}

export interface EsignRequestInput {
  /** [VERIFY] the API version NSDL serves. */
  ver?: string;
  /** Our transaction id (unique per request). */
  txn: string;
  ts: Date;
  aspId: string;
  authMode: string;
  responseUrl: string;
  docs: EsignInputHash[];
}

const xmlAttr = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** India time without an offset, as the CCA examples print `ts` [VERIFY]. */
const istTimestamp = (d: Date) =>
  new Date(d.getTime() + 330 * 60_000).toISOString().replace(/\.\d{3}Z$/, "");

/**
 * The unsigned CCA eSign request (STUB-SHAPED [VERIFY]). Refuses a malformed transaction id, ASP
 * id, auth mode, response URL or hash. `ekycIdType="A"` and no `ekycId`: the signer enters their
 * Aadhaar number at the ESP, never here. The `<Signature>` element is the ASP's XML-DSig, which is
 * not built (#177 (2)).
 */
export function buildEsignRequestXml(i: EsignRequestInput): string {
  const bad = (what: string) =>
    new PortError("IPB-PORT-001", ESIGN, {
      adapter: ADAPTER,
      detail: `invalid eSign request: ${what}`,
      meta: { reason: "invalid_request" },
    });
  if (!/^[A-Za-z0-9_:.-]{8,64}$/.test(i.txn)) throw bad("transaction id");
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(i.aspId)) throw bad("ASP id");
  if (!/^[1-9]$/.test(i.authMode)) throw bad("auth mode");
  if (!/^https:\/\/[^\s"'<>]+$/.test(i.responseUrl)) throw bad("response URL");
  if (!i.docs.length || i.docs.length > 5) throw bad("one to five documents");
  for (const d of i.docs) {
    if (!/^[0-9a-f]{64}$/.test(d.hash)) throw bad("document hash");
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(d.id)) throw bad("document id");
    if (d.docInfo.length < 1 || d.docInfo.length > 100) throw bad("document info");
  }
  const docs = i.docs
    .map(
      (d) =>
        `<InputHash id="${xmlAttr(d.id)}" hashAlgorithm="SHA256" docInfo="${xmlAttr(d.docInfo)}">${d.hash}</InputHash>`,
    )
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Esign ver="${xmlAttr(i.ver ?? "2.1")}" sc="Y" ts="${istTimestamp(i.ts)}" txn="${xmlAttr(i.txn)}"` +
    ` ekycIdType="A" aspId="${xmlAttr(i.aspId)}" AuthMode="${xmlAttr(i.authMode)}"` +
    ` responseSigType="pkcs7" responseUrl="${xmlAttr(i.responseUrl)}">` +
    `<Docs>${docs}</Docs>` +
    `</Esign>`
  );
}

/** Signs the eSign request as the ASP (enveloped XML-DSig, RSA-SHA256 [VERIFY]). */
export interface EsignRequestSigner {
  sign(unsignedXml: string): Promise<string>;
}

/** The only signer there is: it refuses, because ASP request signing is not approved (#177 (2)). */
export const REFUSING_ESIGN_REQUEST_SIGNER: EsignRequestSigner = {
  async sign(): Promise<string> {
    throw new PortError("IPB-PORT-001", ESIGN, {
      adapter: ADAPTER,
      detail:
        "the ASP's eSign request signature (XML-DSig, RSA) is not an approved cryptography item; NSDL eSign cannot sign until the owner approves it (OWNER-QUESTIONS #177)",
      meta: { reason: "unsupported", step: "asp_request_signature" },
    });
  },
};

export interface NsdlEsignOptions {
  /** `int.esign.nsdl.enabled`, read on every call; off until the owner's NSDL onboarding exists. */
  enabled: () => Promise<boolean> | boolean;
  store: EsignEnvelopeStore;
  storage: StoragePort;
  /** The ASP id NSDL assigns at onboarding (configuration, not a secret). */
  aspId: () => Promise<string> | string;
  /** Where the ESP posts its response (our HTTPS route). */
  responseUrl: string;
  now?: () => number;
}

export class NsdlEsign implements EsignPort {
  readonly descriptor: AdapterDescriptor = {
    port: ESIGN,
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "REGULATED",
    capabilities: {
      aadhaarEsign: "unsupported",
      dscSign: "unsupported",
      downloadSigned: "unsupported",
      verifySignature: "unsupported",
      handleWebhook: "unsupported",
      cancel: "unsupported",
      ...NO_MULTI_DOCUMENT,
    },
  };
  /** Fixed: no option replaces it (see the header). */
  private readonly signer = REFUSING_ESIGN_REQUEST_SIGNER;

  constructor(private readonly o: NsdlEsignOptions) {}

  private async guard(): Promise<void> {
    if (!(await this.o.enabled()))
      throw new PortError("IPB-PORT-001", ESIGN, {
        adapter: ADAPTER,
        detail: "the NSDL eSign adapter is off (int.esign.nsdl.enabled)",
        meta: { reason: "adapter_disabled", definite: true },
      });
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  async createEnvelope(
    doc: DocumentRef,
    signers: Signer[],
    order: "sequential" | "parallel",
    fields: Parameters<EsignPort["createEnvelope"]>[3],
    call?: PortCall,
  ): Promise<{ envelopeId: string }> {
    await this.guard();
    const v = validateEnvelope(ADAPTER, doc, signers, fields);
    for (const s of v.signers)
      if (!NSDL_AUTH_MODE[s.method]) throw methodRefused(ADAPTER, s.method);
    const envelopeId = call?.idempotencyKey
      ? deterministicId("esr", "esign.nsdl", call.idempotencyKey, IDEMPOTENCY_ANCHOR)
      : newId("esr");
    if (await this.o.store.get(envelopeId)) return { envelopeId };
    await readDocument(this.o.storage, ADAPTER, v.doc);
    await this.o.store.save({
      envelopeId,
      adapter: ADAPTER,
      // Nothing is at the ESP yet: the envelope is ours alone.
      vendorRef: `local:${envelopeId}`,
      doc: v.doc,
      order,
      signers: v.signers.map((s, i) => ({
        ref: s.ref,
        method: s.method,
        vendorKey: `${envelopeId.slice(4)}-${i + 1}`,
      })),
      createdAt: new Date(this.now()).toISOString(),
    });
    return { envelopeId };
  }

  async sendForSignature(envelopeId: string): Promise<EnvelopeStatus> {
    return this.getStatus(envelopeId);
  }

  /** The local state: nobody can have signed while the ASP request cannot be signed. */
  async getStatus(envelopeId: string): Promise<EnvelopeStatus> {
    await this.guard();
    const r = await loadEnvelope(this.o.store, ADAPTER, envelopeId);
    return {
      envelopeId,
      vendorRef: r.vendorRef,
      state: "sent",
      signers: r.signers.map((s) => ({ ref: s.ref, method: s.method, state: "pending" as const })),
    };
  }

  /**
   * Builds the signer's unsigned eSign request (the document's SHA-256, the auth mode of the
   * envelope's method), then asks the fixed signer to sign it as the ASP, which refuses.
   */
  async aadhaarEsign(session: {
    envelopeId: string;
    signerRef: string;
    method: "AADHAAR_OTP_ESIGN" | "AADHAAR_BIO_ESIGN";
  }): Promise<{ redirectUrl: string }> {
    await this.guard();
    const r = await loadEnvelope(this.o.store, ADAPTER, session.envelopeId);
    const s = r.signers.find((x) => x.ref === session.signerRef);
    if (!s)
      throw unsupported(ADAPTER, `a session for unknown signer ${session.signerRef}`, "not_found");
    const mode = NSDL_AUTH_MODE[session.method];
    if (s.method !== session.method || !mode) throw methodRefused(ADAPTER, session.method);
    const pdf = await readDocument(this.o.storage, ADAPTER, r.doc);
    const xml = buildEsignRequestXml({
      txn: s.vendorKey,
      ts: new Date(this.now()),
      aspId: await this.o.aspId(),
      authMode: mode,
      responseUrl: this.o.responseUrl,
      docs: [{ id: "1", hash: sha256Hex(pdf), docInfo: "Loan document" }],
    });
    await this.signer.sign(xml);
    // Unreachable while the signer refuses; the ESP's gateway URL is added with the approval.
    throw unsupported(ADAPTER, "aadhaarEsign");
  }

  /** No multi-document envelope until the vendor's support is verified (PR-UDF-070) [VERIFY]. */
  async createMultiDocumentEnvelope(): Promise<{ envelopeId: string }> {
    throw unsupported(ADAPTER, "createMultiDocumentEnvelope (waits for #177)");
  }

  async downloadSignedDocuments(): Promise<{ documents: SignedEnvelopeDocument[] }> {
    throw unsupported(ADAPTER, "downloadSignedDocuments (waits for #177)");
  }

  async dscSign(): Promise<{ redirectUrl: string }> {
    throw unsupported(ADAPTER, "dscSign (NSDL eSign here is Aadhaar eSign only)");
  }

  async downloadSigned(): Promise<{
    storageKey: string;
    sha256: string;
    signatures: SignatureRecord[];
  }> {
    throw unsupported(ADAPTER, "downloadSigned (embedding the ESP's signature waits for #177)");
  }

  async verifySignature(): Promise<{ valid: boolean; signatures: SignatureRecord[] }> {
    throw unsupported(ADAPTER, "verifySignature (the PAdES/CMS verifier is #162)");
  }

  async cancel(): Promise<void> {
    throw unsupported(
      ADAPTER,
      "cancel (nothing reaches the ESP; drop the envelope in the product)",
    );
  }

  async handleWebhook(): Promise<EnvelopeStatus> {
    throw unsupported(
      ADAPTER,
      "handleWebhook (the ESP's response is XML-DSig-signed; its verification is not built)",
    );
  }

  /** Down: off, or on but unable to sign until #177 (2) is answered. */
  async health(): Promise<PortHealth> {
    return { status: "down", latency_ms: 0, checked_at: new Date().toISOString() };
  }
}
