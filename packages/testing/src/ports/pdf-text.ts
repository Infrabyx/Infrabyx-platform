// `PdfPort.extractText` (IPB-01 PDF; IPB-02-44; LawDocsComply PR-LDC-39, R1-D-160): a fixture
// builder, the fake's reader and the contract cases every adapter offering `extractText` passes.
// These cases are not in the generic PDF list (`pdfContractCases`): the method is optional, so an
// adapter without it stays valid. An adapter suite adds them: `pdfTextContractCases(storage)`.
import { expect } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import {
  PdfTextRequest,
  assertScannedClean,
  resolvePdfTextLimits,
  type DocFileRef,
  type PdfPort,
  type PdfTextResult,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";
import { FakeFileScan } from "./file-scan.js";

export interface PdfFixtureOptions {
  /** Adds an `/Encrypt` dictionary to the trailer (the file is not really encrypted). */
  encrypt?: boolean;
}

const pdfString = (s: string): string =>
  `(${s.replace(/[^\x20-\x7e\xa0-\xff]/g, "?").replace(/([\\()])/g, "\\$1")})`;

/**
 * A small, valid, uncompressed PDF: one page per entry, each line of a string shown with Tj in
 * Helvetica (WinAnsi; characters outside it become `?`), and `null` an image-only page.
 */
export function pdfFixture(pages: Array<string | null>, opts: PdfFixtureOptions = {}): Uint8Array {
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  const catalog = add("");
  const tree = add("");
  const font = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const image = add(
    "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\x80\nendstream",
  );
  const kids: number[] = [];
  for (const p of pages) {
    const content =
      p === null
        ? "q 100 0 0 100 72 600 cm /Im1 Do Q"
        : `BT /F1 12 Tf 72 720 Td 14 TL ${p
            .split("\n")
            .map((l, i) => `${i ? "T* " : ""}${pdfString(l)} Tj`)
            .join(" ")} ET`;
    const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 595 842] /Contents ${c} 0 R ` +
          `/Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${image} 0 R >> >> >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] =
    `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] >>`;
  let encrypt = "";
  if (opts.encrypt)
    encrypt = ` /Encrypt ${add("<< /Filter /Standard /V 2 /R 3 /Length 128 /P -4 /O <00> /U <00> >>")} 0 R`;
  let out = "%PDF-1.7\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${encrypt} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(out, "latin1"));
}

const refuse = (code: "IPB-SEC-010" | "IPB-SEC-013", reason: string, detail: string) =>
  new PortError(code, "PDF", { adapter: "fake-pdf", detail, meta: { reason } });

/**
 * The fake's `extractText`: the same AV precondition, hash check and limits as an adapter, over
 * files like `pdfFixture`'s (uncompressed, one content stream per page, Tj strings). A compressed
 * content stream leaves its page `needsOcr`.
 */
export async function fakeExtractText(
  storage: StoragePort | undefined,
  raw: unknown,
): Promise<PdfTextResult> {
  const req = PdfTextRequest.parse(raw);
  assertScannedClean(req.scan, req.file.sha256, "PDF", "fake-pdf");
  if (!storage)
    throw new PortError("IPB-PORT-001", "PDF", {
      adapter: "fake-pdf",
      detail: "FakePdf was built without a storage",
    });
  const l = resolvePdfTextLimits(req.limits);
  const body = (await storage.get(req.file.storageKey)).body;
  if (body.length > l.maxFileBytes) throw refuse("IPB-SEC-013", "limit", "the file is too large");
  if (sha256Hex(body) !== req.file.sha256)
    throw new PortError("IPB-SEC-015", "PDF", {
      adapter: "fake-pdf",
      detail: "the bytes are not the ones scanned",
      meta: { reason: "hash_mismatch" },
    });
  const s = Buffer.from(body).toString("latin1");
  if (!s.startsWith("%PDF-")) throw refuse("IPB-SEC-010", "malformed", "no PDF header");
  if (/trailer\s*<<[^]*?\/Encrypt\b/.test(s)) throw refuse("IPB-SEC-010", "encrypted", "encrypted");
  const objs = new Map<number, string>();
  for (const m of s.matchAll(/(\d+) 0 obj\n([^]*?)\nendobj/g)) objs.set(Number(m[1]), m[2]!);
  const pages = [...objs.values()].filter((o) => /\/Type \/Page\b/.test(o));
  if (pages.length > l.maxPages) throw refuse("IPB-SEC-013", "limit", "too many pages");
  let left = l.maxTextChars;
  const out: PdfTextResult["pages"] = [];
  let truncated = false;
  for (const [i, page] of pages.entries()) {
    const c = objs.get(Number(/\/Contents (\d+) 0 R/.exec(page)?.[1])) ?? "";
    const compressed = /\/Filter/.test(c.split("stream")[0] ?? "");
    const lines = compressed
      ? []
      : [...c.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1]!.replace(/\\(.)/g, "$1"));
    let text = lines.join("\n");
    if (text.length > left) {
      text = text.slice(0, left);
      truncated = true;
    }
    left -= text.length;
    out.push({ index: i + 1, text, needsOcr: compressed || !/\S/.test(text) });
    if (truncated) break;
  }
  return { pages: out, pageCount: pages.length, ...(truncated ? { truncated: true } : {}) };
}

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
