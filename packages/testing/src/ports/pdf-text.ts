// `PdfPort.extractText` (IPB-01 PDF; IPB-02-44; LawDocsComply PR-LDC-39, R1-D-160): a fixture
// builder, the fake's reader and the contract cases every adapter offering `extractText` passes.
// These cases are not in the generic PDF list (`pdfContractCases`): the method is optional, so an
// adapter without it stays valid. An adapter suite adds them: `pdfTextContractCases(storage)`.
// `PdfPort.extractText` (IPB-01 PDF; IPB-02-44; LawDocsComply PR-LDC-39, R1-D-160): a fixture
// builder, the fake's reader and the contract cases every adapter offering `extractText` passes.
// These cases are not in the generic PDF list (`pdfContractCases`): the method is optional, so an
// adapter without it stays valid. An adapter suite adds them: `pdfTextContractCases(storage)`.
import { expect } from "vitest";
import type { DocFileRef, PdfPort, StoragePort } from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";
import { FakeFileScan } from "./file-scan.js";
import { pdfFixture } from "@infrabyx/fakes";
export { type PdfFixtureOptions, pdfFixture, fakeExtractText } from "@infrabyx/fakes";

const PREFIX = "tenant/tnt_contract/uploads";

/** Contract cases of `PdfPort.extractText`; `storage` is where the adapter under test reads files. */
export function pdfTextContractCases(storage: StoragePort): Array<ContractCase<PdfPort>> {
  const av = new FakeFileScan(storage);
  const put = async (body: Uint8Array): Promise<DocFileRef> => {
    const storageKey = `${PREFIX}/${ulid()}.pdf`;
    await storage.put(storageKey, body, {
      bucketClass: "QUARANTINE",
      contentType: "application/pdf",
    });
    return { storageKey, sha256: sha256Hex(body) };
  };
  const extract = (p: PdfPort, req: Parameters<NonNullable<PdfPort["extractText"]>>[0]) => {
    if (!p.extractText) throw new Error("the adapter does not offer extractText");
    return p.extractText(req);
  };
  const code = (e: Promise<unknown>) =>
    e.then(
      () => "resolved",
      (x: { code?: string }) => x.code ?? "no code",
    );
  return [
    {
      name: "extracts text per page and marks a page without a text layer needsOcr (PR-LDC-39)",
      method: "extractText",
      async run(p) {
        const file = await put(
          pdfFixture(["Board resolution\nPassed unanimously", null, "Annexure A"]),
        );
        const r = await extract(p, { file, scan: await av.scan(file) });
        expect(r.pageCount).toBe(3);
        expect(r.truncated ?? false).toBe(false);
        expect(r.pages.map((x) => x.index)).toEqual([1, 2, 3]);
        expect(r.pages[0]?.text).toBe("Board resolution\nPassed unanimously");
        expect(r.pages[0]?.needsOcr).toBe(false);
        expect(r.pages[1]).toEqual({ index: 2, text: "", needsOcr: true });
        expect(r.pages[2]?.text).toBe("Annexure A");
      },
    },
    {
      name: "reads only a CLEAN scan of exactly these bytes (IPB-SEC-011, IPB-SEC-015)",
      method: "extractText",
      async run(p) {
        const file = await put(pdfFixture(["Minutes"]));
        const clean = await av.scan(file);
        expect(clean.verdict).toBe("CLEAN");
        const infected = { ...clean, verdict: "INFECTED", threat: "Eicar-Test-Signature" };
        expect(await code(extract(p, { file, scan: infected }))).toBe("IPB-SEC-011");
        const error = { ...clean, verdict: "ERROR", reason: "disabled" };
        expect(await code(extract(p, { file, scan: error }))).toBe("IPB-SEC-015");
        const other = await put(pdfFixture(["Other minutes"]));
        expect(await code(extract(p, { file: other, scan: clean }))).toBe("IPB-SEC-015");
        // A reference whose bytes changed after the scan: the hash is the scan's, the bytes are not.
        const swapped = { storageKey: other.storageKey, sha256: file.sha256 };
        expect(await code(extract(p, { file: swapped, scan: clean }))).toBe("IPB-SEC-015");
        await expect(extract(p, { file } as never)).rejects.toThrow();
      },
    },
    {
      name: "refuses an encrypted file (IPB-SEC-010) and a file over a limit (IPB-SEC-013)",
      method: "extractText",
      async run(p) {
        const enc = await put(pdfFixture(["Sealed"], { encrypt: true }));
        expect(await code(extract(p, { file: enc, scan: await av.scan(enc) }))).toBe("IPB-SEC-010");
        const three = await put(pdfFixture(["a", "b", "c"]));
        const scan = await av.scan(three);
        expect(await code(extract(p, { file: three, scan, limits: { maxPages: 2 } }))).toBe(
          "IPB-SEC-013",
        );
        expect(await code(extract(p, { file: three, scan, limits: { maxFileBytes: 100 } }))).toBe(
          "IPB-SEC-013",
        );
        const cut = await extract(p, { file: three, scan, limits: { maxTextChars: 1 } });
        expect(cut.truncated).toBe(true);
        expect(cut.pageCount).toBe(3);
        expect(cut.pages.length).toBeLessThan(3);
      },
    },
  ];
}
