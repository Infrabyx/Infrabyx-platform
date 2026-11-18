// VIDEO_MEET port contract cases and an in-memory fake (IPB-01-15; PR-FBX-01, R1-D-21). Adapters
// do not exist yet (OWNER-QUESTIONS #88); a future adapter runs `videoMeetContractCases()` with
// defineContractSuite("VIDEO_MEET", …). The fake enforces the room policy as an adapter must:
// participant countries, anonymised origins, the official's networks, and recordings written only
// to the room's target with a hash manifest.
// VIDEO_MEET port contract cases and an in-memory fake (IPB-01-15; PR-FBX-01, R1-D-21). Adapters
// do not exist yet (OWNER-QUESTIONS #88); a future adapter runs `videoMeetContractCases()` with
// defineContractSuite("VIDEO_MEET", …). The fake enforces the room policy as an adapter must:
// participant countries, anonymised origins, the official's networks, and recordings written only
// to the room's target with a hash manifest.
import { expect } from "vitest";
import { RoomPolicy, type JoinOrigin, type VideoMeetPort } from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";
import { VCIP_ROOM_POLICY } from "@infrabyx/fakes";
export { FakeVideoMeet, VCIP_ROOM_POLICY } from "@infrabyx/fakes";

export interface VideoMeetContractOptions {
  /** Signs a webhook body as the vendor would (the headers to send); fakes need none. */
  signWebhook?: (rawBody: Uint8Array) => Record<string, string>;
}

export function videoMeetContractCases(
  opts: VideoMeetContractOptions = {},
): Array<ContractCase<VideoMeetPort>> {
  const signed = (body: Uint8Array) => opts.signWebhook?.(body) ?? {};
  const IN_CUSTOMER: JoinOrigin = { ip: "49.36.10.10", country: "IN", anonymised: false };
  const OFFICE: JoinOrigin = { ip: "10.20.4.7", country: "IN", anonymised: false };
  const room = (p: VideoMeetPort) =>
    p.createRoom(
      "case_contract",
      [
        { ref: "cus:contract", role: "participant" },
        { ref: "usr_official", role: "official" },
      ],
      VCIP_ROOM_POLICY,
    );
  return [
    {
      name: "a REGULATED room keeps no provider copy and names its recording target (the schema refuses otherwise)",
      async run() {
        expect(() =>
          RoomPolicy.parse({ ...VCIP_ROOM_POLICY, providerRetention: "vendor" }),
        ).toThrow();
        const { recordingTarget: _t, ...noTarget } = VCIP_ROOM_POLICY;
        expect(() => RoomPolicy.parse(noTarget)).toThrow();
        expect(
          RoomPolicy.parse({
            ...VCIP_ROOM_POLICY,
            dataClass: "INTERNAL",
            providerRetention: "vendor",
          }).providerRetention,
        ).toBe("vendor");
      },
    },
    {
      name: "joins: India only, no anonymised origin, the official from the official network, participants in their role",
      method: "joinToken",
      async run(p) {
        const r = await room(p);
        expect(
          (await p.joinToken(r.roomId, "cus:contract", "participant", IN_CUSTOMER)).token.length,
        ).toBeGreaterThan(16);
        await p.joinToken(r.roomId, "usr_official", "official", OFFICE);
        const refused = { code: "IPB-SEC-002" };
        await expect(
          p.joinToken(r.roomId, "cus:contract", "participant", { ...IN_CUSTOMER, country: "SG" }),
        ).rejects.toMatchObject(refused);
        await expect(
          p.joinToken(r.roomId, "cus:contract", "participant", {
            ...IN_CUSTOMER,
            anonymised: true,
          }),
        ).rejects.toMatchObject(refused);
        await expect(
          p.joinToken(r.roomId, "usr_official", "official", IN_CUSTOMER),
        ).rejects.toMatchObject(refused);
        await expect(
          p.joinToken(r.roomId, "cus:contract", "official", OFFICE),
        ).rejects.toMatchObject(refused);
        await expect(
          p.joinToken(r.roomId, "cus:stranger", "participant", IN_CUSTOMER),
        ).rejects.toMatchObject(refused);
      },
    },
    {
      name: "a recording lands only in the room's target, with a SHA-256 manifest and no provider copy",
      method: "fetchRecording",
      async run(p) {
        const r = await room(p);
        await p.startRecording(r.roomId);
        await p.stopRecording(r.roomId);
        await p.endRoom(r.roomId);
        const m = await p.fetchRecording(r.roomId);
        expect(m.providerRetention).toBe("none");
        expect(m.artefacts.length).toBeGreaterThan(0);
        const t = VCIP_ROOM_POLICY.recordingTarget!;
        for (const a of m.artefacts) {
          expect(a.storageKey.startsWith(`${t.targetRef}/${t.prefix}/`)).toBe(true);
          expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
        }
        expect(m.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
      },
    },
    {
      name: "an ended room takes no joins; a room without recording refuses to record; events are read back",
      method: "endRoom",
      async run(p) {
        const r = await room(p);
        await p.endRoom(r.roomId);
        await expect(
          p.joinToken(r.roomId, "cus:contract", "participant", IN_CUSTOMER),
        ).rejects.toMatchObject({ code: "IPB-PORT-001" });
        const event = new TextEncoder().encode(
          JSON.stringify({ roomId: r.roomId, type: "anything" }),
        );
        const events = await p.handleWebhook(event, signed(event));
        expect(events.map((e) => e.type)).toContain("room_ended");
        const quiet = await p.createRoom("case_quiet", [{ ref: "usr_a", role: "host" }], {
          ...VCIP_ROOM_POLICY,
          recording: "off",
        });
        await expect(p.startRecording(quiet.roomId)).rejects.toMatchObject({
          code: "IPB-PORT-001",
        });
        const junk = new TextEncoder().encode("not json");
        await expect(p.handleWebhook(junk, signed(junk))).rejects.toMatchObject({
          code: "IPB-PORT-001",
        });
      },
    },
  ];
}
