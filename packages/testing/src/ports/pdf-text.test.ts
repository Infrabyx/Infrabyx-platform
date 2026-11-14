// The PDF fake's `extractText` against the PR-LDC-39 contract cases, and the fixture builder.
import { describe, expect, it } from "vitest";
import { defineContractSuite } from "../contract.js";
import { MemoryStorage } from "../fakes.js";
import { FakePdf } from "./documents-money.js";
import { pdfFixture, pdfTextContractCases } from "./pdf-text.js";

const storage = new MemoryStorage();
defineContractSuite("PDF", () => new FakePdf(storage), pdfTextContractCases(storage));

describe("pdfFixture", () => {
  it("writes a classic cross-reference table whose offsets point at their objects", () => {
    const s = Buffer.from(pdfFixture(["Hello (world)", null])).toString("latin1");
    expect(s.startsWith("%PDF-1.7\n")).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(s)?.[1]);
    expect(s.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(s.slice(o).startsWith(`${i + 1} 0 obj\n`)).toBe(true));
    expect(s).toContain("(Hello \\(world\\)) Tj");
  });

  it("the fake refuses extractText without a storage", async () => {
    const r = new FakePdf().extractText({
      file: { storageKey: "tenant/tnt_a/uploads/x.pdf", sha256: "0".repeat(64) },
      scan: { verdict: "CLEAN", file: { storageKey: "k", sha256: "0".repeat(64) } },
    });
    await expect(r).rejects.toMatchObject({ code: "IPB-PORT-001" });
  });
});
