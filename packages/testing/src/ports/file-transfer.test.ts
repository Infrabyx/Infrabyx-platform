// PR-UDF-071 (R1-D-254): the FILE_TRANSFER contract runs against the fake, as every adapter's does;
// then what only the fake promises (off, its stored files, a seeded counterparty file).
import { describe, expect, it } from "vitest";
import { defineContractSuite } from "../contract.js";
import {
  FakeFileTransfer,
  expectFileTransferRefusal,
  fileTransferContractCases,
  fileTransferFakeFixtures,
} from "./file-transfer.js";

const fake = new FakeFileTransfer();
defineContractSuite(
  "FILE_TRANSFER",
  () => fake,
  fileTransferContractCases(fileTransferFakeFixtures),
);

describe("the FILE_TRANSFER fake", () => {
  it("is off when its switch is, and serves a seeded file without letting it be overwritten", async () => {
    let on = false;
    const p = new FakeFileTransfer({ enabled: () => on });
    await expectFileTransferRefusal(() => p.list("."), "IPB-PORT-001", "adapter_disabled");
    expect((await p.health()).status).toBe("down");
    on = true;
    p.seed("outbox/ack_1.csv", new Uint8Array([65]));
    expect((await p.get("outbox/ack_1.csv")).bytes).toEqual(new Uint8Array([65]));
    await expectFileTransferRefusal(
      () => p.put("outbox/ack_1.csv", new Uint8Array([66]), { ifAbsent: true }),
      "IPB-STOR-003",
      "exists",
    );
    expect(p.stored.get("outbox/ack_1.csv")).toEqual(new Uint8Array([65]));
    expect((await p.list(".")).entries).toEqual([
      expect.objectContaining({ name: "outbox", type: "directory" }),
    ]);
  });
});
