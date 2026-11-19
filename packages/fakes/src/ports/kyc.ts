// KYC port contract cases and an in-memory fake (IPB-01-15; PR-FBX-01, R1-D-21). Adapters do not
// exist yet (OWNER-QUESTIONS #87); a future adapter runs `kycContractCases(itsSandboxFixtures)`
// with defineContractSuite("KYC", …). The fake lets products build their KYC flows now. It keeps
// nothing but what a test asks for, returns files as STORAGE references, and never returns an
// Aadhaar number.
import { PortError } from "@infrabyx/contracts/errors";
import {
  AadhaarOfflineCheck,
  AmlParty,
  BankAccountCheck,
  CkycDownload,
  CkycSearch,
  DIGILOCKER_RETURN_URL_REFUSED,
  DigilockerPull,
  FaceMatch,
  LivenessCheck,
  OvdOcr,
  PanCheck,
  StartDigilocker,
  VcipSession,
  digilockerReturnUrlAllowed,
  type AdapterDescriptor,
  type DigilockerDocument,
  type KycFileRef,
  type KycPort,
  type NameMatch,
  type PortCall,
  type PortHealth,
  type ScoreResult,
  type VcipManifest,
  type VcipState,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";

/** Inputs a KYC adapter's contract run needs: the vendor sandbox's own test identities. */
export interface KycFixtures {
  pan: { pan: string; name: string; unknownPan: string };
  aadhaar: { file: KycFileRef; shareCode: string; wrongShareCode: string };
  digilockerConsent: () => string;
  /**
   * A return address on the adapter's allowed hosts (PR-UDF-040); the contract cases derive the
   * refused ones from it. Omitted: `DIGILOCKER_CONTRACT_RETURN_URL`, which the fake allows.
   */
  digilockerReturnUrl?: string;
  ckyc: { idNumber: string; ckycNumber: string; authFactor: string };
  bank: { ifsc: string; accountNumber: string; name: string };
  aml: { listedName: string; cleanName: string };
  frames: KycFileRef[];
  faces: { a: KycFileRef; same: KycFileRef; other: KycFileRef };
  ovd: KycFileRef;
}

const ref = (label: string): KycFileRef => ({
  storageKey: `tenant/tnt_kyc/kyc/fixtures/${label}`,
  sha256: sha256Hex(label),
});

/** The return address the contract cases use when the fixtures name none (PR-UDF-040). */
export const DIGILOCKER_CONTRACT_RETURN_URL = "https://kyc-return.example.com/digilocker/done";

let consent = 0;
/** The fake's fixtures (no real identity: test PANs and accounts of the fake only). */
export const KYC_FAKE_FIXTURES: KycFixtures = {
  pan: { pan: "AAAPZ1234C", name: "Asha Rao", unknownPan: "ZZZPZ9999Z" },
  aadhaar: { file: ref("aadhaar-offline.zip"), shareCode: "1234", wrongShareCode: "9999" },
  digilockerConsent: () => `dl-consent-${++consent}`,
  digilockerReturnUrl: DIGILOCKER_CONTRACT_RETURN_URL,
  ckyc: { idNumber: "AAAPZ1234C", ckycNumber: "10000000000001", authFactor: "1990-01-01" },
  bank: { ifsc: "HDFC0000001", accountNumber: "000123456789", name: "Asha Rao" },
  aml: { listedName: "Listed Person", cleanName: "Asha Rao" },
  frames: [ref("frame-1.jpg"), ref("frame-2.jpg"), ref("frame-3.jpg")],
  faces: { a: ref("selfie.jpg"), same: ref("selfie-2.jpg"), other: ref("someone-else.jpg") },
  ovd: ref("pan-card.jpg"),
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const nameMatch = (a: string, b: string): NameMatch =>
  norm(a) === norm(b)
    ? "match"
    : norm(a).split(" ")[0] === norm(b).split(" ")[0]
      ? "partial"
      : "mismatch";

/**
 * In-memory KYC fake. `completeVcip` plays the official's side of a V-CIP call; the fixtures'
 * `faces.same` matches `faces.a`. Scores come from a hash, so they are stable across runs. A
 * DigiLocker session from `startDigilocker` stays incomplete until `completeDigilocker`; any other
 * consent string is taken as completed (the fixtures' `dl-consent-<n>`). `digilockerPull` is
 * idempotent on the call's key, as the platform adapters are.
 */
export class FakeKyc implements KycPort {
  readonly descriptor: AdapterDescriptor = {
    port: "KYC",
    adapter: "fake-kyc",
    residency: "IN",
    maxDataClass: "REGULATED",
    capabilities: { ovdOcr: "emulated" },
  };
  private readonly fx: KycFixtures;
  private readonly usedConsents = new Set<string>();
  private readonly pendingConsents = new Set<string>();
  private readonly pulls = new Map<string, { request: string; docs: DigilockerDocument[] }>();
  private readonly returnHosts: readonly string[];
  private readonly vcips = new Map<string, VcipManifest>();
  private n = 0;
  constructor(
    o: {
      fixtures?: KycFixtures;
      now?: () => Date;
      /** Hosts a DigiLocker return address may name (default: the fixtures' return address). */
      digilockerReturnHosts?: readonly string[];
    } = {},
  ) {
    this.fx = o.fixtures ?? KYC_FAKE_FIXTURES;
    this.now = o.now ?? (() => new Date());
    this.returnHosts = o.digilockerReturnHosts ?? [
      new URL(this.fx.digilockerReturnUrl ?? DIGILOCKER_CONTRACT_RETURN_URL).hostname,
    ];
  }
  private readonly now: () => Date;

  private ev() {
    return {
      vendorRef: `fake-${++this.n}`,
      adapter: "fake-kyc",
      modelVersion: "fake-1",
      checkedAt: this.now().toISOString(),
    };
  }
  private score(...parts: string[]): number {
    return parseInt(sha256Hex(parts.join("|")).slice(0, 4), 16) / 0xffff;
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: this.now().toISOString() };
  }

  async verifyPan(raw: Parameters<KycPort["verifyPan"]>[0]) {
    const r = PanCheck.parse(raw);
    if (r.pan !== this.fx.pan.pan)
      return { ...this.ev(), status: "not_found" as const, nameMatch: "mismatch" as const };
    return {
      ...this.ev(),
      status: "valid" as const,
      nameMatch: nameMatch(r.name, this.fx.pan.name),
      aadhaarSeeded: true,
    };
  }

  async verifyAadhaarOffline(raw: Parameters<KycPort["verifyAadhaarOffline"]>[0]) {
    const r = AadhaarOfflineCheck.parse(raw);
    const kind = r.kind ?? "xml_zip";
    if (kind === "xml_zip" && r.shareCode !== this.fx.aadhaar.shareCode)
      throw new PortError("IPB-PORT-001", "KYC", {
        adapter: "fake-kyc",
        detail: "the share code does not open the file",
        meta: { reason: "share_code", definite: true },
      });
    return {
      ...this.ev(),
      kind,
      signatureValid: r.file.sha256 === this.fx.aadhaar.file.sha256,
      aadhaarLast4: "9012",
      name: this.fx.pan.name,
      dob: "1990-01-01",
      gender: "F" as const,
      photo: {
        storageKey: `${r.file.storageKey}.photo.jpg`,
        sha256: sha256Hex(`${r.file.sha256}:photo`),
      },
      generatedAt: this.now().toISOString(),
    };
  }

  async startDigilocker(raw: Parameters<NonNullable<KycPort["startDigilocker"]>>[0]) {
    const r = StartDigilocker.parse(raw);
    if (!digilockerReturnUrlAllowed(r.returnUrl, this.returnHosts))
      throw new PortError("IPB-PORT-001", "KYC", {
        adapter: "fake-kyc",
        detail: "the return address is not https on an allowed host",
        meta: { reason: DIGILOCKER_RETURN_URL_REFUSED, definite: true },
      });
    const ev = this.ev();
    const consentSession = `dl-session-${ev.vendorRef}`;
    this.pendingConsents.add(consentSession);
    return {
      ...ev,
      consentSession,
      signInUrl: `https://digilocker.fake.example/signin/${encodeURIComponent(consentSession)}`,
      expiresAt: new Date(this.now().getTime() + 10 * 60_000).toISOString(),
    };
  }

  /** Test helper: the customer signs in to DigiLocker and shares the documents. */
  completeDigilocker(consentSession: string): void {
    this.pendingConsents.delete(consentSession);
  }

  async digilockerPull(raw: Parameters<KycPort["digilockerPull"]>[0], call?: PortCall) {
    const r = DigilockerPull.parse(raw);
    const request = JSON.stringify([r.consentSession, [...r.docTypes].sort()]);
    const key = call?.idempotencyKey;
    const prior = key === undefined ? undefined : this.pulls.get(key);
    if (prior) {
      if (prior.request !== request)
        throw new PortError("IPB-PORT-004", "KYC", {
          adapter: "fake-kyc",
          detail: "idempotency key reused with a different DigiLocker pull",
          meta: { reason: "idempotency_conflict" },
        });
      return structuredClone(prior.docs);
    }
    if (this.pendingConsents.has(r.consentSession))
      throw new PortError("IPB-PORT-001", "KYC", {
        adapter: "fake-kyc",
        detail: "the customer has not completed the DigiLocker step",
        meta: { reason: "consent_incomplete", definite: true },
      });
    if (this.usedConsents.has(r.consentSession))
      throw new PortError("IPB-PORT-001", "KYC", {
        adapter: "fake-kyc",
        detail: "the consent session was used",
        meta: { reason: "consent_used", definite: true },
      });
    this.usedConsents.add(r.consentSession);
    const evidence = this.ev();
    const docs: DigilockerDocument[] = r.docTypes.map((docType) => ({
      docType,
      file: {
        storageKey: `tenant/tnt_kyc/kyc/digilocker/${r.consentSession}/${docType}.pdf`,
        sha256: sha256Hex(`${r.consentSession}:${docType}`),
      },
      issuer: "fake-issuer",
      evidence,
      signatureValid: true,
    }));
    if (key !== undefined) this.pulls.set(key, { request, docs: structuredClone(docs) });
    return docs;
  }

  async ckycSearch(raw: Parameters<KycPort["ckycSearch"]>[0]) {
    const r = CkycSearch.parse(raw);
    return r.idNumber === this.fx.ckyc.idNumber
      ? { ...this.ev(), found: true, ckycNumber: this.fx.ckyc.ckycNumber, name: this.fx.pan.name }
      : { ...this.ev(), found: false };
  }

  async ckycDownload(raw: Parameters<KycPort["ckycDownload"]>[0]) {
    const r = CkycDownload.parse(raw);
    if (r.ckycNumber !== this.fx.ckyc.ckycNumber || r.authFactor !== this.fx.ckyc.authFactor)
      throw new PortError("IPB-PORT-001", "KYC", {
        adapter: "fake-kyc",
        detail: "the registry refused the download",
        meta: { reason: "auth_factor", definite: true },
      });
    return {
      ...this.ev(),
      ckycNumber: r.ckycNumber,
      record: {
        storageKey: `tenant/tnt_kyc/kyc/ckyc/${r.ckycNumber}.xml`,
        sha256: sha256Hex(`ckyc:${r.ckycNumber}`),
      },
      images: [
        {
          storageKey: `tenant/tnt_kyc/kyc/ckyc/${r.ckycNumber}.photo.jpg`,
          sha256: sha256Hex(`ckyc:${r.ckycNumber}:photo`),
        },
      ],
    };
  }

  async startVcip(raw: Parameters<KycPort["startVcip"]>[0]) {
    const s = VcipSession.parse(raw);
    const vcipId = `vcip_${++this.n}`;
    const ev = this.ev();
    this.vcips.set(vcipId, {
      ...ev,
      vcipId,
      sessionId: s.sessionId,
      state: "in_progress",
      officialRef: s.officialRef,
      startedAt: ev.checkedAt,
      artefacts: [],
    });
    return { ...ev, vcipId, state: "in_progress" as const };
  }

  /** Test helper: the official ends the call with this outcome. */
  completeVcip(
    vcipId: string,
    o: { state: Extract<VcipState, "completed" | "rejected" | "dropped">; reason?: string },
  ): void {
    const v = this.vcips.get(vcipId);
    if (!v) throw new Error(`no V-CIP ${vcipId}`);
    const key = (k: string) => ({
      storageKey: `tenant/tnt_kyc/vcip/${vcipId}/${k}`,
      sha256: sha256Hex(`${vcipId}:${k}`),
    });
    this.vcips.set(vcipId, {
      ...v,
      state: o.state,
      endedAt: this.now().toISOString(),
      liveness: { score: 0.97, passed: true },
      faceMatch: { score: 0.93, passed: true },
      geo: { lat: 19.07, lon: 72.87, country: "IN", capturedAt: this.now().toISOString() },
      artefacts: [
        { kind: "video", file: key("video.webm") },
        { kind: "audio", file: key("audio.ogg") },
        { kind: "screenshot", file: key("face.jpg") },
      ],
      ...(o.reason ? { reason: o.reason } : {}),
    });
  }

  async vcipStatus(vcipId: string) {
    const v = this.vcips.get(vcipId);
    if (!v)
      throw new PortError("IPB-PORT-001", "KYC", {
        adapter: "fake-kyc",
        detail: "no such V-CIP session",
        meta: { reason: "not_found", definite: true },
      });
    return { ...v, artefacts: [...v.artefacts] };
  }

  private scored(score: number): ScoreResult {
    return { ...this.ev(), score, passed: score >= 0.8 };
  }

  async livenessCheck(raw: Parameters<KycPort["livenessCheck"]>[0]) {
    const r = LivenessCheck.parse(raw);
    return this.scored(
      r.frames.length >= 3 ? 0.9 + this.score(...r.frames.map((f) => f.sha256)) / 10 : 0.4,
    );
  }

  async faceMatch(raw: Parameters<KycPort["faceMatch"]>[0]) {
    const r = FaceMatch.parse(raw);
    const same = [r.a.sha256, r.b.sha256].every(
      (h) => h === this.fx.faces.a.sha256 || h === this.fx.faces.same.sha256,
    );
    return this.scored(
      same ? 0.9 + this.score(r.a.sha256, r.b.sha256) / 10 : this.score(r.a.sha256, r.b.sha256) / 2,
    );
  }

  async bankAccountVerify(raw: Parameters<KycPort["bankAccountVerify"]>[0]) {
    const r = BankAccountCheck.parse(raw);
    if (r.ifsc !== this.fx.bank.ifsc || r.accountNumber !== this.fx.bank.accountNumber)
      return { ...this.ev(), status: "not_found" as const };
    return {
      ...this.ev(),
      status: "valid" as const,
      nameAtBank: this.fx.bank.name.toUpperCase(),
      ...(r.name ? { nameMatch: nameMatch(r.name, this.fx.bank.name) } : {}),
    };
  }

  async ovdOcr(raw: Parameters<KycPort["ovdOcr"]>[0]) {
    const r = OvdOcr.parse(raw);
    return {
      ...this.ev(),
      fields:
        r.docType === "PAN"
          ? { pan: this.fx.pan.pan, name: this.fx.pan.name }
          : { name: this.fx.pan.name },
      confidence: 0.95,
    };
  }

  async amlScreen(raw: Parameters<KycPort["amlScreen"]>[0]) {
    const r = AmlParty.parse(raw);
    const lists = ["UNSC", "MHA_UAPA"];
    const hits =
      norm(r.name) === norm(this.fx.aml.listedName)
        ? [
            {
              list: "UNSC",
              matchedName: this.fx.aml.listedName,
              score: 0.99,
              listRef: "fake-unsc-1",
            },
          ]
        : [];
    return { ...this.ev(), hits, lists };
  }

  private malformed(): PortError {
    return new PortError("IPB-PORT-001", "KYC", {
      adapter: "fake-kyc",
      detail: "a V-CIP event names its session",
      meta: { reason: "malformed_event", definite: true },
    });
  }

  async handleWebhook(rawBody: Uint8Array, _headers?: Readonly<Record<string, string>>) {
    let id: unknown;
    try {
      id = (JSON.parse(new TextDecoder().decode(rawBody)) as { vcipId?: unknown }).vcipId;
    } catch {
      throw this.malformed();
    }
    if (typeof id !== "string") throw this.malformed();
    // Only the state read back is trusted, never the event's own claims.
    return this.vcipStatus(id);
  }
}
