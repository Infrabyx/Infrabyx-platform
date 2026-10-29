// KYC port contract cases and an in-memory fake (IPB-01-15; PR-FBX-01, R1-D-21). Adapters do not
// exist yet (OWNER-QUESTIONS #87); a future adapter runs `kycContractCases(itsSandboxFixtures)`
// with defineContractSuite("KYC", …). The fake lets products build their KYC flows now. It keeps
// nothing but what a test asks for, returns files as STORAGE references, and never returns an
// Aadhaar number.
import { expect } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import {
  AadhaarOfflineCheck,
  AmlParty,
  BankAccountCheck,
  CkycDownload,
  CkycSearch,
  DigilockerPull,
  FaceMatch,
  LivenessCheck,
  OvdOcr,
  PanCheck,
  VcipSession,
  payloadClass,
  type AdapterDescriptor,
  type KycFileRef,
  type KycPort,
  type NameMatch,
  type PortHealth,
  type ScoreResult,
  type VcipManifest,
  type VcipState,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";

/** Inputs a KYC adapter's contract run needs: the vendor sandbox's own test identities. */
export interface KycFixtures {
  pan: { pan: string; name: string; unknownPan: string };
  aadhaar: { file: KycFileRef; shareCode: string; wrongShareCode: string };
  digilockerConsent: () => string;
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

let consent = 0;
/** The fake's fixtures (no real identity: test PANs and accounts of the fake only). */
export const KYC_FAKE_FIXTURES: KycFixtures = {
  pan: { pan: "AAAPZ1234C", name: "Asha Rao", unknownPan: "ZZZPZ9999Z" },
  aadhaar: { file: ref("aadhaar-offline.zip"), shareCode: "1234", wrongShareCode: "9999" },
  digilockerConsent: () => `dl-consent-${++consent}`,
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
const AADHAAR_LIKE = /(?<![0-9])[0-9]{12}(?![0-9])/;

/**
 * In-memory KYC fake. `completeVcip` plays the official's side of a V-CIP call; the fixtures'
 * `faces.same` matches `faces.a`. Scores come from a hash, so they are stable across runs.
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
  private readonly vcips = new Map<string, VcipManifest>();
  private n = 0;
  constructor(o: { fixtures?: KycFixtures; now?: () => Date } = {}) {
    this.fx = o.fixtures ?? KYC_FAKE_FIXTURES;
    this.now = o.now ?? (() => new Date());
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
    if (r.shareCode !== this.fx.aadhaar.shareCode)
      throw new PortError("IPB-PORT-001", "KYC", {
        adapter: "fake-kyc",
        detail: "the share code does not open the file",
        meta: { reason: "share_code", definite: true },
      });
    return {
      ...this.ev(),
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

  async digilockerPull(raw: Parameters<KycPort["digilockerPull"]>[0]) {
    const r = DigilockerPull.parse(raw);
    if (this.usedConsents.has(r.consentSession))
      throw new PortError("IPB-PORT-001", "KYC", {
        adapter: "fake-kyc",
        detail: "the consent session was used",
        meta: { reason: "consent_used", definite: true },
      });
    this.usedConsents.add(r.consentSession);
    return r.docTypes.map((docType) => ({
      docType,
      file: {
        storageKey: `tenant/tnt_kyc/kyc/digilocker/${r.consentSession}/${docType}.pdf`,
        sha256: sha256Hex(`${r.consentSession}:${docType}`),
      },
      issuer: "fake-issuer",
    }));
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

/** The KYC contract: one list for the fake now and for every adapter later. */
export function kycContractCases(fx: KycFixtures): Array<ContractCase<KycPort>> {
  const noAadhaar = (v: unknown) => expect(JSON.stringify(v)).not.toMatch(AADHAAR_LIKE);
  return [
    {
      name: "every request schema classes its identity fields REGULATED; the adapter stays IN",
      async run(p) {
        for (const s of [
          PanCheck,
          AadhaarOfflineCheck,
          DigilockerPull,
          CkycSearch,
          CkycDownload,
          LivenessCheck,
          FaceMatch,
          BankAccountCheck,
          OvdOcr,
          AmlParty,
        ])
          expect(payloadClass(s).bodyHighest).toBe("REGULATED");
        expect(p.descriptor.residency).toBe("IN");
        expect(p.descriptor.maxDataClass).toBe("REGULATED");
      },
    },
    {
      name: "verifyPan: a valid PAN with its name, a partial name, an unknown PAN; a malformed PAN never reaches the vendor",
      method: "verifyPan",
      invoke: (p) => p.verifyPan({ pan: fx.pan.pan, name: fx.pan.name }),
      async run(p) {
        expect(await p.verifyPan({ pan: fx.pan.pan, name: fx.pan.name })).toMatchObject({
          status: "valid",
          nameMatch: "match",
        });
        expect(
          (await p.verifyPan({ pan: fx.pan.pan, name: `${fx.pan.name.split(" ")[0]} X` }))
            .nameMatch,
        ).not.toBe("match");
        expect((await p.verifyPan({ pan: fx.pan.unknownPan, name: fx.pan.name })).status).not.toBe(
          "valid",
        );
        await expect(p.verifyPan({ pan: "abc", name: fx.pan.name })).rejects.toThrow();
      },
    },
    {
      name: "verifyAadhaarOffline: the signature, the last four digits only, and a wrong share code refused",
      method: "verifyAadhaarOffline",
      invoke: (p) =>
        p.verifyAadhaarOffline({ file: fx.aadhaar.file, shareCode: fx.aadhaar.shareCode }),
      async run(p) {
        const r = await p.verifyAadhaarOffline({
          file: fx.aadhaar.file,
          shareCode: fx.aadhaar.shareCode,
        });
        expect(r.signatureValid).toBe(true);
        expect(r.aadhaarLast4).toMatch(/^[0-9]{4}$/);
        noAadhaar(r);
        await expect(
          p.verifyAadhaarOffline({ file: fx.aadhaar.file, shareCode: fx.aadhaar.wrongShareCode }),
        ).rejects.toMatchObject({ code: "IPB-PORT-001" });
      },
    },
    {
      name: "digilockerPull: documents by STORAGE reference; a consent session is single use",
      method: "digilockerPull",
      invoke: (p) =>
        p.digilockerPull({ consentSession: fx.digilockerConsent(), docTypes: ["PANCR"] }),
      async run(p) {
        const consentSession = fx.digilockerConsent();
        const docs = await p.digilockerPull({ consentSession, docTypes: ["PANCR", "ADHAR"] });
        expect(docs.map((d) => d.docType).sort()).toEqual(["ADHAR", "PANCR"]);
        for (const d of docs) expect(d.file.sha256).toMatch(/^[0-9a-f]{64}$/);
        noAadhaar(docs);
        await expect(p.digilockerPull({ consentSession, docTypes: ["PANCR"] })).rejects.toThrow();
      },
    },
    {
      name: "ckycSearch then ckycDownload with the authentication factor; a wrong factor is refused",
      method: "ckycDownload",
      invoke: (p) =>
        p.ckycDownload({
          ckycNumber: fx.ckyc.ckycNumber,
          authFactor: fx.ckyc.authFactor,
          consentRef: "consent-ckyc-0",
        }),
      async run(p) {
        const s = await p.ckycSearch({ idType: "PAN", idNumber: fx.ckyc.idNumber });
        expect(s).toMatchObject({ found: true, ckycNumber: fx.ckyc.ckycNumber });
        const rec = await p.ckycDownload({
          ckycNumber: fx.ckyc.ckycNumber,
          authFactor: fx.ckyc.authFactor,
          consentRef: "consent-ckyc-1",
        });
        expect(rec.record.sha256).toMatch(/^[0-9a-f]{64}$/);
        noAadhaar(rec);
        await expect(
          p.ckycDownload({
            ckycNumber: fx.ckyc.ckycNumber,
            authFactor: "0000-00-00",
            consentRef: "consent-ckyc-2",
          }),
        ).rejects.toThrow();
      },
    },
    {
      name: "liveness and face match return a score, a pass against the threshold, and the model version",
      method: "faceMatch",
      invoke: (p) => p.faceMatch({ a: fx.faces.a, b: fx.faces.same }),
      async run(p) {
        const l = await p.livenessCheck({ frames: fx.frames });
        expect(l.score).toBeGreaterThanOrEqual(0);
        expect(l.score).toBeLessThanOrEqual(1);
        expect(l.modelVersion).not.toBe("");
        expect((await p.faceMatch({ a: fx.faces.a, b: fx.faces.same })).passed).toBe(true);
        expect((await p.faceMatch({ a: fx.faces.a, b: fx.faces.other })).passed).toBe(false);
      },
    },
    {
      name: "startVcip opens a session the vendor reports back, with the official named",
      method: "startVcip",
      invoke: (p) =>
        p.startVcip({
          sessionId: "vcs_contract_0",
          tenantId: "tnt_kyc",
          customerRef: "cus:contract",
          officialRef: "usr_official",
          roomId: "room_contract_0",
          documents: [],
        }),
      async run(p) {
        const v = await p.startVcip({
          sessionId: "vcs_contract_1",
          tenantId: "tnt_kyc",
          customerRef: "cus:contract",
          officialRef: "usr_official",
          roomId: "room_contract_1",
          documents: [fx.ovd],
        });
        expect(["scheduled", "in_progress"]).toContain(v.state);
        const m = await p.vcipStatus(v.vcipId);
        expect(m).toMatchObject({
          vcipId: v.vcipId,
          sessionId: "vcs_contract_1",
          officialRef: "usr_official",
        });
        await expect(p.vcipStatus("vcip_missing")).rejects.toMatchObject({ code: "IPB-PORT-001" });
      },
    },
    {
      name: "bankAccountVerify, ovdOcr and amlScreen",
      method: "amlScreen",
      invoke: (p) => p.amlScreen({ name: fx.aml.cleanName, kind: "individual" }),
      async run(p) {
        expect(
          await p.bankAccountVerify({
            ifsc: fx.bank.ifsc,
            accountNumber: fx.bank.accountNumber,
            name: fx.bank.name,
          }),
        ).toMatchObject({ status: "valid", nameMatch: "match" });
        await expect(
          p.bankAccountVerify({ ifsc: "bad", accountNumber: fx.bank.accountNumber }),
        ).rejects.toThrow();
        const o = await p.ovdOcr({ file: fx.ovd, docType: "PAN" });
        expect(o.confidence).toBeGreaterThan(0);
        expect(
          (await p.amlScreen({ name: fx.aml.listedName, kind: "individual" })).hits.length,
        ).toBeGreaterThan(0);
        const clean = await p.amlScreen({ name: fx.aml.cleanName, kind: "individual" });
        expect(clean.hits).toEqual([]);
        expect(clean.lists.length).toBeGreaterThan(0);
      },
    },
  ];
}
