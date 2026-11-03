// VIDEO_MEET reference adapter `livekit` (owner answers #88 and #89, R1-D-22, R1-D-33, R1-plan M15):
// a self-hosted LiveKit server in India, called over its HTTP server API (Twirp, JSON), no SDK.
// Every token is an HS256 JWT made by C-26 in @infrabyx/crypto, the platform's only HS256 path:
// server-API tokens carry one grant for at most 60 s; join tokens one room and one identity for at
// most 300 s. Off behind `int.video_meet.livekit.enabled` until a deployment runs its server.
//
// The room's policy is the platform's, not LiveKit's: the adapter checks the origin (country,
// anonymised, the official's network) and the participant's role before it issues a token. Room
// state (policy, participants, recording) lives in a `LiveKitRoomStore` the product provides
// (durable in production); LiveKit's own view of the room is read back for liveness and webhooks.
//
// Recording (#90 (b), PR-FBX-27): LiveKit's egress worker writes each file to its own encrypted
// ephemeral disk; on stop the adapter reads each file, writes it to the room's target with one
// single-part `putWithRetention` (COMPLIANCE lock, SHA-256 checksum), and only then removes it from
// the disk, so no provider copy remains. The egress worker is an `EgressRunner`; the hermetic leg
// proves rooms, tokens and webhooks against a real LiveKit server and the upload path with a
// scripted runner, while the egress worker itself is proven only where it runs (`unproven`).
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import {
  RoomParticipant,
  RoomPolicy,
  storageKey,
  type AdapterDescriptor,
  type JoinOrigin,
  type JoinToken,
  type PortHealth,
  type RecordingArtefact,
  type RecordingManifest,
  type Room,
  type RoomEvent,
  type RoomRole,
  type StoragePort,
  type VideoMeetPort,
  type WebhookRequestMeta,
} from "@infrabyx/contracts/ports";
import {
  LiveKitCredentials,
  newId,
  randomBytes,
  sha256Hex,
  signLiveKitJoinToken,
  signLiveKitServerToken,
  toBase64Url,
  verifyLiveKitWebhook,
  type LiveKitServerGrant,
} from "@infrabyx/crypto";
import { createEgress } from "../core/http.js";
import { header, vendorError, webhookRefused } from "../messaging/common.js";

const PORT = "VIDEO_MEET";
const ADAPTER = "livekit";

/** What the adapter keeps about a room between calls. */
export interface LiveKitRoomState {
  caseId: string;
  policy: RoomPolicy;
  participants: Array<[string, RoomRole]>;
  createdAt: string;
  state: "open" | "ended";
  recording: { egressId?: string; startedAt?: string; artefacts: RecordingArtefact[] };
}

/** Durable in production (the product's table or Redis with persistence); memory in tests. */
export interface LiveKitRoomStore {
  get(roomId: string): Promise<LiveKitRoomState | undefined>;
  set(roomId: string, state: LiveKitRoomState): Promise<void>;
}

export class MemoryLiveKitRoomStore implements LiveKitRoomStore {
  private readonly rooms = new Map<string, string>();
  async get(roomId: string) {
    const s = this.rooms.get(roomId);
    return s ? (JSON.parse(s) as LiveKitRoomState) : undefined;
  }
  async set(roomId: string, state: LiveKitRoomState) {
    this.rooms.set(roomId, JSON.stringify(state));
  }
}

/** A room's recording target, resolved from its `targetRef` (for V-CIP, the tenant's bucket). */
export interface RecordingTarget {
  storage: StoragePort;
  tenantId: string;
  /** The retention date for each file written now (at least the KYC floor; PR-FBX-27). */
  retainUntil: () => Date;
}

export interface EgressFile {
  kind: RecordingArtefact["kind"];
  /** Path on the egress worker's ephemeral disk. */
  path: string;
  contentType: string;
  startedAt: string;
  endedAt: string;
}

/** The egress worker: starts and stops a room's recording and hands its files over once. */
export interface EgressRunner {
  start(room: string, token: (grant: LiveKitServerGrant) => string): Promise<{ egressId: string }>;
  stop(
    egressId: string,
    room: string,
    token: (grant: LiveKitServerGrant) => string,
  ): Promise<EgressFile[]>;
  read(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
}

export interface LiveKitVideoMeetOptions {
  /** The server API, e.g. `https://livekit.example.in` (http allowed on loopback in tests). */
  apiUrl: string;
  /** What clients connect to, e.g. `wss://livekit.example.in`. */
  wsUrl: string;
  /** `secrets/<env>/video_meet/livekit/api_key` and `api_secret`, checked by C-26. */
  credentials: () => Promise<LiveKitCredentials> | LiveKitCredentials;
  /** `int.video_meet.livekit.enabled`, read on every call. */
  enabled: () => Promise<boolean> | boolean;
  rooms: LiveKitRoomStore;
  targets: (targetRef: string) => RecordingTarget | Promise<RecordingTarget>;
  /** The egress worker; without one, recording is refused. */
  egress?: EgressRunner;
  allowLoopbackHttp?: boolean;
  now?: () => Date;
}

const refused = (detail: string, reason: string): PortError =>
  new PortError("IPB-PORT-001", PORT, {
    adapter: ADAPTER,
    detail,
    meta: { reason, definite: true },
  });

/** IPv4 CIDR membership; any other form never matches (the official is then refused). */
function inCidr(ip: string, cidr: string): boolean {
  const [net, bits] = cidr.split("/") as [string, string];
  const v4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!v4.test(ip) || !v4.test(net)) return false;
  const n = (a: string) => a.split(".").reduce((x, o) => x * 256 + Number(o), 0);
  const size = 2 ** (32 - Number(bits));
  return Math.floor(n(ip) / size) === Math.floor(n(net) / size);
}

const JOIN_GRANTS: Record<
  RoomRole,
  { canPublish: boolean; canSubscribe: boolean; canPublishData: boolean }
> = {
  host: { canPublish: true, canSubscribe: true, canPublishData: true },
  official: { canPublish: true, canSubscribe: true, canPublishData: true },
  participant: { canPublish: true, canSubscribe: true, canPublishData: false },
  observer: { canPublish: false, canSubscribe: true, canPublishData: false },
};

const EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "text/vtt": "vtt",
  "application/json": "json",
};

export class LiveKitVideoMeet implements VideoMeetPort {
  readonly descriptor: AdapterDescriptor;
  private readonly egress;
  private readonly base: string;
  private readonly now: () => Date;

  constructor(private readonly o: LiveKitVideoMeetOptions) {
    const api = new URL(o.apiUrl);
    this.base = api.toString().replace(/\/$/, "");
    this.now = o.now ?? (() => new Date());
    this.egress = createEgress({
      port: PORT,
      adapter: ADAPTER,
      allow: [api.hostname],
      retries: 1,
      maxBytes: 1024 * 1024,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
    this.descriptor = {
      port: PORT,
      adapter: ADAPTER,
      residency: "IN",
      maxDataClass: "REGULATED",
      ...(o.egress
        ? {}
        : {
            capabilities: {
              startRecording: "unsupported",
              stopRecording: "unsupported",
              fetchRecording: "unsupported",
            },
          }),
    };
  }

  // ---- plumbing ----------------------------------------------------------------------------------

  private async guard(): Promise<LiveKitCredentials> {
    if (!(await this.o.enabled()))
      throw refused(
        "the LiveKit adapter is off (int.video_meet.livekit.enabled)",
        "adapter_disabled",
      );
    return this.o.credentials();
  }

  private async twirp<T>(
    c: LiveKitCredentials,
    service: "RoomService" | "Egress",
    method: string,
    grant: LiveKitServerGrant,
    body: Record<string, unknown>,
  ): Promise<T> {
    const res = await this.egress(`${this.base}/twirp/livekit.${service}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${signLiveKitServerToken(c, grant, { now: this.now().getTime() })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.status !== 200) throw vendorError(PORT, ADAPTER, res.status, `LiveKit ${method}`);
    return JSON.parse(new TextDecoder().decode(res.body)) as T;
  }

  private async vendorRoomExists(c: LiveKitCredentials, roomId: string): Promise<boolean> {
    const r = await this.twirp<{ rooms?: Array<{ name?: string }> }>(
      c,
      "RoomService",
      "ListRooms",
      { roomList: true },
      { names: [roomId] },
    );
    return (r.rooms ?? []).some((x) => x.name === roomId);
  }

  private async state(roomId: string, open: boolean): Promise<LiveKitRoomState> {
    const s = await this.o.rooms.get(roomId);
    if (!s) throw refused("no such room", "not_found");
    if (open && s.state !== "open") throw refused("the room has ended", "ended");
    return s;
  }

  private toRoom(roomId: string, s: LiveKitRoomState): Room {
    return { roomId, caseId: s.caseId, policy: s.policy, state: s.state, createdAt: s.createdAt };
  }

  // ---- port --------------------------------------------------------------------------------------

  async createRoom(
    caseId: string,
    participants: RoomParticipant[],
    policy: RoomPolicy,
  ): Promise<Room> {
    const c = await this.guard();
    const p = RoomPolicy.parse(policy);
    const ps = participants.map((x) => RoomParticipant.parse(x));
    if (p.recording === "on" && !this.o.egress)
      throw refused("this deployment has no egress worker for recorded rooms", "no_egress");
    const roomId = `room_${toBase64Url(randomBytes(12))}`;
    await this.twirp(
      c,
      "RoomService",
      "CreateRoom",
      { roomCreate: true },
      {
        name: roomId,
        empty_timeout: 300,
        departure_timeout: 20,
        max_participants: ps.length,
      },
    );
    const s: LiveKitRoomState = {
      caseId,
      policy: p,
      participants: ps.map((x) => [x.ref, x.role]),
      createdAt: this.now().toISOString(),
      state: "open",
      recording: { artefacts: [] },
    };
    await this.o.rooms.set(roomId, s);
    return this.toRoom(roomId, s);
  }

  async joinToken(
    roomId: string,
    ref: string,
    role: RoomRole,
    origin: JoinOrigin,
  ): Promise<JoinToken> {
    const c = await this.guard();
    const s = await this.state(roomId, true);
    const refuse = (why: string): never => {
      throw new IpbError("IPB-SEC-002", { detail: why, meta: { roomId } });
    };
    if (!s.participants.some(([r, ro]) => r === ref && ro === role))
      refuse("not a participant of the room in this role");
    if (origin.anonymised) refuse("a proxy, VPN or spoofed origin may not join");
    if (s.policy.participantCountries && !s.policy.participantCountries.includes(origin.country))
      refuse("joining from this country is not allowed for this room");
    if ((role === "host" || role === "official") && s.policy.officialNetworks)
      if (!s.policy.officialNetworks.some((cidr) => inCidr(origin.ip, cidr)))
        refuse("the official joins from the tenant's official network only");
    // The vendor's view decides whether the room still exists.
    if (!(await this.vendorRoomExists(c, roomId))) {
      await this.o.rooms.set(roomId, { ...s, state: "ended" });
      throw refused("the room has ended", "ended");
    }
    const t = signLiveKitJoinToken(c, {
      room: roomId,
      identity: ref,
      grants: JOIN_GRANTS[role],
      now: this.now().getTime(),
    });
    return { token: t.token, url: this.o.wsUrl, expiresAt: new Date(t.expiresAt).toISOString() };
  }

  async startRecording(roomId: string): Promise<void> {
    const c = await this.guard();
    const s = await this.state(roomId, true);
    if (s.policy.recording !== "on")
      throw refused("the room's policy does not record", "recording_off");
    if (!this.o.egress) throw refused("this deployment has no egress worker", "no_egress");
    if (s.recording.egressId) return;
    const { egressId } = await this.o.egress.start(roomId, (g) =>
      signLiveKitServerToken(c, g, { now: this.now().getTime() }),
    );
    s.recording.egressId = egressId;
    s.recording.startedAt = this.now().toISOString();
    await this.o.rooms.set(roomId, s);
  }

  async stopRecording(roomId: string): Promise<void> {
    const c = await this.guard();
    const s = await this.state(roomId, false);
    const egressId = s.recording.egressId;
    if (!egressId || !this.o.egress) return;
    const t = s.policy.recordingTarget!;
    const target = await this.o.targets(t.targetRef);
    const files = await this.o.egress.stop(egressId, roomId, (g) =>
      signLiveKitServerToken(c, g, { now: this.now().getTime() }),
    );
    for (const f of files) {
      const body = await this.o.egress.read(f.path);
      const sha256 = sha256Hex(body);
      const ext = EXT[f.contentType] ?? "bin";
      const key = storageKey(target.tenantId, "vcip", newId("rec").slice(4), ext);
      // One single-part write with the lock and the checksum; the disk copy goes only after it.
      await target.storage.putWithRetention(key, body, target.retainUntil(), {
        bucketClass: "REGULATED",
        contentType: f.contentType,
        sha256,
      });
      await target.storage.assertImmutable(key);
      await this.o.egress.remove(f.path);
      s.recording.artefacts.push({
        kind: f.kind,
        storageKey: `${t.targetRef}/${t.prefix}/${key}`,
        sha256,
        bytes: body.byteLength,
        startedAt: f.startedAt,
        endedAt: f.endedAt,
      });
    }
    delete s.recording.egressId;
    delete s.recording.startedAt;
    await this.o.rooms.set(roomId, s);
  }

  async fetchRecording(roomId: string): Promise<RecordingManifest> {
    await this.guard();
    const s = await this.state(roomId, false);
    const artefacts = [...s.recording.artefacts];
    return {
      roomId,
      artefacts,
      manifestSha256: sha256Hex(artefacts.map((a) => a.sha256).join("\n")),
      providerRetention: s.policy.providerRetention,
    };
  }

  async endRoom(roomId: string): Promise<void> {
    const c = await this.guard();
    const s = await this.state(roomId, false);
    if (s.recording.egressId) await this.stopRecording(roomId);
    try {
      await this.twirp(c, "RoomService", "DeleteRoom", { roomCreate: true }, { room: roomId });
    } catch (e) {
      // A room LiveKit already closed (empty timeout) is ended all the same.
      if (!(e instanceof PortError) || e.code !== "IPB-PORT-001") throw e;
    }
    const after = await this.state(roomId, false);
    await this.o.rooms.set(roomId, { ...after, state: "ended" });
  }

  async handleWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    _meta?: WebhookRequestMeta,
  ): Promise<RoomEvent[]> {
    const c = await this.guard();
    const failure = verifyLiveKitWebhook(c, header(headers, "authorization"), rawBody, {
      now: this.now().getTime(),
    });
    if (failure) throw webhookRefused(PORT, ADAPTER, `LiveKit token ${failure}`);
    let body: { roomId?: unknown; room?: { name?: unknown } };
    try {
      body = JSON.parse(new TextDecoder().decode(rawBody)) as typeof body;
    } catch {
      throw refused("an event names its room", "malformed_event");
    }
    const roomId = body?.room?.name ?? body?.roomId;
    if (typeof roomId !== "string") throw refused("an event names its room", "malformed_event");
    // The event is only a trigger: the room is read back from LiveKit and from the room store.
    const s = await this.state(roomId, false);
    const at = this.now().toISOString();
    if (s.state === "ended") return [{ type: "room_ended", roomId, at }];
    if (!(await this.vendorRoomExists(c, roomId))) {
      await this.o.rooms.set(roomId, { ...s, state: "ended" });
      return [{ type: "room_ended", roomId, at }];
    }
    return [];
  }

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      const c = await this.guard();
      await this.twirp(c, "RoomService", "ListRooms", { roomList: true }, { names: [] });
    } catch {
      status = "down";
    }
    return {
      status,
      latency_ms: Math.round(performance.now() - started),
      checked_at: new Date().toISOString(),
    };
  }
}

/**
 * The LiveKit egress worker through the server API: a room-composite recording to a file on the
 * worker's encrypted ephemeral disk (`dir`), which `disk` reads and removes (a volume shared with
 * the worker). Unproven until it runs beside a LiveKit egress worker.
 */
export class LiveKitEgress implements EgressRunner {
  private readonly egress;
  private readonly base: string;
  constructor(
    private readonly o: {
      apiUrl: string;
      dir: string;
      disk: { read(path: string): Promise<Uint8Array>; remove(path: string): Promise<void> };
      allowLoopbackHttp?: boolean;
    },
  ) {
    const api = new URL(o.apiUrl);
    this.base = api.toString().replace(/\/$/, "");
    this.egress = createEgress({
      port: PORT,
      adapter: ADAPTER,
      allow: [api.hostname],
      retries: 0,
      maxBytes: 1024 * 1024,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private async call<T>(method: string, token: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.egress(`${this.base}/twirp/livekit.Egress/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status !== 200) throw vendorError(PORT, ADAPTER, res.status, `LiveKit ${method}`);
    return JSON.parse(new TextDecoder().decode(res.body)) as T;
  }

  async start(room: string, token: (g: LiveKitServerGrant) => string) {
    const r = await this.call<{ egress_id?: string }>(
      "StartRoomCompositeEgress",
      token({ roomRecord: true, room }),
      {
        room_name: room,
        file_outputs: [{ file_type: "MP4", filepath: `${this.o.dir}/${room}-{time}.mp4` }],
      },
    );
    if (!r.egress_id) throw refused("LiveKit started no egress", "egress_failed");
    return { egressId: r.egress_id };
  }

  async stop(egressId: string, room: string, token: (g: LiveKitServerGrant) => string) {
    const r = await this.call<{
      file_results?: Array<{ filename?: string; started_at?: string; ended_at?: string }>;
    }>("StopEgress", token({ roomRecord: true, room }), { egress_id: egressId });
    const iso = (ns?: string) => new Date(Number(BigInt(ns ?? "0") / 1_000_000n)).toISOString();
    return (r.file_results ?? [])
      .filter((f) => typeof f.filename === "string" && f.filename.startsWith(`${this.o.dir}/`))
      .map((f) => ({
        kind: "composite" as const,
        path: f.filename as string,
        contentType: "video/mp4",
        startedAt: iso(f.started_at),
        endedAt: iso(f.ended_at),
      }));
  }

  read(path: string) {
    return this.o.disk.read(path);
  }

  remove(path: string) {
    return this.o.disk.remove(path);
  }
}
