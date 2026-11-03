// V-CIP in our own VIDEO_MEET room (R1-plan M24; owner answer #90 (b); R1-D-34's clause map;
// R1-D-55). The call runs on the tenant's VIDEO_MEET (LiveKit, M15); a KYC scorer (Digio first,
// IDfy second, through `kycMethodRouter`) checks liveness and face match on frames only. The
// recording and every artefact stay in the tenant's STORAGE, and an approval is refused unless the
// room's provider retains nothing. A live official of the regulated entity conducts the call and
// makes the decision (RBI KYC Directions 2025 paras 5(2)(xiv), 23, 26, 27, 44, 47): the conductor
// accepts the decision only from the session's official, and an approval needs passed liveness and
// face-match checks and the customer's geo-tag in India. Live use needs the owner's Digio account.
import { PortError } from "@infrabyx/contracts/errors";
import {
  KycFileRef,
  VcipSession,
  type KycEvidence,
  type KycPort,
  type ScoreResult,
  type VcipManifest,
  type VcipStart,
  type VcipState,
  type VideoMeetPort,
} from "@infrabyx/contracts/ports";
import { newId } from "@infrabyx/crypto";

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
  liveness?: { score: number; passed: boolean; adapter: string; vendorRef: string };
  faceMatch?: { score: number; passed: boolean; adapter: string; vendorRef: string };
  geo?: { lat: number; lon: number; country: string; capturedAt: string };
  artefacts: VcipManifest["artefacts"];
  reason?: string;
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
}

const refused = (detail: string, reason: string): PortError =>
  new PortError("IPB-PORT-001", "KYC", {
    adapter: ADAPTER,
    detail,
    meta: { reason, definite: true },
  });

export class VcipConductor {
  private readonly now: () => Date;
  constructor(private readonly o: VcipConductorOptions) {
    this.now = o.now ?? (() => new Date());
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

  /** Start the call: the room exists (VIDEO_MEET, VCIP policy); recording starts in the tenant. */
  async startVcip(raw: Parameters<KycPort["startVcip"]>[0]): Promise<VcipStart> {
    await this.guard();
    const s = VcipSession.parse(raw);
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
    },
  ): Promise<{ liveness: ScoreResult; faceMatch: ScoreResult }> {
    await this.guard();
    const r = await this.load(tenantId, vcipId, "in_progress");
    this.official(r, a.by);
    const frames = a.frames.map((f) => KycFileRef.parse(f));
    const doc = KycFileRef.parse(a.documentFace);
    if (!frames.length) throw refused("at least one frame is needed", "no_frames");
    const call = { tenantId };
    const liveness = await this.o.scorer.livenessCheck({ frames }, call);
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
   * and the room ends. A rejection needs a reason.
   */
  async complete(
    tenantId: string,
    vcipId: string,
    d: { by: string; decision: "approve" | "reject"; reason?: string },
  ): Promise<VcipManifest> {
    await this.guard();
    const r = await this.load(tenantId, vcipId, "in_progress");
    this.official(r, d.by);
    if (d.decision === "reject" && !(d.reason && d.reason.trim().length >= 5))
      throw refused("a rejection needs a reason", "no_reason");
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
      ...(d.decision === "reject" ? { reason: d.reason!.trim() } : {}),
    };
    await this.save(next, "in_progress");
    await this.o.meet.endRoom(r.roomId);
    return this.manifest(next);
  }

  /** The call dropped (network, the customer left): the session ends without a decision. */
  async drop(tenantId: string, vcipId: string, reason: string): Promise<VcipManifest> {
    const r = await this.load(tenantId, vcipId, "in_progress");
    await this.o.meet.stopRecording(r.roomId).catch(() => undefined);
    const next: VcipRecord = { ...r, state: "dropped", endedAt: this.now().toISOString(), reason };
    await this.save(next, "in_progress");
    await this.o.meet.endRoom(r.roomId).catch(() => undefined);
    return this.manifest(next);
  }

  async vcipStatus(vcipId: string, tenantId = this.o.currentTenant?.()): Promise<VcipManifest> {
    if (!tenantId) throw refused("a V-CIP read needs a tenant", "no_tenant");
    return this.manifest(await this.load(tenantId, vcipId));
  }

  private manifest(r: VcipRecord): VcipManifest {
    return {
      ...this.evidence(r.roomId),
      vcipId: r.vcipId,
      sessionId: r.sessionId,
      state: r.state,
      officialRef: r.officialRef,
      ...(r.liveness ? { liveness: { score: r.liveness.score, passed: r.liveness.passed } } : {}),
      ...(r.faceMatch
        ? { faceMatch: { score: r.faceMatch.score, passed: r.faceMatch.passed } }
        : {}),
      ...(r.geo ? { geo: r.geo } : {}),
      startedAt: r.startedAt,
      ...(r.endedAt ? { endedAt: r.endedAt } : {}),
      artefacts: r.artefacts,
      ...(r.reason ? { reason: r.reason } : {}),
    };
  }
}
