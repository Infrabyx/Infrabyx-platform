// The recording ESTAMP adapters' shared rules (Udofin PR-UDF-054, R1-D-245): `shcil-estamp`,
// `digio-estamp` and `manual-paper` record a stamp the regulated entity already paid for through
// its own channel, against the stamped instrument. None of them buys anything: `purchase` is
// refused with the fixed label `purchase_not_permitted` before any other check, and `quoteDuty`
// (a RULES computation in the product) and `handleWebhook` are `unsupported`.
//
// Rules here, for every recording adapter: off until its setting; the shared `assertStampRecord`
// check (an agent recorder, deficient stamping, a malformed record or key); one record per
// idempotency key (a deterministic `est_` id), another record under the key `IPB-PORT-004`; a
// certificate number once per State and channel (`IPB-PORT-004`, `certificate_reused`: a stamp is
// used for one instrument); an issue time not in the future; the stamped document a PDF whose bytes
// match its SHA-256; a certificate attached to one document. The purchaser's name is never kept or
// sent: only the party reference stays on the record. The product writes the record in its kernel
// mutation, so the hash-chained ledger entry is in the same transaction; its store needs a unique
// index on (State, channel, certificate number).
import { PortError } from "@infrabyx/contracts/errors";
import {
  STAMP_PURCHASE_NOT_PERMITTED,
  assertStampRecord,
  type AdapterDescriptor,
  type DutyQuote,
  type EstampCertificate,
  type EstampPort,
  type EstampState,
  type PortCall,
  type PortHealth,
  type StampCertificateRecord,
  type StampRecordChannel,
  type StampVerification,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { canonicalize, deterministicId, sha256Hex } from "@infrabyx/crypto";

export const ESTAMP = "ESTAMP";
const ANCHOR = new Date("2026-11-20T00:00:00Z");
const DOCUMENT_ID = /^[A-Za-z0-9_.:-]{3,128}$/;
/** Clock skew allowed on an issue time. */
const SKEW_MS = 5 * 60_000;

/** One recorded stamp, as the product keeps it. */
export interface StoredStamp {
  certificate: EstampCertificate;
  /** SHA-256 of the JCS form of the validated record: a replayed key must carry the same one. */
  requestSha256: string;
  /** The product's document the certificate is attached to, once attached. */
  documentId: string | null;
}

/** The product's store of recorded stamps (a table with a unique State, channel and number). */
export interface StampRecordStore {
  get(certificateId: string): Promise<StoredStamp | null>;
  /** The stamp recorded under this State, channel and number, by any recording adapter. */
  byNumber(
    stateCode: string,
    channel: StampRecordChannel,
    certificateNumber: string,
  ): Promise<StoredStamp | null>;
  put(s: StoredStamp): Promise<void>;
}

export class MemoryStampRecordStore implements StampRecordStore {
  private readonly m = new Map<string, StoredStamp>();
  async get(certificateId: string) {
    return this.m.get(certificateId) ?? null;
  }
  async byNumber(stateCode: string, channel: StampRecordChannel, certificateNumber: string) {
    for (const s of this.m.values())
      if (
        s.certificate.stateCode === stateCode &&
        s.certificate.channel === channel &&
        s.certificate.certificateNumber === certificateNumber
      )
        return s;
    return null;
  }
  async put(s: StoredStamp) {
    this.m.set(s.certificate.certificateId, s);
  }
}

export interface RecordingEstampOptions {
  /** The adapter's `int.estamp.<name>.enabled`, read on every call (default false). */
  enabled: () => Promise<boolean> | boolean;
  /** Where the stamped instrument is read from to check its SHA-256. */
  storage: StoragePort;
  records: StampRecordStore;
  now?: () => number;
}

/** What the issuer (or, for paper, the record itself) says about a certificate. */
export interface IssuerCheck {
  state: EstampState;
  vendorRef: string;
  vendorCertificateId?: string;
  verification: StampVerification;
}

export const estampRefused = (adapter: string, detail: string, reason: string): PortError =>
  new PortError("IPB-PORT-001", ESTAMP, { adapter, detail, meta: { reason, definite: true } });

/** The descriptor every recording adapter shares (India-hosted; duty and parties are REGULATED). */
export function recordingDescriptor(adapter: string): AdapterDescriptor {
  return {
    port: ESTAMP,
    adapter,
    residency: "IN",
    maxDataClass: "REGULATED",
    capabilities: {
      recordCertificate: "native",
      purchase: "unsupported",
      quoteDuty: "unsupported",
      handleWebhook: "unsupported",
    },
  };
}

/** The date of an instant in India (UTC+05:30), `YYYY-MM-DD`: how issuers print an issue date. */
export function indiaDate(iso: string): string {
  return new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
}

/** An amount in rupees with at most two decimals (`"500"`, `"500.5"`, `"500.00"`) in paise. */
export function rupeesToPaise(v: unknown): number | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/**
 * Refuses a certificate whose issuer record differs from what the RE recorded (`certificate_mismatch`,
 * naming the fields, never their values).
 */
export function assertIssuerMatches(
  adapter: string,
  r: StampCertificateRecord,
  got: {
    certificateNumber?: unknown;
    stateCode?: unknown;
    dutyMinor: number | null;
    issueDate?: unknown;
  },
): void {
  const differ: string[] = [];
  if (got.certificateNumber !== r.certificateNumber) differ.push("certificate number");
  if (got.stateCode !== r.state) differ.push("State");
  if (got.dutyMinor !== r.dutyMinor) differ.push("duty");
  if (got.issueDate !== indiaDate(r.issuedAt)) differ.push("issue date");
  if (differ.length)
    throw estampRefused(
      adapter,
      `the issuer's certificate differs from the record: ${differ.join(", ")}`,
      "certificate_mismatch",
    );
}

export abstract class RecordingEstamp implements EstampPort {
  readonly descriptor: AdapterDescriptor;

  protected constructor(
    protected readonly o: RecordingEstampOptions,
    protected readonly spec: {
      adapter: string;
      /** The setting that switches it on, for the refusal's text. */
      setting: string;
      channels: readonly StampRecordChannel[];
    },
  ) {
    this.descriptor = recordingDescriptor(spec.adapter);
  }

  /** Asks the issuer about a new record (or, for paper, accepts it as recorded). */
  protected abstract check(r: StampCertificateRecord, certificateId: string): Promise<IssuerCheck>;
  /** Reads a recorded certificate back from its issuer. */
  protected abstract readBack(s: StoredStamp): Promise<IssuerCheck>;
  abstract health(): Promise<PortHealth>;

  protected refused(detail: string, reason: string): PortError {
    return estampRefused(this.spec.adapter, detail, reason);
  }

  protected async guard(): Promise<void> {
    if (!(await this.o.enabled()))
      throw this.refused(
        `the ${this.spec.adapter} adapter is off (${this.spec.setting})`,
        "adapter_disabled",
      );
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  async recordCertificate(
    raw: Parameters<NonNullable<EstampPort["recordCertificate"]>>[0],
    idempotencyKey: string,
    _call?: PortCall,
  ): Promise<EstampCertificate> {
    const adapter = this.spec.adapter;
    const r = assertStampRecord(ESTAMP, raw, idempotencyKey, adapter);
    if (!this.spec.channels.includes(r.channel))
      throw this.refused(
        `${adapter} records ${this.spec.channels.join(" and ")} only`,
        "channel_unsupported",
      );
    await this.guard();
    if (Date.parse(r.issuedAt) > this.now() + SKEW_MS)
      throw this.refused("the stamp's issue time is in the future", "invalid_request");
    const certificateId = deterministicId("est", `estamp.${adapter}`, idempotencyKey, ANCHOR);
    const requestSha256 = sha256Hex(canonicalize(r));
    // A retry with the same key returns the first record; another record under it is refused.
    const prior = await this.o.records.get(certificateId);
    if (prior) {
      if (prior.requestSha256 !== requestSha256)
        throw new PortError("IPB-PORT-004", ESTAMP, {
          adapter,
          detail: "idempotency key reused with a different stamp record",
        });
      return prior.certificate;
    }
    // A stamp pays for one instrument: its number is recorded once per State and channel.
    const used = await this.o.records.byNumber(r.state, r.channel, r.certificateNumber);
    if (used)
      throw new PortError("IPB-PORT-004", ESTAMP, {
        adapter,
        detail: "this certificate is already recorded (a stamp is used for one instrument)",
        meta: { reason: "certificate_reused" },
      });
    const o = await this.o.storage.get(r.stampedDocument.storageKey);
    if (sha256Hex(o.body) !== r.stampedDocument.sha256)
      throw this.refused("the stored stamped document does not match its SHA-256", "hash_mismatch");
    if (Buffer.from(o.body.subarray(0, 5)).toString("latin1") !== "%PDF-")
      throw this.refused("the stamped document must be a PDF", "invalid_request");
    const c = await this.check(r, certificateId);
    if (c.state !== "issued")
      throw this.refused(`the issuer reports the certificate ${c.state}`, "certificate_not_usable");
    const vendorCertificateId = c.vendorCertificateId ?? r.vendorCertificateId;
    const certificate: EstampCertificate = {
      certificateId,
      certificateNumber: r.certificateNumber,
      state: c.state,
      stateCode: r.state,
      instrument: r.instrument,
      dutyMinor: r.dutyMinor,
      purchaserRef: r.purchaser.partyRef,
      file: null,
      vendorRef: c.vendorRef,
      adapter,
      issuedAt: new Date(r.issuedAt).toISOString(),
      channel: r.channel,
      ...(r.statedDutyMinor !== undefined ? { statedDutyMinor: r.statedDutyMinor } : {}),
      stampedDocumentSha256: r.stampedDocument.sha256,
      ...(r.certificateDocumentId !== undefined
        ? { certificateDocumentId: r.certificateDocumentId }
        : {}),
      ...(r.vendorLicence !== undefined ? { vendorLicence: r.vendorLicence } : {}),
      ...(vendorCertificateId !== undefined ? { vendorCertificateId } : {}),
      verification: c.verification,
    };
    await this.o.records.put({ certificate, requestSha256, documentId: null });
    return certificate;
  }

  private async stored(certificateId: string): Promise<StoredStamp> {
    const s = await this.o.records.get(certificateId);
    if (!s || s.certificate.adapter !== this.spec.adapter)
      throw this.refused("no stamp of ours has this id", "not_found");
    return s;
  }

  /** Reads the certificate back from its issuer (a cancelled certificate comes back `cancelled`). */
  async verify(certificateId: string): Promise<EstampCertificate> {
    await this.guard();
    const s = await this.stored(certificateId);
    const c = await this.readBack(s);
    if (c.state === s.certificate.state) return s.certificate;
    const certificate = { ...s.certificate, state: c.state };
    await this.o.records.put({ ...s, certificate });
    return certificate;
  }

  /** Links the certificate to one document of the product's; another document is refused. */
  async attach(certificateId: string, documentId: string): Promise<void> {
    await this.guard();
    if (!DOCUMENT_ID.test(documentId ?? ""))
      throw this.refused("not a document id", "invalid_request");
    const s = await this.stored(certificateId);
    if (s.documentId === documentId) return;
    if (s.documentId !== null)
      throw new PortError("IPB-PORT-004", ESTAMP, {
        adapter: this.spec.adapter,
        detail: "a certificate is attached to one document only",
      });
    await this.o.records.put({ ...s, documentId });
  }

  /** Never buys: stamp duty is bought through the RE's own channel, outside the platform. */
  async purchase(): Promise<never> {
    throw this.refused(
      `${this.spec.adapter} never buys stamp duty, paper or e-stamps; record a stamp bought through the RE's own channel with recordCertificate`,
      STAMP_PURCHASE_NOT_PERMITTED,
    );
  }

  /** Nothing is stamped here, so no State or instrument is covered for a purchase. */
  async covers(): Promise<boolean> {
    return false;
  }

  async quoteDuty(): Promise<DutyQuote> {
    throw this.refused(
      `${this.spec.adapter} does not provide quoteDuty (duty is the product's RULES computation)`,
      "unsupported",
    );
  }

  async handleWebhook(): Promise<EstampCertificate> {
    throw this.refused(`${this.spec.adapter} does not provide handleWebhook`, "unsupported");
  }
}
