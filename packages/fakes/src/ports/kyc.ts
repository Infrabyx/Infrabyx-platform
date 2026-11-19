// KYC port contract cases and an in-memory fake (IPB-01-15; PR-FBX-01, R1-D-21). Adapters do not
// exist yet (OWNER-QUESTIONS #87); a future adapter runs `kycContractCases(itsSandboxFixtures)`
// with defineContractSuite("KYC", …). The fake lets products build their KYC flows now. It keeps
// nothing but what a test asks for, returns files as STORAGE references, and never returns an
// Aadhaar number.
import { verhoeffValid } from "@infrabyx/contracts";
import { PortError } from "@infrabyx/contracts/errors";
import {
  AadhaarOfflineCheck,
  AadhaarOtpRequest,
  AadhaarOtpVerify,
  aadhaarUidValid,
  AmlParty,
  BANK_ACCOUNT_MODE_UNSUPPORTED,
  BANK_ACCOUNT_MODES,
  BankAccountCheck,
  CkycDownload,
  CkycSearch,
  DIGILOCKER_RETURN_URL_REFUSED,
  DigilockerPull,
  FaceMatch,
  KYC_MODE_UNSUPPORTED,
  KYC_SCORE_OUT_OF_RANGE,
  kycScoreValid,
  LaunchVcip,
  VCIP_LAUNCH_URL_REFUSED,
  vcipHandoffFailure,
  vcipHandoffTimeRefusal,
  vcipLaunchUrlAllowed,
  LIVENESS_MODES,
  LivenessCheck,
  OvdOcr,
  PanCheck,
  StartDigilocker,
  VcipSession,
  digilockerReturnUrlAllowed,
  type AadhaarOtpRefusal,
  type AadhaarOtpResult,
  type AdapterDescriptor,
  type BankAccountMode,
  type BankAccountResult,
  type DigilockerDocument,
  type KycFileRef,
  type KycPort,
  type LivenessMode,
  type NameMatch,
  type PortCall,
  type PortHealth,
  type ScoreResult,
  type VcipHandoffContext,
  type VcipHandoffRefusal,
  type VcipLaunch,
  type VcipManifest,
  type VcipReasonCode,
  type VcipState,
} from "@infrabyx/contracts/ports";
import {
  LocalKms,
  MemoryReplayStore,
  RegulatedKeyRing,
  randomBytes,
  sha256Hex,
  signRegulatedMessage,
  toBase64Url,
  verifyRegulatedMessage,
  type ReplayStore,
} from "@infrabyx/crypto";

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
  /**
   * Aadhaar OTP e-KYC (PR-UDF-041): test numbers the vendor's sandbox (or the fake) knows, its
   * codes, and hooks the contract cases use. Optional in the type so a caller outside the platform
   * does not break in a minor; the cases need it wherever the adapter provides the methods.
   */
  aadhaarOtp?: AadhaarOtpFixtures;
  /**
   * The bank account check's mode and keyed retries (PR-UDF-043): what the adapter honours and the
   * hooks the contract cases use. Optional in the type so a caller outside the platform does not
   * break in a minor; the cases need it wherever the adapter provides `bankAccountVerify`.
   */
  bankAccount?: BankAccountFixtures;
  /**
   * Liveness and face match by mode, threshold and key (PR-UDF-044): what the adapter honours and
   * the hooks the contract cases use. Optional in the type so a caller outside the platform does not
   * break in a minor; the cases need it wherever the adapter provides `livenessCheck`.
   */
  scores?: ScoreFixtures;
  /**
   * The RE-hosted V-CIP launcher (PR-UDF-045): a signer the adapter trusts and the hooks the
   * contract cases use. Optional in the type so a caller outside the platform does not break in a
   * minor; the cases need it wherever the adapter provides `launchVcip`.
   */
  vcipLaunch?: VcipLaunchFixtures;
}

/** The V-CIP launcher part of `KycFixtures` (PR-UDF-045). Test keys and ids only. */
export interface VcipLaunchFixtures {
  /** A hand-off for the adapter's RE from an LSP it trusts, issued at `now`, with a fresh nonce. */
  context: (over?: Partial<VcipHandoffContext>, now?: Date) => VcipHandoffContext;
  /** Sign `context` as that LSP does (`signRegulatedMessage`, its key's `kid`), at `now`. */
  sign: (context: VcipHandoffContext, now?: Date) => Promise<string>;
  /** Sign `context` with a key the adapter does not trust. */
  signUntrusted: (context: VcipHandoffContext) => Promise<string>;
  /** The hosts a launch address may name. */
  launchHosts: readonly string[];
  /** The launches `port` asked its vendor for so far, so a refusal can be shown to have sent none. */
  vendorCalls: (port: KycPort) => number;
  /** End a session with this outcome (a stub or fake hook); omitted, the ended manifest is not swept. */
  finish?: (
    port: KycPort,
    vcipId: string,
    state: Extract<VcipState, "completed" | "rejected" | "dropped">,
  ) => void | Promise<void>;
}

/**
 * The fake's V-CIP hand-off (PR-UDF-045): the RE it serves, the LSP it trusts, that LSP's
 * development signing key (a `LocalKms` key: it protects nothing) and the launch host.
 */
export const FAKE_VCIP_HANDOFF = {
  reId: "re_fake",
  lspId: "lsp_fake",
  kid: "local:sign:fake-vcip-lsp",
  untrustedKid: "local:sign:fake-vcip-untrusted",
  launchHost: "vcip-launch.example.com",
} as const;

const devKms = new LocalKms();
/** Sign a hand-off with a `LocalKms` development key (`FAKE_VCIP_HANDOFF.kid` by default). Tests only. */
export function signFakeVcipHandoff(
  context: VcipHandoffContext,
  o: { kid?: string; now?: Date } = {},
): Promise<string> {
  const kid = o.kid ?? FAKE_VCIP_HANDOFF.kid;
  return signRegulatedMessage({
    event: context,
    kid,
    sign: (m) => devKms.sign(kid, m, "ecdsa-p256-sha256"),
    ...(o.now ? { now: o.now } : {}),
  });
}

/** A key ring that trusts the `LocalKms` development key `kid`. Tests only. */
export async function fakeVcipHandoffKeys(kid: string = FAKE_VCIP_HANDOFF.kid) {
  return new RegulatedKeyRing([{ kid, key: await devKms.getPublicKey(kid) }]);
}

/** A hand-off from the fake's LSP to the fake's RE, issued at `now`, living ten minutes. */
export function fakeVcipHandoffContext(
  over: Partial<VcipHandoffContext> = {},
  now: Date = new Date(),
): VcipHandoffContext {
  return {
    tenantId: "tnt_kyc",
    reId: FAKE_VCIP_HANDOFF.reId,
    lspId: FAKE_VCIP_HANDOFF.lspId,
    customerRef: "cus_handoff_1",
    journeyId: `jrn_${toBase64Url(randomBytes(9)).replace(/[^A-Za-z]/g, "x")}`,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    nonce: toBase64Url(randomBytes(16)),
    ...over,
  };
}

/** The liveness and face-match part of `KycFixtures` (PR-UDF-044). Test files only. */
export interface ScoreFixtures {
  /** The liveness mode the adapter uses when a check names none. */
  configuredMode: LivenessMode;
  /** Every liveness mode the adapter honours (the configured one among them). */
  modes: readonly LivenessMode[];
  /** An adapter that cannot honour `mode`, and the liveness checks it sent its vendor. */
  refusing: () => { port: KycPort; mode: LivenessMode; vendorCalls: () => number };
  /** The liveness requests `port` sent its vendor so far. */
  livenessVendorCalls: (port: KycPort) => number;
  /** The face-match requests `port` sent its vendor so far. */
  faceMatchVendorCalls: (port: KycPort) => number;
  /**
   * Make the vendor's next score fall off its scale (a stub or fake hook), so the case can show it
   * is refused `IPB-PORT-003` rather than clamped; omitted, that check is skipped.
   */
  offScaleNext?: (port: KycPort) => void | Promise<void>;
}

/** The bank account part of `KycFixtures` (PR-UDF-043). Test accounts only. */
export interface BankAccountFixtures {
  /** The mode the adapter uses when a check names none. */
  configuredMode: BankAccountMode;
  /** Every mode the adapter honours (the configured one among them). */
  modes: readonly BankAccountMode[];
  /** An account (on `bank.ifsc`) the vendor does not know, answered `not_found`. */
  unknownAccountNumber: string;
  /** An adapter that cannot honour `mode`, and the verifications it sent its vendor. */
  refusing: () => { port: KycPort; mode: BankAccountMode; vendorCalls: () => number };
  /** The account verifications `port` sent its vendor so far (one per check made). */
  vendorCalls: (port: KycPort) => number;
}

/** The Aadhaar OTP part of `KycFixtures` (PR-UDF-041). Test numbers only, never a real one. */
export interface AadhaarOtpFixtures {
  /** An Aadhaar number with a linked mobile. */
  uid: string;
  /** A Virtual ID of a resident with a linked mobile. */
  vid: string;
  /** A well-formed Aadhaar number with no mobile linked (`mobile_not_linked`). */
  unlinkedUid: string;
  /** The code that verifies, and one that does not. */
  otp: string;
  wrongOtp: string;
  /** The same adapter built without `notifiedEntity: true`, and the vendor requests it sent. */
  notNotified: () => { port: KycPort; vendorCalls: () => number };
  /** The vendor requests `port` sent so far, so a refusal can be shown to have sent none. */
  vendorCalls: (port: KycPort) => number;
  /** Expire a transaction now (a stub or fake hook); omitted, the expiry check is skipped. */
  expire?: (port: KycPort, txn: string) => void | Promise<void>;
  /** The ledger entries the adapter's verify store wrote, where it has one (a PostgreSQL store). */
  ledger?: () => Promise<readonly unknown[]>;
}

/**
 * A test number: `body` with its Verhoeff check digit appended, so no number is committed as a
 * literal. For fixtures only: a synthetic number can still coincide with a real one, so it is
 * never used outside tests.
 */
export function syntheticUid(body: string): string {
  for (let d = 0; d < 10; d++) if (verhoeffValid(`${body}${d}`)) return `${body}${d}`;
  throw new RangeError("no Verhoeff check digit");
}

/** The code the fake's OTP verifies, whatever the transaction (PR-UDF-041). */
export const FAKE_AADHAAR_OTP = "246810";

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
  // Twelve digits with a leading 0: never Aadhaar-like, so the no-Aadhaar sweep stays meaningful.
  bank: { ifsc: "HDFC0000001", accountNumber: "000123456789", name: "Asha Rao" },
  aml: { listedName: "Listed Person", cleanName: "Asha Rao" },
  frames: [ref("frame-1.jpg"), ref("frame-2.jpg"), ref("frame-3.jpg")],
  faces: { a: ref("selfie.jpg"), same: ref("selfie-2.jpg"), other: ref("someone-else.jpg") },
  ovd: ref("pan-card.jpg"),
  aadhaarOtp: {
    uid: syntheticUid("99990000011"),
    vid: syntheticUid("919900000000001"),
    unlinkedUid: syntheticUid("99990000022"),
    otp: FAKE_AADHAAR_OTP,
    wrongOtp: "135791",
    notNotified: () => {
      const f = new FakeKyc();
      return { port: f, vendorCalls: () => f.aadhaarOtpVendorCalls };
    },
    vendorCalls: (p) => (p as FakeKyc).aadhaarOtpVendorCalls,
    expire: (p, txn) => (p as FakeKyc).expireAadhaarOtp(txn),
  },
  bankAccount: {
    configuredMode: "pennyless",
    modes: BANK_ACCOUNT_MODES,
    unknownAccountNumber: "000999999990",
    refusing: () => {
      const f = new FakeKyc({ bankAccountModes: ["pennyless"] });
      return { port: f, mode: "penny_drop", vendorCalls: () => f.bankAccountVendorCalls };
    },
    vendorCalls: (p) => (p as FakeKyc).bankAccountVendorCalls,
  },
  scores: {
    configuredMode: "passive",
    modes: LIVENESS_MODES,
    refusing: () => {
      const f = new FakeKyc({ livenessModes: ["passive"] });
      return { port: f, mode: "active_voice", vendorCalls: () => f.livenessVendorCalls };
    },
    livenessVendorCalls: (p) => (p as FakeKyc).livenessVendorCalls,
    faceMatchVendorCalls: (p) => (p as FakeKyc).faceMatchVendorCalls,
    offScaleNext: (p) => (p as FakeKyc).offScaleNext(),
  },
  vcipLaunch: {
    context: fakeVcipHandoffContext,
    sign: (c, now) => signFakeVcipHandoff(c, now ? { now } : {}),
    signUntrusted: (c) => signFakeVcipHandoff(c, { kid: FAKE_VCIP_HANDOFF.untrustedKid }),
    launchHosts: [FAKE_VCIP_HANDOFF.launchHost],
    vendorCalls: (p) => (p as FakeKyc).vcipLaunchVendorCalls,
    finish: (p, vcipId, state) => (p as FakeKyc).completeVcip(vcipId, { state }),
  },
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
 *
 * Aadhaar OTP e-KYC (PR-UDF-041): off unless built with `notifiedEntity: true`, as the adapters are
 * (every call is then `not_configured`). The fixtures' `unlinkedUid` has no mobile linked; any other
 * well-formed number gets an OTP, and `FAKE_AADHAAR_OTP` verifies any live transaction once (a
 * wrong code leaves it live). A transaction lives ten minutes, or until `expireAadhaarOtp`. A verify
 * is idempotent on the call's key. The fake keeps no number: a transaction remembers the last four
 * digits only (of the fixtures' `uid` for a VID).
 *
 * Bank accounts (PR-UDF-043): the fake honours both modes unless built with `bankAccountModes`, and
 * uses `bankAccountMode` (default `pennyless`) when a check names none; a mode it does not honour is
 * refused `mode_unsupported` before its count of vendor calls moves. A check is idempotent on the
 * call's key. Nothing is ever credited: the fake's penny drop is a simulation.
 *
 * Liveness and face match (PR-UDF-044): the fake honours every liveness mode unless built with
 * `livenessModes`, uses `livenessMode` (default `passive`) when a check names none, and applies
 * `livenessThreshold` and `faceMatchThreshold` (0.8 each by default), reporting each; a mode it does
 * not honour is refused `mode_unsupported` before its count of vendor calls moves. Each method is
 * idempotent on the call's key, a key scoped to its method. `offScaleNext` makes the next score
 * fall off the 0-to-1 scale, which the fake refuses `IPB-PORT-003` as the adapters do. The fake
 * keeps no image, template or embedding (`KYC_ADAPTER_RETENTION`: none).
 *
 * The RE-hosted V-CIP launcher (PR-UDF-045): the fake serves `FAKE_VCIP_HANDOFF.reId` and trusts
 * `FAKE_VCIP_HANDOFF.lspId`'s development key unless built with `vcipHandoff`. `launchVcip` checks
 * the request, the call's tenant, the RE and the LSP, verifies the JWS with
 * `verifyRegulatedMessage` and its replay store and checks the hand-off is fresh, all before its
 * count of vendor calls moves; it answers a `scheduled` session with an `https:` launch address
 * that lapses with the hand-off. `startVcip` with that `vcipId` starts it. A scheduled session
 * reads back `expired` (`launch_expired`) once the hand-off lapses. `vcipStatus` reads under the
 * call's tenant. Every ended session carries a `reasonCode` and the liveness mode used.
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
  private readonly vcipMeta = new Map<
    string,
    { tenantId: string; customerRef: string; launchExpiresAt?: string }
  >();
  /** Launches that passed the fake's own checks (PR-UDF-045): what an adapter would ask its vendor. */
  vcipLaunchVendorCalls = 0;
  private readonly handoffReId: string;
  private readonly handoffIssuers:
    | Readonly<Record<string, RegulatedKeyRing>>
    | Promise<Readonly<Record<string, RegulatedKeyRing>>>;
  private readonly handoffReplay: ReplayStore;
  private readonly launchHosts: readonly string[];
  private readonly otpTxns = new Map<string, { expiresAt: number; used: boolean; last4: string }>();
  private readonly otpVerifies = new Map<
    string,
    { request: string; result?: AadhaarOtpResult; refused?: AadhaarOtpRefusal }
  >();
  private readonly notifiedEntity: boolean;
  /** Aadhaar OTP calls that passed the fake's own checks: what an adapter would send its KUA. */
  aadhaarOtpVendorCalls = 0;
  /** Bank account checks that passed the fake's own checks: what an adapter would send its vendor. */
  bankAccountVendorCalls = 0;
  private readonly bankModes: readonly BankAccountMode[];
  private readonly bankMode: BankAccountMode;
  private readonly bankVerifies = new Map<string, { request: string; result: BankAccountResult }>();
  /** Liveness and face-match checks that passed the fake's own checks (PR-UDF-044). */
  livenessVendorCalls = 0;
  faceMatchVendorCalls = 0;
  private readonly livenessModes: readonly LivenessMode[];
  private readonly livenessMode: LivenessMode;
  private readonly livenessThreshold: number;
  private readonly faceMatchThreshold: number;
  private readonly scoreChecks = new Map<string, { request: string; result: ScoreResult }>();
  private offScale = false;
  private n = 0;
  constructor(
    o: {
      fixtures?: KycFixtures;
      now?: () => Date;
      /** Hosts a DigiLocker return address may name (default: the fixtures' return address). */
      digilockerReturnHosts?: readonly string[];
      /** Aadhaar OTP e-KYC for a reporting entity notified under PML Act s.11A (default false). */
      notifiedEntity?: boolean;
      /** The bank account modes the fake honours (default both; PR-UDF-043). */
      bankAccountModes?: readonly BankAccountMode[];
      /** The mode a check without one uses (default `pennyless`); must be honoured. */
      bankAccountMode?: BankAccountMode;
      /** The liveness modes the fake honours (default all three; PR-UDF-044). */
      livenessModes?: readonly LivenessMode[];
      /** The mode a liveness check without one uses (default `passive`); must be honoured. */
      livenessMode?: LivenessMode;
      /** Pass marks, 0 to 1 (default 0.8 each). */
      livenessThreshold?: number;
      faceMatchThreshold?: number;
      /**
       * The RE-hosted V-CIP launcher (PR-UDF-045): the RE the fake serves, the key ring of each LSP
       * it trusts (by `lspId`), the replay store and the hosts of its launch address. Default: the
       * development key of `FAKE_VCIP_HANDOFF`.
       */
      vcipHandoff?: {
        reId?: string;
        issuers?: Readonly<Record<string, RegulatedKeyRing>>;
        replay?: ReplayStore;
        launchHosts?: readonly string[];
      };
    } = {},
  ) {
    this.livenessModes = o.livenessModes ?? LIVENESS_MODES;
    this.livenessMode = o.livenessMode ?? "passive";
    if (!this.livenessModes.includes(this.livenessMode))
      throw new RangeError("the configured liveness mode is not one the fake honours");
    this.livenessThreshold = o.livenessThreshold ?? 0.8;
    this.faceMatchThreshold = o.faceMatchThreshold ?? 0.8;
    for (const t of [this.livenessThreshold, this.faceMatchThreshold])
      if (!kycScoreValid(t)) throw new RangeError("a threshold is a number from 0 to 1");
    this.bankModes = o.bankAccountModes ?? BANK_ACCOUNT_MODES;
    this.bankMode = o.bankAccountMode ?? "pennyless";
    if (!this.bankModes.includes(this.bankMode))
      throw new RangeError("the configured bank account mode is not one the fake honours");
    this.fx = o.fixtures ?? KYC_FAKE_FIXTURES;
    this.notifiedEntity = o.notifiedEntity === true;
    this.now = o.now ?? (() => new Date());
    this.returnHosts = o.digilockerReturnHosts ?? [
      new URL(this.fx.digilockerReturnUrl ?? DIGILOCKER_CONTRACT_RETURN_URL).hostname,
    ];
    this.handoffReId = o.vcipHandoff?.reId ?? FAKE_VCIP_HANDOFF.reId;
    this.handoffIssuers =
      o.vcipHandoff?.issuers ??
      fakeVcipHandoffKeys().then((k) => ({ [FAKE_VCIP_HANDOFF.lspId]: k }));
    this.handoffReplay = o.vcipHandoff?.replay ?? new MemoryReplayStore(() => this.now());
    this.launchHosts = o.vcipHandoff?.launchHosts ?? [FAKE_VCIP_HANDOFF.launchHost];
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

  private otpRefused(reason: AadhaarOtpRefusal, detail: string): PortError {
    return new PortError("IPB-PORT-001", "KYC", {
      adapter: "fake-kyc",
      detail,
      meta: { reason, definite: true },
    });
  }

  async aadhaarOtpRequest(raw: Parameters<NonNullable<KycPort["aadhaarOtpRequest"]>>[0]) {
    if (!this.notifiedEntity)
      throw this.otpRefused("not_configured", "Aadhaar OTP e-KYC needs a notified entity");
    const r = AadhaarOtpRequest.parse(raw);
    if (!aadhaarUidValid(r.uid, r.uidKind))
      throw this.otpRefused("uid_invalid", "the number is not a well-formed Aadhaar number or VID");
    this.aadhaarOtpVendorCalls++;
    if (r.uid === this.fx.aadhaarOtp?.unlinkedUid)
      throw this.otpRefused("mobile_not_linked", "no mobile number is linked to the number");
    const last4 = (r.uidKind === "AADHAAR" ? r.uid : (this.fx.aadhaarOtp?.uid ?? "0000")).slice(-4);
    const ev = this.ev();
    const txn = `aotp-txn-${ev.vendorRef}`;
    const expiresAt = this.now().getTime() + 10 * 60_000;
    this.otpTxns.set(txn, { expiresAt, used: false, last4 });
    return { ...ev, txn, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Test helper: the transaction's OTP expires now. */
  expireAadhaarOtp(txn: string): void {
    const t = this.otpTxns.get(txn);
    if (t) t.expiresAt = 0;
  }

  async aadhaarOtpVerify(
    raw: Parameters<NonNullable<KycPort["aadhaarOtpVerify"]>>[0],
    call?: PortCall,
  ): Promise<AadhaarOtpResult> {
    if (!this.notifiedEntity)
      throw this.otpRefused("not_configured", "Aadhaar OTP e-KYC needs a notified entity");
    const r = AadhaarOtpVerify.parse(raw);
    const key = call?.idempotencyKey;
    const request = sha256Hex(JSON.stringify([key, r.txn, r.otp]));
    const prior = key === undefined ? undefined : this.otpVerifies.get(key);
    if (prior) {
      if (prior.request !== request)
        throw new PortError("IPB-PORT-004", "KYC", {
          adapter: "fake-kyc",
          detail: "idempotency key reused with another Aadhaar OTP verify",
          meta: { reason: "idempotency_conflict" },
        });
      if (prior.refused) throw this.otpRefused(prior.refused, "the first verify was refused");
      return structuredClone(prior.result!);
    }
    this.aadhaarOtpVendorCalls++;
    const t = this.otpTxns.get(r.txn);
    const refuse = (reason: AadhaarOtpRefusal, detail: string): never => {
      if (key !== undefined) this.otpVerifies.set(key, { request, refused: reason });
      throw this.otpRefused(reason, detail);
    };
    if (!t || t.used || t.expiresAt <= this.now().getTime())
      return refuse("otp_expired", "the OTP transaction expired, was used or is not known");
    if (r.otp !== FAKE_AADHAAR_OTP) return refuse("otp_invalid", "the OTP is not the one sent");
    t.used = true;
    const tenant = call?.tenantId ?? "tnt_kyc";
    const result: AadhaarOtpResult = {
      ...this.ev(),
      ekyc: {
        storageKey: `tenant/${tenant}/kyc/aadhaar-otp/${r.txn}.xml`,
        sha256: sha256Hex(`ekyc:${r.txn}`),
      },
      signatureValid: true,
      uidLast4: t.last4,
    };
    if (key !== undefined) this.otpVerifies.set(key, { request, result: structuredClone(result) });
    return result;
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

  private vcipRefused(reason: string, detail: string): PortError {
    return new PortError("IPB-PORT-001", "KYC", {
      adapter: "fake-kyc",
      detail,
      meta: { reason, definite: true },
    });
  }

  async startVcip(raw: Parameters<KycPort["startVcip"]>[0]) {
    const s = VcipSession.parse(raw);
    const ev = this.ev();
    if (s.vcipId !== undefined) {
      // A session launchVcip scheduled (PR-UDF-045): the hand-off's tenant and customer only.
      const v = this.vcips.get(s.vcipId);
      const meta = this.vcipMeta.get(s.vcipId);
      if (!v || !meta || meta.tenantId !== s.tenantId)
        throw this.vcipRefused("not_found", "no such V-CIP session");
      this.lapse(s.vcipId);
      const now = this.vcips.get(s.vcipId)!;
      if (now.state !== "scheduled")
        throw this.vcipRefused(
          now.state === "expired" ? "launch_expired" : "wrong_state",
          `the session is ${now.state}`,
        );
      if (meta.customerRef !== s.customerRef)
        throw this.vcipRefused(
          "customer_mismatch",
          "the session was launched for another customer",
        );
      this.vcips.set(s.vcipId, {
        ...now,
        state: "in_progress",
        officialRef: s.officialRef,
        startedAt: ev.checkedAt,
      });
      return { ...ev, vcipId: s.vcipId, state: "in_progress" as const };
    }
    const vcipId = `vcip_${++this.n}`;
    this.vcips.set(vcipId, {
      ...ev,
      vcipId,
      sessionId: s.sessionId,
      state: "in_progress",
      officialRef: s.officialRef,
      startedAt: ev.checkedAt,
      artefacts: [],
    });
    this.vcipMeta.set(vcipId, { tenantId: s.tenantId, customerRef: s.customerRef });
    return { ...ev, vcipId, state: "in_progress" as const };
  }

  private handoffRefused(reason: VcipHandoffRefusal, detail: string): PortError {
    return this.vcipRefused(reason, detail);
  }

  async launchVcip(
    raw: Parameters<NonNullable<KycPort["launchVcip"]>>[0],
    call?: PortCall,
  ): Promise<VcipLaunch> {
    const r = LaunchVcip.safeParse(raw);
    if (!r.success) throw this.handoffRefused("handoff_invalid", "not a valid V-CIP hand-off");
    const { context: c, jws } = r.data;
    if (call?.tenantId !== undefined && call.tenantId !== c.tenantId)
      throw this.handoffRefused("handoff_invalid", "the hand-off names another tenant");
    if (c.reId !== this.handoffReId)
      throw this.handoffRefused("handoff_invalid", "the hand-off names another RE");
    const issuers = await this.handoffIssuers;
    const keys = Object.hasOwn(issuers, c.lspId) ? issuers[c.lspId] : undefined;
    if (!keys) throw this.handoffRefused("handoff_invalid", "the hand-off's LSP is not trusted");
    const now = this.now();
    const v = await verifyRegulatedMessage(c as unknown as Record<string, unknown>, jws, {
      keys,
      replay: this.handoffReplay,
      now,
    });
    if (!v.ok)
      throw this.handoffRefused(vcipHandoffFailure(v.reason), "the hand-off did not verify");
    const late = vcipHandoffTimeRefusal(c, now);
    if (late) throw this.handoffRefused(late, "the hand-off is not fresh");
    this.vcipLaunchVendorCalls++;
    const ev = this.ev();
    const vcipId = `vcip_${++this.n}`;
    const launchUrl = `https://${this.launchHosts[0] ?? ""}/v/${vcipId}`;
    if (!vcipLaunchUrlAllowed(launchUrl, this.launchHosts))
      throw new PortError("IPB-PORT-003", "KYC", {
        adapter: "fake-kyc",
        detail: "the launch address is not allowed",
        meta: { reason: VCIP_LAUNCH_URL_REFUSED },
      });
    this.vcips.set(vcipId, {
      ...ev,
      vcipId,
      sessionId: c.journeyId,
      state: "scheduled",
      officialRef: "",
      artefacts: [],
    });
    this.vcipMeta.set(vcipId, {
      tenantId: c.tenantId,
      customerRef: c.customerRef,
      launchExpiresAt: c.expiresAt,
    });
    return { ...ev, vcipId, launchUrl, expiresAt: c.expiresAt };
  }

  /** A scheduled session whose hand-off lapsed is expired (`launch_expired`). */
  private lapse(vcipId: string): void {
    const v = this.vcips.get(vcipId);
    const at = this.vcipMeta.get(vcipId)?.launchExpiresAt;
    if (v?.state === "scheduled" && at && Date.parse(at) <= this.now().getTime())
      this.vcips.set(vcipId, { ...v, state: "expired", reasonCode: "launch_expired" });
  }

  /** Test helper: the official ends the call with this outcome. */
  completeVcip(
    vcipId: string,
    o: {
      state: Extract<VcipState, "completed" | "rejected" | "dropped">;
      /** Default: `official_rejected` for a rejection, `connection_lost` for a drop. */
      reasonCode?: VcipReasonCode;
      /** @deprecated The old free text (PR-UDF-045): kept on the manifest, never shown. */
      reason?: string;
    },
  ): void {
    const v = this.vcips.get(vcipId);
    if (!v) throw new Error(`no V-CIP ${vcipId}`);
    const key = (k: string) => ({
      storageKey: `tenant/tnt_kyc/vcip/${vcipId}/${k}`,
      sha256: sha256Hex(`${vcipId}:${k}`),
    });
    const reasonCode =
      o.reasonCode ??
      (o.state === "rejected"
        ? "official_rejected"
        : o.state === "dropped"
          ? "connection_lost"
          : undefined);
    this.vcips.set(vcipId, {
      ...v,
      state: o.state,
      ...(v.startedAt ? {} : { startedAt: this.now().toISOString() }),
      endedAt: this.now().toISOString(),
      liveness: { score: 0.97, passed: true, mode: this.livenessMode },
      faceMatch: { score: 0.93, passed: true },
      geo: { lat: 19.07, lon: 72.87, country: "IN", capturedAt: this.now().toISOString() },
      artefacts: [
        { kind: "video", file: key("video.webm") },
        { kind: "audio", file: key("audio.ogg") },
        { kind: "screenshot", file: key("face.jpg") },
      ],
      ...(reasonCode ? { reasonCode } : {}),
      ...(o.reason ? { reason: o.reason } : {}),
    });
  }

  async vcipStatus(vcipId: string, call?: PortCall) {
    const v = this.vcips.get(vcipId);
    const meta = this.vcipMeta.get(vcipId);
    if (!v || (call?.tenantId !== undefined && meta?.tenantId !== call.tenantId))
      throw this.vcipRefused("not_found", "no such V-CIP session");
    this.lapse(vcipId);
    const now = this.vcips.get(vcipId)!;
    return { ...now, artefacts: [...now.artefacts] };
  }

  /** Test helper: the next score the fake's "vendor" gives is off its 0-to-1 scale. */
  offScaleNext(): void {
    this.offScale = true;
  }

  /**
   * One scored check: the key's first answer, or a "vendor" score refused when off its scale and
   * kept once answered. A key is scoped to its method (PR-UDF-044).
   */
  private keyedScore(
    method: "liveness" | "face_match",
    request: unknown,
    call: PortCall | undefined,
    vendor: () => number,
    o: { threshold: number; mode?: LivenessMode },
  ): ScoreResult {
    const key = call?.idempotencyKey;
    const req = sha256Hex(JSON.stringify([method, key, request]));
    const k = `${method}|${key}`;
    const prior = key === undefined ? undefined : this.scoreChecks.get(k);
    if (prior) {
      if (prior.request !== req)
        throw new PortError("IPB-PORT-004", "KYC", {
          adapter: "fake-kyc",
          detail: `idempotency key reused with another ${method.replace("_", " ")} check`,
          meta: { reason: "idempotency_conflict" },
        });
      return structuredClone(prior.result);
    }
    if (method === "liveness") this.livenessVendorCalls++;
    else this.faceMatchVendorCalls++;
    const raw = this.offScale ? 1.5 : vendor();
    this.offScale = false;
    if (!kycScoreValid(raw))
      throw new PortError("IPB-PORT-003", "KYC", {
        adapter: "fake-kyc",
        detail: "the score is not a number from 0 to 1",
        meta: { reason: KYC_SCORE_OUT_OF_RANGE },
      });
    const result: ScoreResult = {
      ...this.ev(),
      score: raw,
      passed: raw >= o.threshold,
      threshold: o.threshold,
      ...(o.mode ? { mode: o.mode } : {}),
    };
    if (key !== undefined)
      this.scoreChecks.set(k, { request: req, result: structuredClone(result) });
    return result;
  }

  async livenessCheck(raw: Parameters<KycPort["livenessCheck"]>[0], call?: PortCall) {
    const r = LivenessCheck.parse(raw);
    const mode = r.mode ?? this.livenessMode;
    if (!this.livenessModes.includes(mode))
      throw new PortError("IPB-PORT-002", "KYC", {
        adapter: "fake-kyc",
        detail: `the fake does not check liveness by ${mode}`,
        meta: { reason: KYC_MODE_UNSUPPORTED, definite: true },
      });
    return this.keyedScore(
      "liveness",
      [r.frames, mode],
      call,
      () => (r.frames.length >= 3 ? 0.9 + this.score(...r.frames.map((f) => f.sha256)) / 10 : 0.4),
      { threshold: this.livenessThreshold, mode },
    );
  }

  async faceMatch(raw: Parameters<KycPort["faceMatch"]>[0], call?: PortCall) {
    const r = FaceMatch.parse(raw);
    const same = [r.a.sha256, r.b.sha256].every(
      (h) => h === this.fx.faces.a.sha256 || h === this.fx.faces.same.sha256,
    );
    return this.keyedScore(
      "face_match",
      [r.a, r.b],
      call,
      () =>
        same
          ? 0.9 + this.score(r.a.sha256, r.b.sha256) / 10
          : this.score(r.a.sha256, r.b.sha256) / 2,
      { threshold: this.faceMatchThreshold },
    );
  }

  async bankAccountVerify(
    raw: Parameters<KycPort["bankAccountVerify"]>[0],
    call?: PortCall,
  ): Promise<BankAccountResult> {
    const r = BankAccountCheck.parse(raw);
    const mode = r.mode ?? this.bankMode;
    if (!this.bankModes.includes(mode))
      throw new PortError("IPB-PORT-002", "KYC", {
        adapter: "fake-kyc",
        detail: `the fake does not verify bank accounts by ${mode}`,
        meta: { reason: BANK_ACCOUNT_MODE_UNSUPPORTED, definite: true },
      });
    const key = call?.idempotencyKey;
    // Keyed by the call's key, and in memory only (the platform adapters keep an HMAC; R1-D-196).
    const request = sha256Hex(JSON.stringify([key, r.ifsc, r.accountNumber, r.name ?? null, mode]));
    const prior = key === undefined ? undefined : this.bankVerifies.get(key);
    if (prior) {
      if (prior.request !== request)
        throw new PortError("IPB-PORT-004", "KYC", {
          adapter: "fake-kyc",
          detail: "idempotency key reused with another bank account check",
          meta: { reason: "idempotency_conflict" },
        });
      return structuredClone(prior.result);
    }
    this.bankAccountVendorCalls++;
    const result: BankAccountResult =
      r.ifsc !== this.fx.bank.ifsc || r.accountNumber !== this.fx.bank.accountNumber
        ? { ...this.ev(), status: "not_found", mode }
        : {
            ...this.ev(),
            status: "valid",
            mode,
            nameAtBank: this.fx.bank.name.toUpperCase(),
            ...(r.name ? { nameMatch: nameMatch(r.name, this.fx.bank.name) } : {}),
          };
    if (key !== undefined) this.bankVerifies.set(key, { request, result: structuredClone(result) });
    return result;
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
