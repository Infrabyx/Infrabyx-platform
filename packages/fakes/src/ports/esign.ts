// ESIGN fake (PR-FBX-29 items 6 and 7; Udofin PR-UDF-070, R1-D-251). Deterministic envelopes that
// move to `completed` as each signer signs through `sign()`; every record carries the ESP's
// transaction id, the signer's IP and, from PR-UDF-070, the signer certificate's summary. It never
// downgrades a signer's method.
//
// PR-UDF-070: the fake is an ESP with a throwaway certification authority
// (`@infrabyx/crypto/pades-test`, made on first use in this process; nothing chains to CCA India).
// Each signer gets a certificate whose common name is their name. Given `storage`, the fake reads
// the document from STORAGE at creation (refusing a SHA-256 mismatch or a non-PDF, as the vendor
// adapters do), signs it as a real PAdES incremental update for each signer as they sign, and on
// the first download of a completed envelope writes the signed PDF and, per signer, the
// certificate chain (PEM: signer, issuing CA, root) to STORAGE: REGULATED, IPB-01-27 keys under
// the document's tenant (`esign` module), each with the SHA-256 of its bytes. `trustStore()`
// verifies its PDFs with `verifyPadesSignatures`. Without `storage` nothing is written and the
// download is the earlier reference (`<key>.signed.pdf`), as before.
//
// Multi-document envelopes: `createMultiDocumentEnvelope` and `downloadSignedDocuments`. One
// `sign()` signs every document for that signer (one ESP session); `signDocument()` signs one.
// A signer is `signed` once they signed every document; the envelope completes only then for
// every signer (all or nothing), and a decline on the envelope declines every document.
//
// PR-UDF-074 (R1-D-260): a download's `keyRef` writes the signed PDF and the chains under that
// named STORAGE key (the STORAGE fake refuses an unknown reference, so nothing is written and the
// download fails). The files are written once, at the first download: a later download naming a
// different reference (or none, after one) is refused `IPB-PORT-003` `key_ref_changed`, as an
// overwrite under another reference is in STORAGE; one naming the same reference returns them.
//
// PR-UDF-086 (R1-D-287): a signer's or a session's `returnUrl` is checked as the adapters check it
// (`returnUrlProblem`; refused `return_url_invalid`) and recorded, the session's replacing the
// signer's; `returnUrlOf(envelopeId, signerRef)` reads it. The fake's page addresses are unchanged.
//
// Test hooks: `signedObjects()`, `failNextDownload()`, `setSignerCertificate()`, `decline()`,
// `trustStore()`, `returnUrlOf()`.
import { PortError } from "@infrabyx/contracts/errors";
import {
  DocumentRef,
  EnvelopeDocuments,
  storageKey,
  type AdapterDescriptor,
  type EnvelopeDocument,
  isValidStorageKeyRef,
  returnUrlProblem,
  type EnvelopeStatus,
  type EsignDownloadOptions,
  type EsignPort,
  type PortHealth,
  type SignatureRecord,
  type SignedEnvelopeDocument,
  type Signer,
  type SignerCertificateSummary,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { sha256Hex, signerCertificateSummary, type PadesTrustStore } from "@infrabyx/crypto";
import {
  minimalPdf,
  padesTestAuthority,
  pem,
  type PadesTestAuthority,
  type TestSigner,
} from "@infrabyx/crypto/pades-test";

const up = async (): Promise<PortHealth> => ({
  status: "up",
  latency_ms: 0,
  checked_at: new Date().toISOString(),
});

const refuse = (reason: string, detail: string): PortError =>
  new PortError("IPB-PORT-001", "ESIGN", { adapter: "fake-esign", detail, meta: { reason } });
function checkReturnUrl(url: unknown): asserts url is string {
  const problem = returnUrlProblem(url);
  if (problem)
    throw new PortError("IPB-PORT-001", "ESIGN", {
      adapter: "fake-esign",
      detail: `invalid return URL (${problem})`,
      meta: { reason: "return_url_invalid", problem },
    });
}

let authority: PadesTestAuthority | undefined;
/** The fake ESP's throwaway CA, shared by every `FakeEsign` in the process (made on first use). */
const fakeAuthority = (): PadesTestAuthority => (authority ??= padesTestAuthority());
/** Signer certificates, per signer reference and name, shared in the process (key generation). */
const issued = new Map<string, TestSigner>();

/** A deterministic IPB-01-27 key segment (a ULID-shaped hash) for `parts`. */
const ulidOf = (...parts: string[]): string =>
  `0${sha256Hex(parts.join("|")).slice(0, 25).toUpperCase()}`;

export interface FakeEsignOptions {
  now?: () => Date;
  /** PR-UDF-070: STORAGE for the documents, the signed PDFs and the certificate chains. */
  storage?: StoragePort;
}

/** One signed document the fake wrote to STORAGE (PR-UDF-070 test hook). */
export interface FakeEsignSignedObject {
  envelopeId: string;
  documentId: string;
  storageKey: string;
  sha256: string;
  /** The PDF signed: the stored `original`, or a minimal `fixture` PDF when the original cannot
   * take a classic incremental update (cross-reference streams). */
  base: "original" | "fixture";
  /** Per signer, the certificate chain written (PEM). */
  chains: { signerRef: string; storageKey: string; sha256: string }[];
  /** PR-UDF-074: the named STORAGE key reference the files were written under, if any. */
  keyRef?: string;
}

interface Certificate {
  /** The certificate that signs the PDF. */
  signer: TestSigner;
  /** The certificate the record and the chain name (differs only when injected as bytes). */
  der: Uint8Array;
  chain: Uint8Array[];
}

interface FakeDoc {
  doc: DocumentRef;
  fields: unknown[];
  bytes?: Buffer;
  base?: "original" | "fixture";
  signedBy: string[];
  records: SignatureRecord[];
  written?: FakeEsignSignedObject;
}

interface FakeEnvelope {
  envelopeId: string;
  vendorRef: string;
  state: EnvelopeStatus["state"];
  signers: (EnvelopeStatus["signers"][number] & { name: string })[];
  docs: FakeDoc[];
  multi: boolean;
}

/**
 * A deterministic ESIGN fake (PR-FBX-29 item 6; PR-UDF-070). `new FakeEsign()` and
 * `new FakeEsign(() => date)` behave as before (nothing written to STORAGE);
 * `new FakeEsign({ storage })` writes the signed files and chains.
 */
export class FakeEsign implements EsignPort {
  readonly descriptor: AdapterDescriptor = {
    port: "ESIGN",
    adapter: "fake-esign",
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  health = up;
  private readonly envelopes = new Map<string, FakeEnvelope>();
  private readonly returnUrls = new Map<string, string>();
  private readonly overrides = new Map<
    string,
    Omit<Certificate, "signer"> & { signer?: TestSigner }
  >();
  private readonly written: FakeEsignSignedObject[] = [];
  private failure: Error | undefined;
  private n = 0;
  private readonly now: () => Date;
  private readonly storage: StoragePort | undefined;

  constructor(o: (() => Date) | FakeEsignOptions = {}) {
    const opts = typeof o === "function" ? { now: o } : o;
    this.now = opts.now ?? (() => new Date());
    this.storage = opts.storage;
  }

  // ------------------------------------------------------------------ test hooks

  /** PR-UDF-086: the return URL recorded for a signer (the last session's, else the signer's). */
  returnUrlOf(envelopeId: string, signerRef: string): string | undefined {
    return this.returnUrls.get(`${envelopeId}/${signerRef}`);
  }

  /** The signed PDFs and chains written to STORAGE so far, in order. */
  signedObjects(): FakeEsignSignedObject[] {
    return this.written.map((w) => ({ ...w, chains: w.chains.map((c) => ({ ...c })) }));
  }

  /** The next `downloadSigned` or `downloadSignedDocuments` rejects with `error`; nothing is written. */
  failNextDownload(error?: Error): void {
    this.failure =
      error ??
      new PortError("IPB-PORT-002", "ESIGN", {
        adapter: "fake-esign",
        detail: "injected download failure",
        meta: { reason: "injected" },
      });
  }

  /**
   * The certificate `signerRef` signs with from now on. A `TestSigner` (from a `pades-test`
   * authority) signs the PDF and is named in the record; a DER or PEM certificate is only named
   * in the record and the chain, while the PDF is still signed with the fake's own certificate
   * (a mismatch, for a product's negative tests).
   */
  setSignerCertificate(signerRef: string, cert: TestSigner | Uint8Array | string): void {
    if (typeof cert === "object" && "key" in cert && "chain" in cert) {
      this.overrides.set(signerRef, { signer: cert, der: cert.der, chain: cert.chain });
      return;
    }
    const der = typeof cert === "string" ? pemToDer(cert) : Uint8Array.from(cert);
    signerCertificateSummary(der); // refuses a non-certificate now, not at signing
    this.overrides.set(signerRef, { der, chain: [] });
  }

  /** The trust store that verifies this fake's signed PDFs (`verifyPadesSignatures`). */
  trustStore(): PadesTrustStore {
    return fakeAuthority().trust;
  }

  /** A signer declines at the ESP: the envelope (every document) is `declined`. */
  decline(id: string, signerRef: string): EnvelopeStatus {
    const e = this.get(id);
    const s = e.signers.find((x) => x.ref === signerRef);
    if (!s || !["sent", "partially_signed"].includes(e.state))
      throw new Error("cannot decline now");
    s.state = "declined";
    e.state = "declined";
    return this.status(id);
  }

  /** Test helper: a signer signs every document of the envelope at the ESP from `ip`. */
  sign(id: string, signerRef: string, ip = "203.0.113.10"): EnvelopeStatus {
    const e = this.signable(id, signerRef);
    for (const d of e.docs) if (!d.signedBy.includes(signerRef)) this.signOne(e, d, signerRef, ip);
    return this.status(id);
  }

  /** Test helper: a signer signs one document of a multi-document envelope. */
  signDocument(id: string, signerRef: string, documentId: string, ip = "203.0.113.10") {
    const e = this.signable(id, signerRef);
    const d = e.docs.find((x) => x.doc.documentId === documentId);
    if (!d || d.signedBy.includes(signerRef)) throw new Error("cannot sign this document now");
    this.signOne(e, d, signerRef, ip);
    return this.status(id);
  }

  // ------------------------------------------------------------------ the port

  async createEnvelope(
    doc: DocumentRef,
    signers: Signer[],
    _order?: "sequential" | "parallel",
    fields?: unknown[],
  ): Promise<{ envelopeId: string }> {
    DocumentRef.parse(doc);
    if (!signers.length) throw new RangeError("an envelope has a signer");
    return this.create([{ doc, fields: fields ?? [] }], signers, false);
  }

  async createMultiDocumentEnvelope(
    documents: EnvelopeDocument[],
    signers: Signer[],
    _order: "sequential" | "parallel",
  ): Promise<{ envelopeId: string }> {
    const ds = EnvelopeDocuments.safeParse(documents);
    const refs = new Set(signers.map((s) => s.ref));
    if (
      !ds.success ||
      !signers.length ||
      refs.size !== signers.length ||
      ds.data.some((d) => d.fields.some((f) => !refs.has(f.signerRef)))
    )
      throw refuse(
        "invalid_request",
        "invalid multi-document envelope (1 to 10 unique documents, signers, fields naming a signer)",
      );
    return this.create(ds.data, signers, true);
  }

  async sendForSignature(id: string): Promise<EnvelopeStatus> {
    const e = this.get(id);
    if (e.state === "draft") e.state = "sent";
    return this.status(id);
  }

  async getStatus(id: string): Promise<EnvelopeStatus> {
    return this.status(id);
  }

  async downloadSigned(id: string, opts?: EsignDownloadOptions) {
    const keyRef = keyRefOf(opts);
    const e = this.get(id);
    if (e.docs.length > 1)
      throw refuse("multi_document", "an envelope of several documents: downloadSignedDocuments");
    const [d] = (await this.download(e, keyRef)) as [SignedEnvelopeDocument];
    return { storageKey: d.storageKey, sha256: d.sha256, signatures: d.signatures };
  }

  async downloadSignedDocuments(
    id: string,
    opts?: EsignDownloadOptions,
  ): Promise<{ documents: SignedEnvelopeDocument[] }> {
    const keyRef = keyRefOf(opts);
    return { documents: await this.download(this.get(id), keyRef) };
  }

  async aadhaarEsign(session: {
    envelopeId: string;
    signerRef: string;
    method?: "AADHAAR_OTP_ESIGN" | "AADHAAR_BIO_ESIGN";
    returnUrl?: string;
  }) {
    this.session(session);
    return { redirectUrl: `https://fake-esp.invalid/${session.envelopeId}/${session.signerRef}` };
  }

  async dscSign(session: { envelopeId: string; signerRef: string; returnUrl?: string }) {
    this.session(session);
    return { redirectUrl: `https://fake-dsc.invalid/${session.envelopeId}/${session.signerRef}` };
  }

  async verifySignature(doc: DocumentRef) {
    for (const e of this.envelopes.values())
      for (const d of e.docs)
        if (
          `${d.doc.storageKey}.signed.pdf` === doc.storageKey ||
          d.written?.storageKey === doc.storageKey
        )
          return { valid: e.state === "completed", signatures: d.records.map((r) => ({ ...r })) };
    return { valid: false, signatures: [] };
  }

  async cancel(id: string): Promise<void> {
    const e = this.get(id);
    if (e.state === "completed") throw new RangeError("the envelope is completed");
    e.state = "cancelled";
  }

  async handleWebhook(rawBody: Uint8Array): Promise<EnvelopeStatus> {
    const { envelopeId } = JSON.parse(new TextDecoder().decode(rawBody)) as { envelopeId: string };
    return this.status(envelopeId);
  }

  // ------------------------------------------------------------------ internals

  private session(session: { envelopeId: string; signerRef: string; returnUrl?: string }): void {
    if (session.returnUrl !== undefined) checkReturnUrl(session.returnUrl);
    this.get(session.envelopeId);
    if (session.returnUrl)
      this.returnUrls.set(`${session.envelopeId}/${session.signerRef}`, session.returnUrl);
  }

  private async create(
    docs: ReadonlyArray<{ doc: DocumentRef; fields: unknown[] }>,
    signers: Signer[],
    multi: boolean,
  ): Promise<{ envelopeId: string }> {
    for (const s of signers) if (s.returnUrl !== undefined) checkReturnUrl(s.returnUrl);
    const loaded: FakeDoc[] = [];
    for (const { doc, fields } of docs) {
      const d: FakeDoc = { doc, fields, signedBy: [], records: [] };
      if (this.storage) {
        const o = await this.storage.get(doc.storageKey);
        if (sha256Hex(o.body) !== doc.sha256)
          throw refuse("hash_mismatch", "the stored document does not match its SHA-256");
        if (Buffer.from(o.body.subarray(0, 5)).toString("latin1") !== "%PDF-")
          throw refuse("invalid_request", "only PDF documents are signed");
        if (!/^tenant\/[^/]+\//.test(doc.storageKey))
          throw refuse("invalid_request", "the document key has no tenant");
        d.bytes = Buffer.from(o.body);
      }
      loaded.push(d);
    }
    const id = `esr_FAKE${String(++this.n).padStart(22, "0")}`;
    this.envelopes.set(id, {
      envelopeId: id,
      vendorRef: `fake-${this.n}`,
      state: "draft",
      signers: signers.map((s) => ({
        ref: s.ref,
        state: "pending",
        method: s.method,
        name: s.name,
      })),
      docs: loaded,
      multi,
    });
    for (const s of signers) if (s.returnUrl) this.returnUrls.set(`${id}/${s.ref}`, s.returnUrl);
    return { envelopeId: id };
  }

  private get(id: string): FakeEnvelope {
    const e = this.envelopes.get(id);
    if (!e) throw new PortError("IPB-PORT-001", "ESIGN", { detail: "unknown envelope" });
    return e;
  }

  private status(id: string): EnvelopeStatus {
    const e = this.get(id);
    return {
      envelopeId: e.envelopeId,
      vendorRef: e.vendorRef,
      state: e.state,
      signers: e.signers.map(({ name: _name, ...s }) => ({ ...s })),
      ...(e.multi
        ? {
            documents: e.docs.map((d) => ({
              documentId: d.doc.documentId,
              state:
                d.signedBy.length === e.signers.length
                  ? ("signed" as const)
                  : d.signedBy.length
                    ? ("partially_signed" as const)
                    : ("pending" as const),
              signedBy: [...d.signedBy],
            })),
          }
        : {}),
    };
  }

  private signable(id: string, signerRef: string): FakeEnvelope {
    const e = this.get(id);
    const s = e.signers.find((x) => x.ref === signerRef);
    if (!s || s.state === "declined" || !["sent", "partially_signed"].includes(e.state))
      throw new Error("cannot sign now");
    return e;
  }

  private issue(signerRef: string, name: string): TestSigner {
    const cn = name.slice(0, 64);
    const k = `${signerRef}\u0000${cn}`;
    let c = issued.get(k);
    if (!c) {
      c = fakeAuthority().newSigner({ subject: cn });
      issued.set(k, c);
    }
    return c;
  }

  private certificate(signerRef: string, name: string): Certificate {
    const o = this.overrides.get(signerRef);
    if (o) return { ...o, signer: o.signer ?? this.issue(signerRef, name) };
    const signer = this.issue(signerRef, name);
    return { signer, der: signer.der, chain: [...signer.chain, fakeAuthority().root.der] };
  }

  private signOne(e: FakeEnvelope, d: FakeDoc, signerRef: string, ip: string): void {
    const s = e.signers.find((x) => x.ref === signerRef)!;
    const at = this.now();
    const cert = this.certificate(signerRef, s.name);
    if (d.bytes) {
      try {
        d.bytes = fakeAuthority().sign(d.bytes, { signer: cert.signer, m: at });
        d.base ??= "original";
      } catch {
        // The original cannot take a classic incremental update: sign a minimal fixture instead.
        if (d.base) throw new Error("the fake cannot sign this document");
        d.bytes = fakeAuthority().sign(minimalPdf(), { signer: cert.signer, m: at });
        d.base = "fixture";
      }
    }
    const summary: SignerCertificateSummary = signerCertificateSummary(cert.der);
    const docPart = e.multi ? d.doc.documentId : "";
    d.signedBy.push(signerRef);
    d.records.push({
      alg: "rsa-pkcs1-sha256",
      keyId: `fake-key-${signerRef}`,
      certChainRef: d.bytes ? this.chainKey(e, d, signerRef) : `fake-chain-${signerRef}`,
      signerRef,
      signedAt: at.toISOString(),
      espTransactionId: `ESP-${sha256Hex(e.envelopeId + signerRef + docPart)
        .slice(0, 16)
        .toUpperCase()}`,
      signerIp: ip,
      signerCertificate: summary,
    });
    if (e.docs.every((x) => x.signedBy.includes(signerRef))) {
      s.state = "signed";
      s.at = at.toISOString();
    }
    e.state = e.signers.every((x) => x.state === "signed") ? "completed" : "partially_signed";
  }

  private tenantOf(d: FakeDoc): string {
    return /^tenant\/([^/]+)\//.exec(d.doc.storageKey)![1] as string;
  }

  private chainKey(e: FakeEnvelope, d: FakeDoc, signerRef: string): string {
    return storageKey(this.tenantOf(d), "esign", ulidOf(e.envelopeId, signerRef, "chain"), "pem");
  }

  private async download(
    e: FakeEnvelope,
    keyRef: string | undefined,
  ): Promise<SignedEnvelopeDocument[]> {
    if (this.failure) {
      const f = this.failure;
      this.failure = undefined;
      throw f;
    }
    if (e.state !== "completed")
      throw new PortError("IPB-PORT-001", "ESIGN", {
        detail: "envelope not completed",
        meta: { reason: "not_completed" },
      });
    const out: SignedEnvelopeDocument[] = [];
    for (const d of e.docs) {
      const signatures = d.records.map((r) => ({ ...r }));
      if (!this.storage || !d.bytes) {
        // Before PR-UDF-070 (no STORAGE): a reference only; the hash leaves the new field out.
        const plain = d.records.map(({ signerCertificate: _c, ...r }) => r);
        out.push({
          documentId: d.doc.documentId,
          storageKey: `${d.doc.storageKey}.signed.pdf`,
          sha256: sha256Hex(d.doc.sha256 + JSON.stringify(plain)),
          signatures,
        });
        continue;
      }
      if (d.written && d.written.keyRef !== keyRef)
        throw new PortError("IPB-PORT-003", "ESIGN", {
          adapter: "fake-esign",
          detail: "the signed file exists under another key reference",
          meta: { reason: "key_ref_changed" },
        });
      d.written ??= await this.write(e, d, keyRef);
      out.push({
        documentId: d.doc.documentId,
        storageKey: d.written.storageKey,
        sha256: d.written.sha256,
        signatures,
      });
    }
    return out;
  }

  private async write(
    e: FakeEnvelope,
    d: FakeDoc,
    keyRef: string | undefined,
  ): Promise<FakeEsignSignedObject> {
    const storage = this.storage!;
    const pdf = d.bytes!;
    const key = storageKey(
      this.tenantOf(d),
      "esign",
      ulidOf(e.envelopeId, d.doc.documentId, "signed"),
      "pdf",
    );
    const sha256 = sha256Hex(pdf);
    const named = keyRef !== undefined ? { keyRef } : {};
    await storage.put(key, pdf, {
      bucketClass: "REGULATED",
      contentType: "application/pdf",
      sha256,
      ...named,
    });
    const chains: FakeEsignSignedObject["chains"] = [];
    for (const signerRef of d.signedBy) {
      const s = e.signers.find((x) => x.ref === signerRef)!;
      const c = this.certificate(signerRef, s.name);
      const body = Buffer.from([c.der, ...c.chain].map((x) => pem(x)).join(""), "utf8");
      const chainKey = this.chainKey(e, d, signerRef);
      const chainSha = sha256Hex(body);
      await storage.put(chainKey, body, {
        bucketClass: "REGULATED",
        contentType: "application/pem-certificate-chain",
        sha256: chainSha,
        ...named,
      });
      chains.push({ signerRef, storageKey: chainKey, sha256: chainSha });
    }
    const w: FakeEsignSignedObject = {
      envelopeId: e.envelopeId,
      documentId: d.doc.documentId,
      storageKey: key,
      sha256,
      base: d.base ?? "original",
      chains,
      ...named,
    };
    this.written.push(w);
    return w;
  }
}

/** PR-UDF-074: a malformed reference is refused before anything is read or written. */
function keyRefOf(opts: EsignDownloadOptions | undefined): string | undefined {
  const keyRef = opts?.keyRef;
  if (keyRef !== undefined && (typeof keyRef !== "string" || !isValidStorageKeyRef(keyRef)))
    throw new PortError("IPB-PORT-003", "ESIGN", {
      adapter: "fake-esign",
      detail: "the signed file's key reference is malformed",
      meta: { reason: "key_ref_invalid" },
    });
  return keyRef;
}

function pemToDer(text: string): Uint8Array {
  const m = /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----/.exec(text);
  if (!m) throw new TypeError("not an X.509 certificate");
  return Buffer.from((m[1] as string).replace(/\s+/g, ""), "base64");
}
