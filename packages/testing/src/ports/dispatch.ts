// DISPATCH fake and contract cases (Finbyx PR-FBX-41; ADR-0008; R1-D-104). The fake sends nothing:
// a test scripts how each PIN code's dispatch goes (`deliver`, `return`, `fail`) and moves it on
// with `advance`. Proofs go to an in-memory STORAGE map under the request's evidence prefix. The
// cases hold every adapter to the port's rules: people send (never agents), one dispatch per key,
// the document's hash kept, and no proof before it exists.
// DISPATCH fake and contract cases (Finbyx PR-FBX-41; ADR-0008; R1-D-104). The fake sends nothing:
// a test scripts how each PIN code's dispatch goes (`deliver`, `return`, `fail`) and moves it on
// with `advance`. Proofs go to an in-memory STORAGE map under the request's evidence prefix. The
// cases hold every adapter to the port's rules: people send (never agents), one dispatch per key,
// the document's hash kept, and no proof before it exists.
import { expect } from "vitest";
import { DispatchRequest, type DispatchPort } from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";
import { type ScriptedDispatch } from "@infrabyx/fakes";
export { type ScriptedDispatch, FakeDispatch } from "@infrabyx/fakes";

/** Scripts outcomes on the adapter under test (the fake's own controls, or a sandbox's). */
export interface DispatchScript {
  script(pincode: string, outcome: ScriptedDispatch): void;
  advance(dispatchId: string): void;
}

const DOC_SHA = "a".repeat(64);
let n = 0;
const request = (pincode: string): DispatchRequest => ({
  initiatedBy: { type: "user", id: "usr_recovery" },
  channel: "india_post_speed_post",
  document: { storageKey: "tenant/tnt_a/notices/01J9ZC9Q2K7M8N3P4R5S6T7V8W.pdf", sha256: DOC_SHA },
  addressee: {
    name: "A Borrower",
    lines: ["12 Example Road"],
    city: "Pune",
    state: "Maharashtra",
    pincode,
  },
  purpose: "recovery.notice.demand",
  subjectRef: "loan_0001",
  evidencePrefix: "tenant/tnt_a/dispatch",
  idempotencyKey: `dispatch-key-${Date.now()}-${++n}`,
});
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? "error",
  );

export function dispatchContractCases(s: DispatchScript): ContractCase<DispatchPort>[] {
  return [
    {
      name: "a delivered dispatch keeps its booking receipt and proof of delivery, bound to the document's hash",
      async run(p) {
        s.script("411001", "deliver");
        const h = await p.dispatch(request("411001"));
        expect(h).toMatchObject({ state: "queued", trackingId: null });
        expect(await code(p.storeProof(h.dispatchId, "booking_receipt"))).toBe("IPB-PORT-003");
        s.advance(h.dispatchId);
        const receipt = await p.storeProof(h.dispatchId, "booking_receipt");
        expect(receipt.trackingId).not.toBeNull();
        expect(await code(p.storeProof(h.dispatchId, "proof_of_delivery"))).toBe("IPB-PORT-003");
        s.advance(h.dispatchId);
        s.advance(h.dispatchId);
        const st = await p.status(h.dispatchId);
        expect(st).toMatchObject({ state: "delivered", documentSha256: DOC_SHA });
        expect(st.events.length).toBeGreaterThanOrEqual(2);
        const pod = await p.storeProof(h.dispatchId, "proof_of_delivery");
        expect(pod.file.storageKey.startsWith("tenant/tnt_a/dispatch/")).toBe(true);
        expect(pod).toMatchObject({ documentSha256: DOC_SHA, trackingId: receipt.trackingId });
        expect(await p.storeProof(h.dispatchId, "proof_of_delivery")).toEqual(pod);
        expect(await code(p.storeProof(h.dispatchId, "proof_of_return"))).toBe("IPB-PORT-003");
      },
    },
    {
      name: "a returned dispatch is final with its reason and proof of return; a failed one has no proof",
      async run(p) {
        s.script("411002", "return");
        const h = await p.dispatch(request("411002"));
        for (let i = 0; i < 3; i++) s.advance(h.dispatchId);
        const st = await p.status(h.dispatchId);
        expect(st.state).toBe("returned");
        expect(st.returnReason).not.toBeNull();
        expect((await p.storeProof(h.dispatchId, "proof_of_return")).kind).toBe("proof_of_return");
        expect(await code(p.storeProof(h.dispatchId, "proof_of_delivery"))).toBe("IPB-PORT-003");
        s.script("411003", "fail");
        const f = await p.dispatch(request("411003"));
        s.advance(f.dispatchId);
        expect((await p.status(f.dispatchId)).state).toBe("failed");
        expect(await code(p.storeProof(f.dispatchId, "booking_receipt"))).toBe("IPB-PORT-003");
      },
    },
    {
      name: "only an unbooked dispatch is cancelled",
      async run(p) {
        const a = await p.dispatch(request("411004"));
        expect((await p.cancel(a.dispatchId)).state).toBe("cancelled");
        const b = await p.dispatch(request("411005"));
        s.advance(b.dispatchId);
        expect(await code(p.cancel(b.dispatchId))).toBe("IPB-PORT-003");
      },
    },
    {
      name: "one dispatch per idempotency key: the same request is the same dispatch, another is refused",
      async run(p) {
        const req = request("411006");
        const a = await p.dispatch(req);
        expect(await p.dispatch(req)).toEqual(a);
        expect(await code(p.dispatch({ ...req, purpose: "recovery.notice.other" }))).toBe(
          "IPB-PORT-004",
        );
      },
    },
    {
      name: "an agent never sends, and a malformed request is refused before anything is sent",
      async run(p) {
        const agent = {
          ...request("411007"),
          initiatedBy: { type: "agent", id: "agt_vidhi" },
        } as unknown as DispatchRequest;
        expect(await code(p.dispatch(agent))).not.toBeNull();
        await expect(
          p.dispatch({
            ...request("411007"),
            addressee: { ...request("411007").addressee, pincode: "41100" },
          }),
        ).rejects.toThrow();
        await expect(
          p.dispatch({ ...request("411007"), evidencePrefix: "tenant/tnt_bcl_x/dispatch" }),
        ).rejects.toThrow();
      },
    },
  ];
}
