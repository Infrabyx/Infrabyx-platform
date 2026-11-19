// R1-D-217: the in-memory ES256 signer for tests and fakes verifies like a KMS-signed message.
import { describe, expect, it } from "vitest";
import {
  MemoryReplayStore,
  RegulatedKeyRing,
  localRegulatedSigner,
  signRegulatedMessage,
  verifyRegulatedMessage,
} from "./index.js";

const event = {
  specversion: "1.0",
  id: "e1",
  type: "in.infrabyx.origination.KFSIssued.v1",
  data: { kfs_id: "kfs_1" },
};

describe("localRegulatedSigner", () => {
  it("signs a message that verifies with its public key, and not with another", async () => {
    const s = localRegulatedSigner("lender-test-1");
    const jws = await signRegulatedMessage({ event, kid: s.kid, sign: s.sign });
    const ring = new RegulatedKeyRing([{ kid: s.kid, key: s.publicKey }]);
    expect(
      (await verifyRegulatedMessage(event, jws, { keys: ring, replay: new MemoryReplayStore() }))
        .ok,
    ).toBe(true);
    const other = localRegulatedSigner("lender-test-1");
    const otherRing = new RegulatedKeyRing([{ kid: other.kid, key: other.publicKey }]);
    expect(
      (
        await verifyRegulatedMessage(event, jws, {
          keys: otherRing,
          replay: new MemoryReplayStore(),
        })
      ).ok,
    ).toBe(false);
  });

  it("refuses an invalid kid", () => {
    expect(() => localRegulatedSigner("")).toThrow();
    expect(() => localRegulatedSigner("bad kid")).toThrow();
  });
});
