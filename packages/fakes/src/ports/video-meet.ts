// VIDEO_MEET port contract cases and an in-memory fake (IPB-01-15; PR-FBX-01, R1-D-21). Adapters
// do not exist yet (OWNER-QUESTIONS #88); a future adapter runs `videoMeetContractCases()` with
// defineContractSuite("VIDEO_MEET", …). The fake enforces the room policy as an adapter must:
// participant countries, anonymised origins, the official's networks, and recordings written only
// to the room's target with a hash manifest.
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import {
  RoomParticipant,
  RoomPolicy,
  type AdapterDescriptor,
  type JoinOrigin,
  type PortHealth,
  type RecordingArtefact,
  type RecordingManifest,
  type Room,
  type RoomRole,
  type VideoMeetPort,
} from "@infrabyx/contracts/ports";
import { randomBytes, sha256Hex, toBase64Url } from "@infrabyx/crypto";

/** IPv4 CIDR membership (the fake's official-network check). */
function inCidr(ip: string, cidr: string): boolean {
  const [net, bits] = cidr.split("/") as [string, string];
  const n = (a: string) => a.split(".").reduce((x, o) => x * 256 + Number(o), 0);
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || !/^(\d{1,3}\.){3}\d{1,3}$/.test(net)) return false;
  const size = 2 ** (32 - Number(bits));
  return Math.floor(n(ip) / size) === Math.floor(n(net) / size);
}

interface FakeRoom extends Room {
  participants: Map<string, RoomRole>;
  recording: { startedAt?: string; artefacts: RecordingArtefact[] };
}

export class FakeVideoMeet implements VideoMeetPort {
  readonly descriptor: AdapterDescriptor = {
    port: "VIDEO_MEET",
    adapter: "fake-video-meet",
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  private readonly rooms = new Map<string, FakeRoom>();
  constructor(private readonly now: () => Date = () => new Date()) {}

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: this.now().toISOString() };
  }

  private room(roomId: string, open = true): FakeRoom {
    const r = this.rooms.get(roomId);
    if (!r || (open && r.state !== "open"))
      throw new PortError("IPB-PORT-001", "VIDEO_MEET", {
        adapter: "fake-video-meet",
        detail: r ? "the room has ended" : "no such room",
        meta: { reason: r ? "ended" : "not_found", definite: true },
      });
    return r;
  }

  async createRoom(caseId: string, participants: RoomParticipant[], policy: RoomPolicy) {
    const p = RoomPolicy.parse(policy);
    const ps = participants.map((x) => RoomParticipant.parse(x));
    const roomId = `room_${toBase64Url(randomBytes(9))}`;
    const room: FakeRoom = {
      roomId,
      caseId,
      policy: p,
      state: "open",
      createdAt: this.now().toISOString(),
      participants: new Map(ps.map((x) => [x.ref, x.role])),
      recording: { artefacts: [] },
    };
    this.rooms.set(roomId, room);
    const { participants: _p, recording: _r, ...pub } = room;
    return pub;
  }

  async joinToken(roomId: string, ref: string, role: RoomRole, origin: JoinOrigin) {
    const r = this.room(roomId);
    const refuse = (why: string) => {
      throw new IpbError("IPB-SEC-002", { detail: why, meta: { roomId } });
    };
    if (r.participants.get(ref) !== role) refuse("not a participant of the room in this role");
    if (origin.anonymised) refuse("a proxy, VPN or spoofed origin may not join");
    if (r.policy.participantCountries && !r.policy.participantCountries.includes(origin.country))
      refuse("joining from this country is not allowed for this room");
    if ((role === "host" || role === "official") && r.policy.officialNetworks)
      if (!r.policy.officialNetworks.some((c) => inCidr(origin.ip, c)))
        refuse("the official joins from the tenant's official network only");
    return {
      token: toBase64Url(randomBytes(24)),
      url: `https://meet.fake.test/${roomId}`,
      expiresAt: new Date(this.now().getTime() + 300_000).toISOString(),
    };
  }

  async startRecording(roomId: string) {
    const r = this.room(roomId);
    if (r.policy.recording !== "on")
      throw new PortError("IPB-PORT-001", "VIDEO_MEET", {
        adapter: "fake-video-meet",
        detail: "the room's policy does not record",
        meta: { reason: "recording_off", definite: true },
      });
    r.recording.startedAt = this.now().toISOString();
  }

  async stopRecording(roomId: string) {
    const r = this.room(roomId, false);
    const startedAt = r.recording.startedAt;
    if (!startedAt) return;
    const t = r.policy.recordingTarget!;
    const endedAt = this.now().toISOString();
    for (const kind of ["video", "audio"] as const) {
      const storageKey = `${t.targetRef}/${t.prefix}/${roomId}/${kind}-${r.recording.artefacts.length}.bin`;
      r.recording.artefacts.push({
        kind,
        storageKey,
        sha256: sha256Hex(storageKey),
        bytes: 1024,
        startedAt,
        endedAt,
      });
    }
    delete r.recording.startedAt;
  }

  async fetchRecording(roomId: string): Promise<RecordingManifest> {
    const r = this.room(roomId, false);
    const artefacts = [...r.recording.artefacts];
    return {
      roomId,
      artefacts,
      manifestSha256: sha256Hex(artefacts.map((a) => a.sha256).join("\n")),
      providerRetention: r.policy.providerRetention,
    };
  }

  async endRoom(roomId: string) {
    const r = this.room(roomId, false);
    if (r.recording.startedAt) await this.stopRecording(roomId);
    r.state = "ended";
  }

  async handleWebhook(rawBody: Uint8Array, _headers?: Readonly<Record<string, string>>) {
    let roomId: unknown;
    try {
      roomId = (JSON.parse(new TextDecoder().decode(rawBody)) as { roomId?: unknown }).roomId;
    } catch {
      roomId = undefined;
    }
    if (typeof roomId !== "string")
      throw new PortError("IPB-PORT-001", "VIDEO_MEET", {
        adapter: "fake-video-meet",
        detail: "an event names its room",
        meta: { reason: "malformed_event", definite: true },
      });
    // Only the room as read back is trusted.
    const r = this.room(roomId, false);
    const at = this.now().toISOString();
    return r.state === "ended" ? [{ type: "room_ended" as const, roomId, at }] : [];
  }
}

/** A V-CIP room's policy: India only, the official's network, recorded to the tenant's target. */
export const VCIP_ROOM_POLICY: RoomPolicy = {
  dataClass: "REGULATED",
  recording: "on",
  lobby: true,
  e2ee: true,
  participantCountries: ["IN"],
  officialNetworks: ["10.20.0.0/16"],
  recordingTarget: { targetRef: "tenant-vcip/tnt_kyc", prefix: "vcip/2026" },
  providerRetention: "none",
  maxMinutes: 60,
};
