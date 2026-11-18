// TELEPHONY fake and contract cases (Finbyx PR-FBX-38; ADR-0007; R1-D-97). The fake places no
// call: a test scripts each number's outcome (`answer`, `no_answer`, `busy`, `fail`) and whether
// the disclosure plays; `finish` ends an answered call. Recordings go to an in-memory STORAGE map
// under the request's output prefix, by SHA-256. The cases hold every adapter to the port's rules:
// people place calls (never agents), one call per idempotency key, and no recording kept without
// its disclosure.
import { PortError } from "@infrabyx/contracts/errors";
import {
  ClickToCallRequest,
  FINAL_CALL_STATES,
  type AdapterDescriptor,
  type CallHandle,
  type CallOutcome,
  type CallState,
  type PortHealth,
  type StoredRecording,
  type TelephonyPort,
} from "@infrabyx/contracts/ports";
import { canonicalDigest, newId, sha256Hex } from "@infrabyx/crypto";

export type ScriptedOutcome = "answer" | "no_answer" | "busy" | "fail";

interface FakeCall {
  req: ClickToCallRequest;
  digest: string;
  outcome: CallOutcome;
  stored?: StoredRecording;
}

const iso = () => new Date().toISOString();

export class FakeTelephony implements TelephonyPort {
  readonly descriptor: AdapterDescriptor = {
    port: "TELEPHONY",
    adapter: "fake-telephony",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  /** Objects the fake "stored" in the tenant's STORAGE, by key. */
  readonly storage = new Map<string, Buffer>();
  private readonly calls = new Map<string, FakeCall>();
  private readonly byKey = new Map<string, string>();
  private readonly scripts = new Map<string, { outcome: ScriptedOutcome; disclosure: boolean }>();

  /** How the call to `to` goes (default: answered, disclosure played). */
  script(to: string, outcome: ScriptedOutcome, o: { disclosurePlayed?: boolean } = {}): void {
    this.scripts.set(to, { outcome, disclosure: o.disclosurePlayed ?? true });
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: iso() };
  }

  async clickToCall(raw: ClickToCallRequest): Promise<CallHandle> {
    if ((raw as { initiatedBy?: { type?: string } })?.initiatedBy?.type === "agent")
      throw new PortError("IPB-SEC-004", "TELEPHONY", { detail: "an agent never places a call" });
    const req = ClickToCallRequest.parse(raw);
    const digest = canonicalDigest(req);
    const prior = this.byKey.get(req.idempotencyKey);
    if (prior) {
      const c = this.calls.get(prior)!;
      if (c.digest !== digest)
        throw new PortError("IPB-PORT-004", "TELEPHONY", { meta: { key: req.idempotencyKey } });
      return { callId: prior, state: c.outcome.state, idempotencyKey: req.idempotencyKey };
    }
    const script = this.scripts.get(req.to) ?? { outcome: "answer", disclosure: true };
    const callId = newId("cal");
    const at = iso();
    const state: CallState =
      script.outcome === "answer"
        ? "in_progress"
        : script.outcome === "fail"
          ? "failed"
          : script.outcome;
    const outcome: CallOutcome = {
      callId,
      state,
      purpose: req.purpose,
      startedAt: at,
      answeredAt: state === "in_progress" ? at : null,
      endedAt: state === "in_progress" ? null : at,
      talkSeconds: 0,
      hangupBy: state === "in_progress" ? null : "system",
      recording:
        req.recording.enabled && state === "in_progress"
          ? {
              state: script.disclosure ? "pending" : "not_kept",
              disclosurePlayed: script.disclosure,
              disclosureId: req.recording.disclosureId,
            }
          : null,
    };
    this.calls.set(callId, { req, digest, outcome });
    this.byKey.set(req.idempotencyKey, callId);
    return { callId, state, idempotencyKey: req.idempotencyKey };
  }

  /** Test control: the answered call ends after `talkSeconds`, hung up by `by`. */
  finish(callId: string, talkSeconds = 42, by: "agent" | "customer" = "agent"): void {
    const c = this.must(callId);
    if (c.outcome.state !== "in_progress") throw new Error("only an answered call finishes");
    c.outcome = {
      ...c.outcome,
      state: "completed",
      endedAt: iso(),
      talkSeconds,
      hangupBy: by,
      recording:
        c.outcome.recording && c.outcome.recording.disclosurePlayed
          ? { ...c.outcome.recording, state: "available" }
          : c.outcome.recording,
    };
  }

  async callOutcome(callId: string): Promise<CallOutcome> {
    return structuredClone(this.must(callId).outcome);
  }

  async storeRecording(callId: string): Promise<StoredRecording> {
    const c = this.must(callId);
    if (c.stored) return c.stored;
    const rec = c.req.recording;
    const refuse = (why: string) =>
      new PortError("IPB-PORT-003", "TELEPHONY", { detail: `recording not kept: ${why}` });
    if (!rec.enabled || !c.outcome.recording) throw refuse("the call was not recorded");
    if (!c.outcome.recording.disclosurePlayed) throw refuse("the disclosure was not played");
    if (!FINAL_CALL_STATES.includes(c.outcome.state) || c.outcome.recording.state !== "available")
      throw refuse("the call has not finished");
    const bytes = Buffer.from(`fake recording of ${callId}`);
    const sha256 = sha256Hex(bytes);
    const storageKey = `${rec.outputPrefix}/${callId}.ogg`;
    this.storage.set(storageKey, bytes);
    const stored: StoredRecording = {
      callId,
      file: { storageKey, sha256 },
      contentType: "audio/ogg",
      durationSeconds: c.outcome.talkSeconds,
      disclosureId: rec.disclosureId,
      retentionDays: rec.retentionDays,
      deleteAfter: new Date(Date.now() + rec.retentionDays * 86_400_000).toISOString(),
    };
    c.stored = stored;
    c.outcome = { ...c.outcome, recording: { ...c.outcome.recording, state: "stored" } };
    return stored;
  }

  async cancel(callId: string): Promise<CallHandle> {
    const c = this.must(callId);
    if (c.outcome.answeredAt) throw new Error("an answered call is not cancelled");
    if (!FINAL_CALL_STATES.includes(c.outcome.state))
      c.outcome = { ...c.outcome, state: "cancelled", endedAt: iso(), hangupBy: "agent" };
    return { callId, state: c.outcome.state, idempotencyKey: c.req.idempotencyKey };
  }

  private must(callId: string): FakeCall {
    const c = this.calls.get(callId);
    if (!c) throw new PortError("IPB-PORT-005", "TELEPHONY", { detail: `no call ${callId}` });
    return c;
  }
}
