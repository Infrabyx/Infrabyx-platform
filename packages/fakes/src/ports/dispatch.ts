// DISPATCH fake and contract cases (Finbyx PR-FBX-41; ADR-0008; R1-D-104). The fake sends nothing:
// a test scripts how each PIN code's dispatch goes (`deliver`, `return`, `fail`) and moves it on
// with `advance`. Proofs go to an in-memory STORAGE map under the request's evidence prefix. The
// cases hold every adapter to the port's rules: people send (never agents), one dispatch per key,
// the document's hash kept, and no proof before it exists.
import { PortError } from "@infrabyx/contracts/errors";
import {
  DispatchRequest,
  FINAL_DISPATCH_STATES,
  type AdapterDescriptor,
  type DispatchHandle,
  type DispatchPort,
  type DispatchProof,
  type DispatchProofKind,
  type DispatchStatus,
  type PortHealth,
} from "@infrabyx/contracts/ports";
import { canonicalDigest, newId, sha256Hex } from "@infrabyx/crypto";

export type ScriptedDispatch = "deliver" | "return" | "fail";

interface FakeDispatchRecord {
  req: DispatchRequest;
  digest: string;
  status: DispatchStatus;
  script: ScriptedDispatch;
  proofs: Map<DispatchProofKind, DispatchProof>;
}

const iso = () => new Date().toISOString();

export class FakeDispatch implements DispatchPort {
  readonly descriptor: AdapterDescriptor = {
    port: "DISPATCH",
    adapter: "fake-dispatch",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  /** Objects the fake "stored" in the tenant's STORAGE, by key. */
  readonly storage = new Map<string, Buffer>();
  private readonly records = new Map<string, FakeDispatchRecord>();
  private readonly byKey = new Map<string, string>();
  private readonly scripts = new Map<string, ScriptedDispatch>();
  private article = 0;

  /** How a dispatch to `pincode` goes (default: delivered). */
  script(pincode: string, outcome: ScriptedDispatch): void {
    this.scripts.set(pincode, outcome);
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: iso() };
  }

  async dispatch(raw: DispatchRequest): Promise<DispatchHandle> {
    if ((raw as { initiatedBy?: { type?: string } })?.initiatedBy?.type === "agent")
      throw new PortError("IPB-SEC-004", "DISPATCH", { detail: "an agent never sends a dispatch" });
    const req = DispatchRequest.parse(raw);
    const digest = canonicalDigest(req);
    const prior = this.byKey.get(req.idempotencyKey);
    if (prior) {
      const r = this.records.get(prior)!;
      if (r.digest !== digest)
        throw new PortError("IPB-PORT-004", "DISPATCH", { meta: { key: req.idempotencyKey } });
      return this.handle(r);
    }
    const dispatchId = newId("dsp");
    const r: FakeDispatchRecord = {
      req,
      digest,
      script: this.scripts.get(req.addressee.pincode) ?? "deliver",
      proofs: new Map(),
      status: {
        dispatchId,
        channel: req.channel,
        state: "queued",
        trackingId: null,
        purpose: req.purpose,
        documentSha256: req.document.sha256,
        bookedAt: null,
        deliveredAt: null,
        returnReason: null,
        events: [],
      },
    };
    this.records.set(dispatchId, r);
    this.byKey.set(req.idempotencyKey, dispatchId);
    return this.handle(r);
  }

  /** Test control: one step on (queued → booked → in transit → the scripted end). */
  advance(dispatchId: string): void {
    const r = this.must(dispatchId);
    const s = r.status;
    const event = (code: string, description: string) =>
      s.events.push({ at: iso(), code, description, location: "Test PO" });
    if (s.state === "queued") {
      if (r.script === "fail") {
        s.state = "failed";
        event("NB", "Not booked");
        return;
      }
      s.state = "booked";
      s.trackingId = `EF${String(++this.article).padStart(9, "0")}IN`;
      s.bookedAt = iso();
      event("BK", "Item booked");
    } else if (s.state === "booked") {
      s.state = "in_transit";
      event("IT", "Item dispatched");
    } else if (s.state === "in_transit") {
      if (r.script === "return") {
        s.state = "returned";
        s.returnReason = "refused";
        event("RT", "Item returned to sender: refused");
      } else {
        s.state = "delivered";
        s.deliveredAt = iso();
        event("DL", "Item delivered");
      }
    } else throw new Error("the dispatch is final");
  }

  async status(dispatchId: string): Promise<DispatchStatus> {
    return structuredClone(this.must(dispatchId).status);
  }

  async storeProof(dispatchId: string, kind: DispatchProofKind): Promise<DispatchProof> {
    const r = this.must(dispatchId);
    const have = r.proofs.get(kind);
    if (have) return have;
    const s = r.status;
    const exists =
      kind === "booking_receipt"
        ? s.bookedAt !== null
        : kind === "proof_of_delivery"
          ? s.state === "delivered"
          : s.state === "returned";
    if (!exists)
      throw new PortError("IPB-PORT-003", "DISPATCH", {
        detail: `no ${kind} for a dispatch that is ${s.state}`,
      });
    const bytes = Buffer.from(`${kind} ${s.trackingId} ${s.documentSha256}`);
    const storageKey = `${r.req.evidencePrefix}/${dispatchId}-${kind}.pdf`;
    this.storage.set(storageKey, bytes);
    const proof: DispatchProof = {
      dispatchId,
      kind,
      file: { storageKey, sha256: sha256Hex(bytes) },
      contentType: "application/pdf",
      documentSha256: s.documentSha256,
      trackingId: s.trackingId,
    };
    r.proofs.set(kind, proof);
    return proof;
  }

  async cancel(dispatchId: string): Promise<DispatchHandle> {
    const r = this.must(dispatchId);
    if (r.status.state !== "queued" && !FINAL_DISPATCH_STATES.includes(r.status.state))
      throw new PortError("IPB-PORT-003", "DISPATCH", {
        detail: "a booked dispatch is not cancelled",
      });
    if (r.status.state === "queued") r.status.state = "cancelled";
    return this.handle(r);
  }

  private handle(r: FakeDispatchRecord): DispatchHandle {
    return {
      dispatchId: r.status.dispatchId,
      state: r.status.state,
      trackingId: r.status.trackingId,
      idempotencyKey: r.req.idempotencyKey,
    };
  }

  private must(dispatchId: string): FakeDispatchRecord {
    const r = this.records.get(dispatchId);
    if (!r)
      throw new PortError("IPB-PORT-005", "DISPATCH", { detail: `no dispatch ${dispatchId}` });
    return r;
  }
}
