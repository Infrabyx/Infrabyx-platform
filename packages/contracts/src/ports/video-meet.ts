// VIDEO_MEET port (IPB-01 VIDEO_MEET; Finbyx platform request PR-FBX-01, owner 29 Oct 2026,
// R1-D-21). The interface is IPB-01's list; adapters wait for the owner's vendor choices
// (OWNER-QUESTIONS #88). Rooms carry their policy: who may join from where (participant countries,
// the official's networks), end-to-end encryption, and where a recording goes. A recording of a
// CONFIDENTIAL or REGULATED room streams only to the room's storage target (for V-CIP, a bucket and
// key the tenant owns or leases) and the vendor keeps no copy (`providerRetention: "none"`); its
// manifest lists every artefact by SHA-256 (tamper-evident, IPB-01 VIDEO_MEET).
import { z } from "zod";
import { DataClass } from "../data-class.js";
import type { Port, PortCall, WebhookRequestMeta } from "./common.js";

export const ROOM_ROLES = ["host", "official", "participant", "observer"] as const;
export type RoomRole = (typeof ROOM_ROLES)[number];

const Cidr = z
  .string()
  .regex(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^[0-9a-fA-F:]+\/\d{1,3}$/, "an IPv4 or IPv6 CIDR");

export const RoomPolicy = z
  .object({
    dataClass: DataClass,
    recording: z.enum(["off", "on"]),
    lobby: z.boolean(),
    e2ee: z.boolean(),
    /** Countries a participant may join from (ISO 3166-1 alpha-2); V-CIP: `["IN"]`. */
    participantCountries: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .min(1)
      .optional(),
    /** Networks the host or official must join from (V-CIP: the tenant's official network or VPN). */
    officialNetworks: z.array(Cidr).min(1).optional(),
    /** Where recordings go; required when `recording` is on. */
    recordingTarget: z
      .object({
        /** STORAGE routing reference of the target, e.g. the tenant's V-CIP bucket. */
        targetRef: z.string().min(3).max(200),
        /** Key prefix under the target. */
        prefix: z.string().regex(/^[A-Za-z0-9/_.-]{1,200}$/),
      })
      .strict()
      .optional(),
    /** What the vendor keeps: `none` streams with no provider copy (required above INTERNAL). */
    providerRetention: z.enum(["none", "vendor"]),
    /** Room lifetime cap in minutes. */
    maxMinutes: z.number().int().min(1).max(480),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.recording === "on" && !p.recordingTarget)
      ctx.addIssue({ code: "custom", message: "a recorded room names its recording target" });
    if (p.dataClass !== "PUBLIC" && p.dataClass !== "INTERNAL" && p.providerRetention !== "none")
      ctx.addIssue({
        code: "custom",
        message: "a CONFIDENTIAL or REGULATED room keeps no provider copy",
      });
  });
export type RoomPolicy = z.infer<typeof RoomPolicy>;

export const RoomParticipant = z
  .object({ ref: z.string().min(3).max(200), role: z.enum(ROOM_ROLES) })
  .strict();
export type RoomParticipant = z.infer<typeof RoomParticipant>;

export interface Room {
  roomId: string;
  caseId: string;
  policy: RoomPolicy;
  state: "open" | "ended";
  createdAt: string;
}

/** Where a join comes from, as the product resolved it (GEO port, proxy detection). */
export interface JoinOrigin {
  ip: string;
  country: string;
  /** Flagged as a proxy, VPN, Tor or spoofed address by the product's geo check. */
  anonymised: boolean;
}

export interface JoinToken {
  token: string;
  url: string;
  expiresAt: string;
}

export interface RecordingArtefact {
  kind: "video" | "audio" | "composite" | "transcript";
  storageKey: string;
  sha256: string;
  bytes: number;
  startedAt: string;
  endedAt: string;
}

export interface RecordingManifest {
  roomId: string;
  artefacts: RecordingArtefact[];
  /** SHA-256 over the artefacts' hashes in order (the manifest's own hash). */
  manifestSha256: string;
  /** The vendor's statement that it retains nothing, where `providerRetention` is `none`. */
  providerRetention: "none" | "vendor";
}

export type RoomEvent =
  | { type: "participant_joined" | "participant_left"; roomId: string; ref: string; at: string }
  | { type: "recording_started" | "recording_stopped"; roomId: string; at: string }
  | { type: "room_ended"; roomId: string; at: string };

export interface VideoMeetPort extends Port {
  createRoom(
    caseId: string,
    participants: RoomParticipant[],
    policy: RoomPolicy,
    call?: PortCall,
  ): Promise<Room>;
  /**
   * A short-lived token for one participant. Refused with IPB-SEC-002 when the origin is outside
   * `participantCountries`, anonymised, or (for a host or official) outside `officialNetworks`.
   */
  joinToken(roomId: string, ref: string, role: RoomRole, origin: JoinOrigin): Promise<JoinToken>;
  startRecording(roomId: string): Promise<void>;
  stopRecording(roomId: string): Promise<void>;
  /** The recording as written to the room's target: artefacts and manifest, never media inline. */
  fetchRecording(roomId: string): Promise<RecordingManifest>;
  endRoom(roomId: string): Promise<void>;
  /** Parses the event, then reads the room back from the vendor; only that state is trusted. */
  handleWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<RoomEvent[]>;
}
