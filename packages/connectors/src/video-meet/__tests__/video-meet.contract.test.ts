// VIDEO_MEET contract legs (R1-plan M15; owner answers #88, #89; R1-D-33, R1-D-53). Hermetic: a
// self-hosted LiveKit server (pinned image, single node) with a 32-byte API secret. Rooms, joins,
// tokens and webhooks run against the real server; recording runs through a scripted egress
// worker that writes files to a temporary disk, proving the upload path (one locked single-part
// write per file, then the disk copy removed). The LiveKit egress worker itself is not proven here.
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  generateWebhookSecret,
  LiveKitCredentials,
  signLiveKitWebhookForTest,
  type LiveKitServerGrant,
} from "@infrabyx/crypto";
import {
  defineContractSuite,
  MemoryStorage,
  startService,
  VCIP_ROOM_POLICY,
  videoMeetContractCases,
  type StartedService,
} from "@infrabyx/testing";
import { LiveKitVideoMeet, MemoryLiveKitRoomStore, type EgressRunner } from "../livekit.js";

const KEY = "APIipbcontract";
const SECRET = generateWebhookSecret();
const creds = new LiveKitCredentials(KEY, SECRET);
let lk: StartedService;
let apiUrl = "";
let disk = "";
const storage = new MemoryStorage();
const grants: LiveKitServerGrant[] = [];

/** Stands in for the LiveKit egress worker: one composite file per recording on a temp disk. */
const scriptedEgress = (): EgressRunner => ({
  async start(room, token) {
    token({ roomRecord: true, room });
    grants.push({ roomRecord: true, room });
    return { egressId: `EG_${room}` };
  },
  async stop(egressId, room) {
    const path = join(disk, `${room}.mp4`);
    await writeFile(path, `recording of ${egressId}`);
    const at = new Date().toISOString();
    return [{ kind: "composite", path, contentType: "video/mp4", startedAt: at, endedAt: at }];
  },
  read: async (path) => new Uint8Array(await readFile(path)),
  remove: (path) => rm(path),
});

let enabled = true;
const livekit = (egress: EgressRunner | undefined = scriptedEgress()) =>
  new LiveKitVideoMeet({
    apiUrl,
    wsUrl: apiUrl.replace(/^http/, "ws"),
    credentials: () => creds,
    enabled: () => enabled,
    rooms: shared,
    targets: () => ({
      storage,
      tenantId: "tnt_kyc",
      retainUntil: () => new Date(Date.now() + 86_400_000),
    }),
    ...(egress ? { egress } : {}),
    allowLoopbackHttp: true,
  });
const shared = new MemoryLiveKitRoomStore();

beforeAll(async () => {
  disk = await mkdtemp(join(tmpdir(), "ipb-egress-"));
  lk = await startService("livekit", {
    ports: [7880],
    command: ["--keys", `${KEY}: ${SECRET}`, "--bind", "0.0.0.0"],
    readyLog: /starting LiveKit server/,
  });
  apiUrl = lk.url ?? `http://${lk.host}:${lk.ports[7880]}`;
}, 120_000);
afterAll(async () => {
  await lk?.stop();
  if (disk) await rm(disk, { recursive: true, force: true });
});

describe("@IPB-01-15 VIDEO_MEET hermetic leg: livekit on a self-hosted LiveKit server", () => {
  defineContractSuite(
    "VIDEO_MEET",
    () => livekit(),
    videoMeetContractCases({
      signWebhook: (body) => ({ authorization: signLiveKitWebhookForTest(creds, body) }),
    }),
    { leg: "hermetic" },
  );
});

describe("R1-D-53 the LiveKit adapter: C-26 tokens, the vendor's view, recordings without a copy", () => {
  it("issues a 300-second join token LiveKit accepts for that room only", async () => {
    const p = livekit();
    const r = await p.createRoom("case_a", [{ ref: "cus:a", role: "participant" }], {
      ...VCIP_ROOM_POLICY,
      recording: "off",
    });
    const t = await p.joinToken(r.roomId, "cus:a", "participant", {
      ip: "49.36.1.1",
      country: "IN",
      anonymised: false,
    });
    const claims = JSON.parse(Buffer.from(t.token.split(".")[1]!, "base64url").toString()) as {
      exp: number;
      nbf: number;
      sub: string;
      video: Record<string, unknown>;
    };
    expect(claims.exp - claims.nbf).toBe(300);
    expect(claims.sub).toBe("cus:a");
    expect(claims.video).toMatchObject({ room: r.roomId, roomJoin: true, canPublishData: false });
    expect(claims.video.roomAdmin).toBeUndefined();
    // LiveKit itself refuses the join token on its server API (no admin grant).
    const res = await fetch(`${apiUrl}/twirp/livekit.RoomService/ListRooms`, {
      method: "POST",
      headers: { authorization: `Bearer ${t.token}`, "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("writes each recording once, locked, under the tenant, then removes it from the egress disk", async () => {
    const p = livekit();
    const r = await p.createRoom(
      "case_rec",
      [
        { ref: "cus:b", role: "participant" },
        { ref: "usr_official", role: "official" },
      ],
      VCIP_ROOM_POLICY,
    );
    await p.startRecording(r.roomId);
    await p.endRoom(r.roomId);
    const m = await p.fetchRecording(r.roomId);
    expect(m.artefacts).toHaveLength(1);
    const key = m.artefacts[0]!.storageKey.split(
      `${VCIP_ROOM_POLICY.recordingTarget!.prefix}/`,
    )[1]!;
    expect(key).toMatch(/^tenant\/tnt_kyc\/vcip\/[0-9A-Z]{26}\.mp4$/);
    await storage.assertImmutable(key);
    expect(await readdir(disk)).toEqual([]);
    expect(grants.at(-1)).toEqual({ roomRecord: true, room: r.roomId });
  });

  it("refuses unsigned or foreign webhooks, recording without an egress worker, and is off behind its flag", async () => {
    const p = livekit();
    const r = await p.createRoom("case_w", [{ ref: "usr_h", role: "host" }], {
      ...VCIP_ROOM_POLICY,
      recording: "off",
    });
    const body = new TextEncoder().encode(
      JSON.stringify({ event: "room_started", room: { name: r.roomId } }),
    );
    await expect(p.handleWebhook(body, {})).rejects.toMatchObject({ code: "IPB-API-018" });
    const other = new LiveKitCredentials("APIother", generateWebhookSecret());
    await expect(
      p.handleWebhook(body, { authorization: signLiveKitWebhookForTest(other, body) }),
    ).rejects.toMatchObject({ code: "IPB-API-018" });
    expect(
      await p.handleWebhook(body, { authorization: signLiveKitWebhookForTest(creds, body) }),
    ).toEqual([]);
    const noEgress = livekit(null as never);
    expect(noEgress.descriptor.capabilities?.startRecording).toBe("unsupported");
    await expect(
      noEgress.createRoom("case_n", [{ ref: "usr_h", role: "host" }], VCIP_ROOM_POLICY),
    ).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "no_egress" },
    });
    enabled = false;
    try {
      await expect(
        p.joinToken(r.roomId, "usr_h", "host", {
          ip: "10.20.0.1",
          country: "IN",
          anonymised: false,
        }),
      ).rejects.toMatchObject({
        code: "IPB-PORT-001",
        meta: { reason: "adapter_disabled" },
      });
      expect((await p.health()).status).toBe("down");
    } finally {
      enabled = true;
    }
    expect((await p.health()).status).toBe("up");
  });
});
