// V-CIP in our own VIDEO_MEET room (R1-plan M24; owner answer #90 (b); R1-D-34's clause map;
// R1-D-55). The call runs on the tenant's VIDEO_MEET (LiveKit, M15); a KYC scorer (Digio first,
// IDfy second, through `kycMethodRouter`) checks liveness and face match on frames only. The
// recording and every artefact stay in the tenant's STORAGE, and an approval is refused unless the
// room's provider retains nothing. A live official of the regulated entity conducts the call and
// makes the decision (RBI KYC Directions 2025 paras 5(2)(xiv), 23, 26, 27, 44, 47): the conductor
// accepts the decision only from the session's official, and an approval needs passed liveness and
// face-match checks and the customer's geo-tag in India. Live use needs the owner's Digio account.
//
// The conductor is the RE's side, so it is where an LSP's hand-off lands (PR-UDF-045; R1-D-198):
// `launchVcip` verifies the LSP's signed `VcipHandoffContext` (`verifyRegulatedMessage` with the
// LSP's key ring and a replay store, nothing new in cryptography), schedules a session for that
// customer and answers the RE's own launch address; the RE's official then starts it with
// `startVcip({ …, vcipId })`. The LSP hosts no V-CIP component (KYC Directions 2025 para 27(1)(i)).
// A session's end carries a `VCIP_REASON_CODES` code; free text an official types is never shown.
import { findAadhaarLike } from "@infrabyx/contracts/aadhaar";
import { PortError } from "@infrabyx/contracts/errors";
import {
  KycFileRef,
  LaunchVcip,
  LIVENESS_MODES,
  VCIP_LAUNCH_URL_REFUSED,
  VCIP_REASON_CODES,
  VcipSession,
  vcipHandoffFailure,
  vcipHandoffTimeRefusal,
  vcipLaunchUrlAllowed,
  type KycEvidence,
  type KycPort,
  type LivenessMode,
  type PortCall,
  type ScoreResult,
  type VcipHandoffRefusal,
  type VcipLaunch,
  type VcipManifest,
  type VcipReasonCode,
  type VcipStart,
  type VcipState,
  type VideoMeetPort,
} from "@infrabyx/contracts/ports";
import {
  newId,
  verifyRegulatedMessage,
  type RegulatedKeyRing,
  type ReplayStore,
} from "@infrabyx/crypto";

const ADAPTER = "vcip-conductor";
const MODEL = "vcip-1";

export interface VcipRecord {
  vcipId: string;
  sessionId: string;
  tenantId: string;
  customerRef: string;
  officialRef: string;
  roomId: string;
  state: VcipState;
  startedAt: string;
  endedAt?: string;
  /** `mode` (PR-UDF-045): the liveness mode the scorer used. */
  liveness?: {
    score: number;
    passed: boolean;
    adapter: string;
    vendorRef: string;
    mode?: LivenessMode;
  };
  faceMatch?: { score: number; passed: boolean; adapter: string; vendorRef: string };
  geo?: { lat: number; lon: number; country: string; capturedAt: string };
  artefacts: VcipManifest["artefacts"];
  /** Why it was rejected, dropped or expired (PR-UDF-045). */
  reasonCode?: VcipReasonCode;
  /** @deprecated The official's free text (PR-UDF-045): kept for the record, never shown. */
  reason?: string;
  /**
   * A session `launchVcip` scheduled (PR-UDF-045): when its hand-off lapses. Until an official
   * starts it, `officialRef` and `roomId` are empty and `startedAt` is the launch time.
   */
  launchExpiresAt?: string;
}

/** Where the product keeps V-CIP sessions (its own table, under RLS and the ledger). */
export interface VcipStore {
  create(r: VcipRecord): Promise<void>;
  get(tenantId: string, vcipId: string): Promise<VcipRecord | undefined>;
  /** Compare-and-set on `state`: false when another call moved the session first. */
  update(r: VcipRecord, from: VcipState): Promise<boolean>;
}

/** Single-process store for tests and local development. */
export class MemoryVcipStore implements VcipStore {
  private readonly rows = new Map<string, VcipRecord>();
  async create(r: VcipRecord) {
    this.rows.set(`${r.tenantId}|${r.vcipId}`, structuredClone(r));
  }
  async get(tenantId: string, vcipId: string) {
    const r = this.rows.get(`${tenantId}|${vcipId}`);
    return r ? structuredClone(r) : undefined;
  }
  async update(r: VcipRecord, from: VcipState) {
    const k = `${r.tenantId}|${r.vcipId}`;
    if (this.rows.get(k)?.state !== from) return false;
    this.rows.set(k, structuredClone(r));
    return true;
  }
}

export interface VcipConductorOptions {
  meet: VideoMeetPort;
  /** Liveness and face match on frames: `kycMethodRouter` over Digio and IDfy. */
  scorer: Pick<KycPort, "livenessCheck" | "faceMatch">;
  store: VcipStore;
  /** The product's `kyc.vcip.enabled` (off by default), read on every call. */
  enabled: () => Promise<boolean> | boolean;
  /** The tenant when the call names none (for `vcipStatus`). */
  currentTenant?: () => string | undefined;
  now?: () => Date;
  /**
   * The RE-hosted launcher (PR-UDF-045). Without it `launchVcip` is refused `not_configured`.
   */
  handoff?: VcipHandoffOptions;
}

/** Where the conductor takes LSP hand-offs from, and where it sends the customer (PR-UDF-045). */
export interface VcipHandoffOptions {
  /** The RE this conductor serves: a hand-off naming another is refused. */
  reId: string;
  /** The key ring of each LSP the RE trusts, by `lspId` (the LSP's KMS keys, ES256). */
  issuers: Readonly<Record<string, RegulatedKeyRing>>;
  /** The hand-offs' `jti` replay store: durable and shared by every instance in production. */
  replay: ReplayStore;
  /** The RE's V-CIP page; the session id is appended: `https:`, e.g. `https://vcip.re.example/v/`. */
  launchBaseUrl: string;
  /** Hosts the launch address may name (default: the base address's host only). */
  launchHosts?: readonly string[];
}

const TWELVE_DIGIT_RUN = /(?<![0-9])[0-9]{12}(?![0-9])/;
/** True when free text carries a 12-digit run or an Aadhaar-like number: it is never kept. */
const holdsNumber = (t: string) => TWELVE_DIGIT_RUN.test(t) || findAadhaarLike(t).length > 0;

const refused = (detail: string, reason: string): PortError =>
  new PortError("IPB-PORT-001", "KYC", {
    adapter: ADAPTER,
    detail,
    meta: { reason, definite: true },
  });

export class VcipConductor {
  private readonly now: () => Date;
  private readonly launchHosts: readonly string[];
  constructor(private readonly o: VcipConductorOptions) {
    this.now = o.now ?? (() => new Date());
    this.launchHosts = [];
    if (o.handoff) {
      let host = "";
      try {
        host = new URL(o.handoff.launchBaseUrl).hostname;
      } catch {
        // refused below
      }
      this.launchHosts = o.handoff.launchHosts ?? [host];
      if (!vcipLaunchUrlAllowed(o.handoff.launchBaseUrl, this.launchHosts))
        throw new RangeError("the V-CIP launch address must be https: on its launch hosts");
    }
  }

  private evidence(vendorRef: string): KycEvidence {
    return {
      vendorRef,
      adapter: ADAPTER,
      modelVersion: MODEL,
      checkedAt: this.now().toISOString(),
    };
  }

  private async guard(): Promise<void> {
    if (!(await this.o.enabled()))
      throw refused("V-CIP is off (kyc.vcip.enabled)", "adapter_disabled");
  }

  private async load(tenantId: string, vcipId: string, state?: VcipState): Promise<VcipRecord> {
    const r = await this.o.store.get(tenantId, vcipId);
    if (!r) throw refused("no such V-CIP session", "not_found");
    if (state && r.state !== state) throw refused(`the session is ${r.state}`, "wrong_state");
    return r;
  }

  private async save(r: VcipRecord, from: VcipState): Promise<void> {
    if (!(await this.o.store.update(r, from)))
      throw refused("the session moved on in another call", "conflict");
  }

  private official(r: VcipRecord, by: string): void {
    // Para 27(3): the official named for the session conducts it; nobody else decides.
    if (by !== r.officialRef)
      throw new PortError("IPB-SEC-005", "KYC", {
        adapter: ADAPTER,
        detail: "only the session's official may act on it",
      });
  }

  /**
   * Start the call: the room exists (VIDEO_MEET, VCIP policy); recording starts in the tenant. With
   * `vcipId` (PR-UDF-045) it starts the session `launchVcip` scheduled, for the hand-off's tenant
   * and customer only, while its hand-off is live.
   */
  async startVcip(raw: Parameters<KycPort["startVcip"]>[0]): Promise<VcipStart> {
    await this.guard();
    const s = VcipSession.parse(raw);
    if (s.vcipId !== undefined) {
      const r = await this.lapse(await this.load(s.tenantId, s.vcipId));
      if (r.state !== "scheduled")
        throw refused(
          `the session is ${r.state}`,
          r.state === "expired" ? "launch_expired" : "wrong_state",
        );
      if (r.customerRef !== s.customerRef)
        throw refused("the session was launched for another customer", "customer_mismatch");
      const next: VcipRecord = {
        ...r,
        officialRef: s.officialRef,
        roomId: s.roomId,
        state: "in_progress",
        startedAt: this.now().toISOString(),
        artefacts: [
          ...r.artefacts,
          ...s.documents.map((file) => ({ kind: "document" as const, file })),
        ],
      };
      await this.o.meet.startRecording(s.roomId);
      await this.save(next, "scheduled");
      return { vcipId: r.vcipId, state: next.state, ...this.evidence(s.roomId) };
    }
    const r: VcipRecord = {
      vcipId: newId("vcp"),
      sessionId: s.sessionId,
      tenantId: s.tenantId,
      customerRef: s.customerRef,
      officialRef: s.officialRef,
      roomId: s.roomId,
      state: "in_progress",
      startedAt: this.now().toISOString(),
      artefacts: s.documents.map((file) => ({ kind: "document" as const, file })),
    };
    await this.o.meet.startRecording(s.roomId);
    await this.o.store.create(r);
    return { vcipId: r.vcipId, state: r.state, ...this.evidence(s.roomId) };
  }

  /**
   * Take an LSP's hand-off (PR-UDF-045; see `KycPort.launchVcip`): the conductor is on and has a
   * `handoff` set-up, the request parses, the context names the call's tenant (when given), this
   * RE and a trusted LSP, its JWS verifies over it under that LSP's keys with the replay store, and
   * it is fresh; each refusal is `IPB-PORT-001` with its fixed label before anything is stored.
   * Then a `scheduled` session for the customer, under the hand-off's journey id as `sessionId`,
   * and the RE's launch address for it, lapsing with the hand-off.
   */
  async launchVcip(
    raw: Parameters<NonNullable<KycPort["launchVcip"]>>[0],
    call?: PortCall,
  ): Promise<VcipLaunch> {
    await this.guard();
    const h = this.o.handoff;
    if (!h) throw refused("no V-CIP hand-off is configured", "not_configured");
    const no = (reason: VcipHandoffRefusal, detail: string) => refused(detail, reason);
    const p = LaunchVcip.safeParse(raw);
    if (!p.success) throw no("handoff_invalid", "not a valid V-CIP hand-off");
    const { context: c, jws } = p.data;
    if (call?.tenantId !== undefined && call.tenantId !== c.tenantId)
      throw no("handoff_invalid", "the hand-off names another tenant");
    if (c.reId !== h.reId) throw no("handoff_invalid", "the hand-off names another RE");
    const keys = Object.hasOwn(h.issuers, c.lspId) ? h.issuers[c.lspId] : undefined;
    if (!keys) throw no("handoff_invalid", "the hand-off's LSP is not trusted");
    const now = this.now();
    const v = await verifyRegulatedMessage(c as unknown as Record<string, unknown>, jws, {
      keys,
      replay: h.replay,
      now,
    });
    if (!v.ok) throw no(vcipHandoffFailure(v.reason), "the hand-off did not verify");
    const late = vcipHandoffTimeRefusal(c, now);
    if (late) throw no(late, "the hand-off is not fresh");
    // A session id is a ULID; one in a few million holds a 12-digit run, which no address carries.
    let vcipId = newId("vcp");
    let launchUrl = `${h.launchBaseUrl}${vcipId}`;
    for (let i = 0; i < 3 && !vcipLaunchUrlAllowed(launchUrl, this.launchHosts); i++) {
      vcipId = newId("vcp");
      launchUrl = `${h.launchBaseUrl}${vcipId}`;
    }
    if (!vcipLaunchUrlAllowed(launchUrl, this.launchHosts))
      throw new PortError("IPB-PORT-003", "KYC", {
        adapter: ADAPTER,
        detail: "the launch address is not allowed",
        meta: { reason: VCIP_LAUNCH_URL_REFUSED },
      });
    await this.o.store.create({
      vcipId,
      sessionId: c.journeyId,
      tenantId: c.tenantId,
      customerRef: c.customerRef,
      officialRef: "",
      roomId: "",
      state: "scheduled",
      startedAt: now.toISOString(),
      artefacts: [],
      launchExpiresAt: c.expiresAt,
    });
    return { vcipId, launchUrl, expiresAt: c.expiresAt, ...this.evidence(vcipId) };
  }

  /** A scheduled session whose hand-off lapsed becomes `expired` (`launch_expired`). */
  private async lapse(r: VcipRecord): Promise<VcipRecord> {
    if (
      r.state !== "scheduled" ||
      !r.launchExpiresAt ||
      Date.parse(r.launchExpiresAt) > this.now().getTime()
    )
      return r;
    const next: VcipRecord = {
      ...r,
      state: "expired",
      endedAt: this.now().toISOString(),
      reasonCode: "launch_expired",
    };
    if (await this.o.store.update(next, "scheduled")) return next;
    return this.load(r.tenantId, r.vcipId);
  }

  /**
   * The official's checks during the call: liveness on frames and a face match of the best frame
   * against the document photo. Only frames leave for the scorer; they are kept as screenshots.
   */
  async assess(
    tenantId: string,
    vcipId: string,
    a: {
      by: string;
      frames: KycFileRef[];
      documentFace: KycFileRef;
      geo: { lat: number; lon: number; country: string; capturedAt: string };
      /** The liveness mode to ask the scorer for (PR-UDF-045; `LIVENESS_MODES`); omitted, its own. */
      mode?: LivenessMode;
    },
  ): Promise<{ liveness: ScoreResult; faceMatch: ScoreResult }> {
    await this.guard();
    const r = await this.load(tenantId, vcipId, "in_progress");
    this.official(r, a.by);
    const frames = a.frames.map((f) => KycFileRef.parse(f));
    const doc = KycFileRef.parse(a.documentFace);
    if (!frames.length) throw refused("at least one frame is needed", "no_frames");
    if (a.mode !== undefined && !LIVENESS_MODES.includes(a.mode))
      throw refused("not a liveness mode", "mode_invalid");
    const call = { tenantId };
    const liveness = await this.o.scorer.livenessCheck(
      { frames, ...(a.mode ? { mode: a.mode } : {}) },
      call,
    );
    const faceMatch = await this.o.scorer.faceMatch(
      { a: frames[frames.length - 1]!, b: doc },
      call,
    );
    const next: VcipRecord = {
      ...r,
      liveness: {
        score: liveness.score,
        passed: liveness.passed,
        adapter: liveness.adapter,
        vendorRef: liveness.vendorRef,
        ...(liveness.mode ? { mode: liveness.mode } : {}),
      },
      faceMatch: {
        score: faceMatch.score,
        passed: faceMatch.passed,
        adapter: faceMatch.adapter,
        vendorRef: faceMatch.vendorRef,
      },
      geo: a.geo,
      artefacts: [...r.artefacts, ...frames.map((file) => ({ kind: "screenshot" as const, file }))],
    };
    await this.save(next, "in_progress");
    return { liveness, faceMatch };
  }

  /**
   * The official's decision. An approval needs passed liveness and face match, the customer in
   * India, and a recording the provider does not retain; then the recording joins the manifest
   * and the room ends. A rejection needs a reason, kept for the record and never shown, and carries
   * a `VCIP_REASON_CODES` code (`official_rejected` when none is given; PR-UDF-045); a reason that
   * holds a 12-digit run or an Aadhaar-like number is refused `reason_unsafe`.
   */
  async complete(
    tenantId: string,
    vcipId: string,
    d: {
      by: string;
      decision: "approve" | "reject";
      reason?: string;
      reasonCode?: VcipReasonCode;
    },
  ): Promise<VcipManifest> {
    await this.guard();
    const r = await this.load(tenantId, vcipId, "in_progress");
    this.official(r, d.by);
    if (d.decision === "reject" && !(d.reason && d.reason.trim().length >= 5))
      throw refused("a rejection needs a reason", "no_reason");
    if (d.reasonCode !== undefined && !VCIP_REASON_CODES.includes(d.reasonCode))
      throw refused("not a V-CIP reason code", "reason_code_invalid");
    if (d.decision === "reject" && holdsNumber(d.reason!))
      throw refused("a reason may not hold an identity number", "reason_unsafe");
    if (d.decision === "approve") {
      if (!r.liveness?.passed || !r.faceMatch?.passed)
        throw refused("liveness and face match must pass before an approval", "checks_not_passed");
      if (r.geo?.country !== "IN")
        throw refused("the customer must be in India during the call", "outside_india");
    }
    await this.o.meet.stopRecording(r.roomId);
    const rec = await this.o.meet.fetchRecording(r.roomId);
    if (d.decision === "approve" && rec.providerRetention !== "none")
      throw refused("the room's provider keeps a copy of the recording", "provider_retains");
    const next: VcipRecord = {
      ...r,
      state: d.decision === "approve" ? "completed" : "rejected",
      endedAt: this.now().toISOString(),
      artefacts: [
        ...r.artefacts,
        ...rec.artefacts.map((x) => ({
          kind:
            x.kind === "audio"
              ? ("audio" as const)
              : x.kind === "transcript"
                ? ("transcript" as const)
                : ("video" as const),
          file: { storageKey: x.storageKey, sha256: x.sha256 },
        })),
      ],
      ...(d.decision === "reject"
        ? { reason: d.reason!.trim(), reasonCode: d.reasonCode ?? "official_rejected" }
        : {}),
    };
    await this.save(next, "in_progress");
    await this.o.meet.endRoom(r.roomId);
    return this.manifest(next);
  }

  /**
   * The call dropped (network, the customer left): the session ends without a decision, with a
   * `VCIP_REASON_CODES` code (default `connection_lost`; PR-UDF-045). Free text that holds a
   * 12-digit run or an Aadhaar-like number is not kept.
   */
  async drop(
    tenantId: string,
    vcipId: string,
    reason: string,
    reasonCode: VcipReasonCode = "connection_lost",
  ): Promise<VcipManifest> {
    if (!VCIP_REASON_CODES.includes(reasonCode))
      throw refused("not a V-CIP reason code", "reason_code_invalid");
    const r = await this.load(tenantId, vcipId, "in_progress");
    await this.o.meet.stopRecording(r.roomId).catch(() => undefined);
    const next: VcipRecord = {
      ...r,
      state: "dropped",
      endedAt: this.now().toISOString(),
      reasonCode,
      ...(holdsNumber(reason) ? {} : { reason }),
    };
    await this.save(next, "in_progress");
    await this.o.meet.endRoom(r.roomId).catch(() => undefined);
    return this.manifest(next);
  }

  /**
   * The session's manifest, under `call.tenantId` (PR-UDF-045), else the tenant given as a string
   * (as before), else `currentTenant`. A scheduled session whose hand-off lapsed reads `expired`.
   */
  async vcipStatus(vcipId: string, call?: PortCall | string): Promise<VcipManifest> {
    const tenantId = (typeof call === "string" ? call : call?.tenantId) ?? this.o.currentTenant?.();
    if (!tenantId) throw refused("a V-CIP read needs a tenant", "no_tenant");
    return this.manifest(await this.lapse(await this.load(tenantId, vcipId)));
  }

  private manifest(r: VcipRecord): VcipManifest {
    return {
      ...this.evidence(r.roomId),
      vcipId: r.vcipId,
      sessionId: r.sessionId,
      state: r.state,
      officialRef: r.officialRef,
      ...(r.liveness
        ? {
            liveness: {
              score: r.liveness.score,
              passed: r.liveness.passed,
              ...(r.liveness.mode ? { mode: r.liveness.mode } : {}),
            },
          }
        : {}),
      ...(r.faceMatch
        ? { faceMatch: { score: r.faceMatch.score, passed: r.faceMatch.passed } }
        : {}),
      ...(r.geo ? { geo: r.geo } : {}),
      // A scheduled session has not started: its record's `startedAt` is the launch time.
      ...(r.state === "scheduled" || (r.launchExpiresAt && !r.officialRef)
        ? {}
        : { startedAt: r.startedAt }),
      ...(r.endedAt ? { endedAt: r.endedAt } : {}),
      artefacts: r.artefacts,
      ...(r.reasonCode ? { reasonCode: r.reasonCode } : {}),
      ...(r.reason && !holdsNumber(r.reason) ? { reason: r.reason } : {}),
    };
  }
}
