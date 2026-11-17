// MemoryStorage keeps an object's compartment and refuses a move (PR-LDC-60, R1-D-158).
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./fakes.js";

const K = "tenant/tnt_a/board/01JAZ0000000000000000000AA.pdf";
const enc = (s: string) => new TextEncoder().encode(s);

describe("MemoryStorage compartments (PR-LDC-60)", () => {
  it("keeps the compartment, and refuses a move or a compartment outside its classes", async () => {
    const s = new MemoryStorage();
    await s.put(K, enc("a"), { bucketClass: "CONFIDENTIAL", compartment: "BOARD_CONFIDENTIAL" });
    expect((await s.get(K)).meta.compartment).toBe("BOARD_CONFIDENTIAL");
    await expect(s.put(K, enc("b"), { bucketClass: "CONFIDENTIAL" })).rejects.toMatchObject({
      code: "IPB-PORT-003",
    });
    await expect(
      s.put(K, enc("b"), { bucketClass: "CONFIDENTIAL", compartment: "SEALED" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-003" });
    await expect(
      s.put(K.replace("AA", "AB"), enc("c"), { bucketClass: "GENERAL", compartment: "SEALED" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-003" });
    await s.put(K, enc("c"), { bucketClass: "CONFIDENTIAL", compartment: "BOARD_CONFIDENTIAL" });
    expect(new TextDecoder().decode((await s.get(K)).body)).toBe("c");
  });
});
