// The `pdf-text` adapter (PR-LDC-39, R1-D-160; threat model §3.129). Every fixture is built by hand
// here: classic and stream cross-references, FlateDecode, ToUnicode CMaps, and hostile files.
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import { FakeFileScan, MemoryStorage } from "@infrabyx/testing";
import type { DocFileRef, PdfTextLimits } from "@infrabyx/contracts/ports";
import { PdfTextExtractor } from "../text.js";

const storage = new MemoryStorage();
const av = new FakeFileScan(storage);
const adapter = new PdfTextExtractor({ storage });

// The generic PDF text contract cases run in `pdf.contract.test.ts` (the PDF contract leg).

// ---- fixture builders --------------------------------------------------------------------------

const enc = (s: string): Buffer => Buffer.from(s, "latin1");

/** `<< dict /Length n >> stream … endstream`, FlateDecode when `flate`. */
function stream(dict: string, data: string | Buffer, flate = false): Buffer {
  let body = typeof data === "string" ? enc(data) : data;
  let d = dict;
  if (flate) {
    body = deflateSync(body);
    d += " /Filter /FlateDecode";
  }
  return Buffer.concat([
    enc(`<< ${d} /Length ${body.length} >>\nstream\n`),
    body,
    enc("\nendstream"),
  ]);
}

/** Objects numbered from 1 (object 1 is the catalog), a classic xref table and a trailer. */
function classic(objects: Array<string | Buffer>, trailer = "", startxref?: number): Buffer {
  const parts: Buffer[] = [enc("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")];
  let at = parts[0]!.length;
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    const b = Buffer.concat([
      enc(`${i + 1} 0 obj\n`),
      typeof o === "string" ? enc(o) : o,
      enc("\nendobj\n"),
    ]);
    offsets.push(at);
    parts.push(b);
    at += b.length;
  });
  let x = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) x += `${String(o).padStart(10, "0")} 00000 n \n`;
  x += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailer} >>\nstartxref\n${startxref ?? at}\n%%EOF\n`;
  parts.push(enc(x));
  return Buffer.concat(parts);
}

const HELVETICA =
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

/** One page per content stream, one Helvetica font as /F1. */
function pagesDoc(contents: Array<string | Buffer>, extra: Array<string | Buffer> = []): Buffer {
  const n = contents.length;
  // 1 catalog, 2 pages, 3 font, then a page and its content per entry, then `extra`.
  const objs: Array<string | Buffer> = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${n} /Kids [${contents.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Resources << /Font << /F1 3 0 R >> >> >>`,
    HELVETICA,
  ];
  contents.forEach((c, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${5 + i * 2} 0 R >>`);
    objs.push(typeof c === "string" ? stream("", c, true) : c);
  });
  return classic([...objs, ...extra]);
}

async function upload(bytes: Uint8Array): Promise<DocFileRef> {
  const storageKey = `tenant/tnt_a/uploads/${ulid()}.pdf`;
  await storage.put(storageKey, bytes, {
    bucketClass: "QUARANTINE",
    contentType: "application/pdf",
  });
  return { storageKey, sha256: sha256Hex(bytes) };
}

/** Upload, scan with the AV fake, extract. */
async function extract(bytes: Uint8Array, limits?: PdfTextLimits) {
  const file = await upload(bytes);
  const scan = await av.scan(file);
  expect(scan.verdict).toBe("CLEAN");
  return adapter.extractText({ file, scan, ...(limits ? { limits } : {}) });
}

async function refusal(
  p: Promise<unknown>,
): Promise<{ code?: string; meta?: { reason?: string } }> {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; meta?: { reason?: string } };
  }
  throw new Error("expected a refusal");
}

/** A FlateDecode stream that inflates to `mib` MiB of zeros from a few KiB. */
const bomb = (mib: number, dict = "") => stream(dict, Buffer.alloc(mib * 1024 * 1024), true);

/** A FlateDecode stream of `mib` MiB that does not compress (a fixed pseudo-random sequence). */
function noise(mib: number): Buffer {
  const b = Buffer.alloc(mib * 1024 * 1024);
  let x = 0x2545f491;
  for (let i = 0; i < b.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    b[i] = x & 0xff;
  }
  return stream("", b, true);
}

// ---- text --------------------------------------------------------------------------------------

describe("pdf-text: text per page", () => {
  it("PR-LDC-39: extracts multi-page text, with TJ kerning, ' and \", and WinAnsi", async () => {
    const r = await extract(
      pagesDoc([
        "BT /F1 12 Tf 72 720 Td (Notice of meeting) Tj 0 -14 Td [(Ag) 30 (enda) -250 (item) -1000 (one)] TJ ET",
        "BT /F1 12 Tf 14 TL 72 720 Td (Resolved \\(1\\):) Tj (that the board) ' 0 0 (approves) \" ET\n" +
          "BT /F1 12 Tf 1 0 0 1 72 600 Tm (Fee \\200 5) Tj 1 0 0 1 200 600 Tm (net) Tj ET",
      ]),
    );
    expect(r.pageCount).toBe(2);
    expect(r.truncated).toBeUndefined();
    expect(r.pages).toEqual([
      { index: 1, text: "Notice of meeting\nAgenda item one", needsOcr: false },
      {
        index: 2,
        text: "Resolved (1):\nthat the board\napproves\nFee € 5 net",
        needsOcr: false,
      },
    ]);
  });

  it("PR-LDC-39: maps glyphs through a ToUnicode CMap (rupee and Devanagari, bfchar and bfrange)", async () => {
    const cmap =
      "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n" +
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" +
      "/CMapName /Adobe-Identity-UCS def /CMapType 2 def\n" +
      "1 begincodespacerange <0000> <FFFF> endcodespacerange\n" +
      "2 beginbfchar <0001> <20B9> <0002> <0915> endbfchar\n" +
      "2 beginbfrange <0003> <0005> <0041> <0006> <0007> [<0915094D0937> <0937>] endbfrange\n" +
      "endcmap CMapName currentdict /CMap defineresource pop end end";
    const objs: Array<string | Buffer> = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
      "<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      stream(
        "",
        "BT /F1 12 Tf 72 720 Td <0001> Tj [<0002> -300 <000300040005>] TJ 0 -14 Td <00060007> Tj ET",
        true,
      ),
      "<< /Type /Font /Subtype /Type0 /BaseFont /NotoSans /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>",
      "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NotoSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>",
      stream("", cmap, true),
    ];
    const r = await extract(classic(objs));
    expect(r.pages[0]?.text).toBe("₹क ABC\nक्षष");
    expect(r.pages[0]?.needsOcr).toBe(false);
  });

  it("PR-LDC-39: an image-only page, a page with another filter and an empty page are needsOcr", async () => {
    const image = stream(
      "/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode",
      Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    );
    const objs: Array<string | Buffer> = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Count 4 /Kids [4 0 R 5 0 R 6 0 R 7 0 R] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 10 0 R >> >> >>",
      HELVETICA,
      "<< /Type /Page /Parent 2 0 R /Contents 8 0 R >>",
      "<< /Type /Page /Parent 2 0 R /Contents 9 0 R >>",
      "<< /Type /Page /Parent 2 0 R /Contents 11 0 R >>",
      "<< /Type /Page /Parent 2 0 R >>",
      stream("", "BT /F1 12 Tf 72 720 Td (Scanned annexure follows) Tj ET", true),
      stream("", "q 200 0 0 200 72 500 cm /Im1 Do Q\nBI /W 1 /H 1 /CS /G /BPC 8 ID \x00 EI", true),
      image,
      stream("/Filter /LZWDecode", "\x80\x0b\x60\x50\x22\x0c\x0c\x85\x01"),
    ];
    const r = await extract(classic(objs));
    expect(r.pageCount).toBe(4);
    expect(r.pages.map((p) => p.needsOcr)).toEqual([false, true, true, true]);
    expect(r.pages[0]?.text).toBe("Scanned annexure follows");
    expect(r.pages.slice(1).map((p) => p.text)).toEqual(["", "", ""]);
  });

  it("PR-LDC-39: reads a cross-reference stream (PNG predictor) and an object stream", async () => {
    const parts: Buffer[] = [enc("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")];
    const at = () => parts.reduce((n, b) => n + b.length, 0);
    const content = stream(
      "",
      "BT /F1 11 Tf 72 720 Td (From an object stream) Tj T* 0 -13 Td (second line) Tj ET",
      true,
    );
    // Objects 1, 2, 3 and 5 live in object stream 6; 4 (content), 6 and 7 (the xref) are plain.
    const inner: Array<[number, string]> = [
      [1, "<< /Type /Catalog /Pages 2 0 R >>"],
      [2, "<< /Type /Pages /Count 1 /Kids [3 0 R] >>"],
      [3, "<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"],
      [5, HELVETICA],
    ];
    let body = "";
    const head: string[] = [];
    for (const [n, o] of inner) {
      head.push(`${n} ${body.length}`);
      body += `${o}\n`;
    }
    const header = `${head.join(" ")}\n`;
    const off4 = at();
    parts.push(Buffer.concat([enc("4 0 obj\n"), content, enc("\nendobj\n")]));
    const off6 = at();
    parts.push(
      Buffer.concat([
        enc("6 0 obj\n"),
        stream(`/Type /ObjStm /N ${inner.length} /First ${header.length}`, header + body, true),
        enc("\nendobj\n"),
      ]),
    );
    const off7 = at();
    // Rows of W [1 4 2]: type, offset or object stream, generation or index.
    const rows: number[][] = [
      [0, 0, 65535],
      [2, 6, 0],
      [2, 6, 1],
      [2, 6, 2],
      [1, off4, 0],
      [2, 6, 3],
      [1, off6, 0],
      [1, off7, 0],
    ];
    const raw = rows.map(([t, a, b]) => {
      const r = Buffer.alloc(7);
      r.writeUInt8(t!, 0);
      r.writeUInt32BE(a!, 1);
      r.writeUInt16BE(b!, 5);
      return r;
    });
    // PNG "Up" predictor: each row is the byte-wise difference from the row above, after a 2.
    const predicted = raw.map((r, i) => {
      const prev = raw[i - 1] ?? Buffer.alloc(7);
      return Buffer.concat([Buffer.of(2), Buffer.from(r.map((x, j) => (x - prev[j]!) & 0xff))]);
    });
    parts.push(
      Buffer.concat([
        enc("7 0 obj\n"),
        stream(
          "/Type /XRef /Size 8 /W [1 4 2] /Root 1 0 R /DecodeParms << /Predictor 12 /Columns 7 >>",
          Buffer.concat(predicted),
          true,
        ),
        enc("\nendobj\n"),
      ]),
    );
    // A decoy catalog after the xref stream: a reader that scanned for objects instead of
    // following the cross-reference stream would take it (later definitions win).
    parts.push(
      enc(
        "1 0 obj\n<< /Type /Catalog /Pages 9 0 R >>\nendobj\n9 0 obj\n<< /Type /Pages /Count 1 /Kids [10 0 R] >>\nendobj\n" +
          "10 0 obj\n<< /Type /Page /Parent 9 0 R /Contents 11 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
      ),
      enc("11 0 obj\n"),
      stream("", "BT /F1 12 Tf 72 720 Td (DECOY) Tj ET"),
      enc(`\nendobj\nstartxref\n${off7}\n%%EOF\n`),
    );
    const r = await extract(Buffer.concat(parts));
    expect(r.pageCount).toBe(1);
    expect(r.pages[0]?.text).toBe("From an object stream\nsecond line");
  });

  it("PR-LDC-39: marked content with /ActualText replaces its glyphs", async () => {
    const r = await extract(
      pagesDoc([
        "BT /F1 12 Tf 72 720 Td (Fee: ) Tj /Span << /ActualText <FEFF20B9> >> BDC (Rs.) Tj EMC ( 500) Tj ET",
      ]),
    );
    expect(r.pages[0]?.text).toBe("Fee: \u20b9 500");
  });

  it("PR-LDC-39: a file whose startxref is wrong is indexed by scanning for its objects", async () => {
    const good = pagesDoc(["BT /F1 12 Tf 72 720 Td (Recovered text) Tj ET"]);
    const s = good.toString("latin1").replace(/startxref\n\d+/, "startxref\n7");
    const r = await extract(enc(s));
    expect(r.pages[0]?.text).toBe("Recovered text");
  });

  it("PR-LDC-39: text past maxTextChars is truncated", async () => {
    const r = await extract(
      pagesDoc([
        "BT /F1 12 Tf 72 720 Td (abcdefghij) Tj ET",
        "BT /F1 12 Tf 72 720 Td (klmnopqrst) Tj ET",
        "BT /F1 12 Tf 72 720 Td (uvwxyz) Tj ET",
      ]),
      { maxTextChars: 15 },
    );
    expect(r.truncated).toBe(true);
    expect(r.pageCount).toBe(3);
    expect(r.pages.map((p) => p.text)).toEqual(["abcdefghij", "klmno"]);
  });
});

// ---- refusals ----------------------------------------------------------------------------------

describe("pdf-text: refusals", () => {
  const plain = () => pagesDoc(["BT /F1 12 Tf 72 720 Td (Board minutes) Tj ET"]);

  it("PR-LDC-39: refuses an unscanned, INFECTED or hash-mismatched input before reading it", async () => {
    const file = await upload(plain());
    const clean = await av.scan(file);
    // No scan at all: the request is outside the schema.
    await expect(adapter.extractText({ file } as never)).rejects.toThrow();
    // A scan that failed (or was never run: disabled) keeps the file quarantined.
    const failed = { ...clean, verdict: "ERROR" as const, reason: "disabled" as const };
    const unscanned = await refusal(adapter.extractText({ file, scan: failed }));
    expect(unscanned).toMatchObject({ code: "IPB-SEC-015", meta: { reason: "not_clean" } });
    const eicar = { ...clean, verdict: "INFECTED" as const, threat: "Eicar-Test-Signature" };
    const infected = await refusal(adapter.extractText({ file, scan: eicar }));
    expect(infected).toMatchObject({ code: "IPB-SEC-011", meta: { reason: "infected" } });
    // The scan is of other bytes.
    const other = await upload(pagesDoc(["BT /F1 12 Tf (Other) Tj ET"]));
    expect(await refusal(adapter.extractText({ file: other, scan: clean }))).toMatchObject({
      code: "IPB-SEC-015",
      meta: { reason: "hash_mismatch" },
    });
    // The bytes in storage are not the ones the scan and the reference name.
    expect(
      await refusal(adapter.extractText({ file: { ...other, sha256: file.sha256 }, scan: clean })),
    ).toMatchObject({ code: "IPB-SEC-015", meta: { reason: "hash_mismatch" } });
    // And a clean scan of these bytes passes.
    expect((await adapter.extractText({ file, scan: clean })).pages[0]?.text).toBe("Board minutes");
  });

  it("PR-LDC-39: refuses an encrypted file", async () => {
    const s = plain()
      .toString("latin1")
      .replace("/Root 1 0 R", "/Root 1 0 R /Encrypt << /Filter /Standard /V 2 /R 3 /P -4 >>");
    expect(await refusal(extract(enc(s)))).toMatchObject({
      code: "IPB-SEC-010",
      meta: { reason: "encrypted" },
    });
  });

  it("PR-LDC-39: refuses a decompression bomb (ratio, stream and total limits)", async () => {
    // 24 MiB of zeros from about 24 KiB: over the ratio limit (200) long before the stream limit.
    const ratio = await refusal(extract(pagesDoc([bomb(24)])));
    expect(ratio).toMatchObject({ code: "IPB-SEC-013", meta: { reason: "limit" } });
    expect(String(ratio)).toMatch(/ratio/);
    // With the ratio allowed, the per-stream limit stops it.
    const big = await refusal(
      extract(pagesDoc([bomb(24)]), { maxRatio: 1000, maxStreamBytes: 4 * 1024 * 1024 }),
    );
    expect(String(big)).toMatch(/inflates past/);
    // Two streams within the per-stream and ratio limits, over the total.
    const total = await refusal(
      extract(pagesDoc([noise(3), noise(3)]), { maxTotalInflateBytes: 5 * 1024 * 1024 }),
    );
    expect(String(total)).toMatch(/in all/);
  });

  it("PR-LDC-39: refuses too many pages, whatever /Count says", async () => {
    const three = ["a", "b", "c"].map((t) => `BT /F1 12 Tf 72 720 Td (${t}) Tj ET`);
    expect(await refusal(extract(pagesDoc(three), { maxPages: 2 }))).toMatchObject({
      code: "IPB-SEC-013",
    });
    const lying = pagesDoc(three).toString("latin1").replace("/Count 3", "/Count 1");
    expect(await refusal(extract(enc(lying), { maxPages: 2 }))).toMatchObject({
      code: "IPB-SEC-013",
    });
    expect((await extract(pagesDoc(three), { maxPages: 3 })).pageCount).toBe(3);
  });

  it("PR-LDC-39: refuses nesting deeper than maxDepth (arrays, the page tree, form XObjects)", async () => {
    const deep: Array<string | Buffer> = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
      `<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Deep ${"[".repeat(100)}${"]".repeat(100)} >>`,
      stream("", "BT (x) Tj ET"),
    ];
    const arrays = await refusal(extract(classic(deep)));
    expect(arrays).toMatchObject({ code: "IPB-SEC-013" });
    expect(String(arrays)).toMatch(/nesting/);

    // A page tree 40 levels deep.
    const tree: Array<string | Buffer> = ["<< /Type /Catalog /Pages 2 0 R >>"];
    for (let i = 0; i < 40; i++) tree.push(`<< /Type /Pages /Count 1 /Kids [${i + 3} 0 R] >>`);
    tree.push("<< /Type /Page /Contents 43 0 R /Resources << /Font << /F1 44 0 R >> >> >>");
    tree.push(stream("", "BT /F1 12 Tf (leaf) Tj ET"), HELVETICA);
    expect(String(await refusal(extract(classic(tree))))).toMatch(/page tree deeper/);
    expect((await extract(classic(tree), { maxDepth: 64 })).pages[0]?.text).toBe("leaf");

    // Form XObjects each drawing the next, 40 deep.
    const forms: Array<string | Buffer> = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
      "<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /XObject << /X 5 0 R >> >> >>",
      stream("", "/X Do"),
    ];
    for (let i = 0; i < 40; i++)
      forms.push(
        stream(
          `/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << /XObject << /X ${i + 6} 0 R >> >>`,
          "/X Do",
        ),
      );
    expect(String(await refusal(extract(classic(forms))))).toMatch(/form XObjects nested/);
  });

  it("PR-LDC-39: a parse past its deadline is terminated (huge content)", async () => {
    // About 12 MiB of positioning operators, stored: within every size limit, slow to interpret.
    const huge = stream("", "BT /F1 12 Tf " + "1 0 Td 0 1 Td ".repeat(900_000) + "ET");
    const started = Date.now();
    const r = await refusal(extract(pagesDoc([huge]), { timeoutMs: 25 }));
    expect(r).toMatchObject({ code: "IPB-SEC-013", meta: { reason: "timeout" } });
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 20_000);

  it("PR-LDC-39: refuses a file over maxFileBytes and anything that is not a PDF", async () => {
    expect(await refusal(extract(plain(), { maxFileBytes: 100 }))).toMatchObject({
      code: "IPB-SEC-013",
    });
    expect(await refusal(extract(enc("GIF89a not a pdf")))).toMatchObject({ code: "IPB-SEC-010" });
  });
});

// ---- storage failures --------------------------------------------------------------------------

/** MemoryStorage whose reads fail with `failure` once it is set (after the AV scan has read). */
class FailingStorage extends MemoryStorage {
  failure: Error | null = null;
  override async get(key: string) {
    if (this.failure) throw this.failure;
    return super.get(key);
  }
}

describe("pdf-text: storage failures (PR-UDF-067)", () => {
  const failing = new FailingStorage();
  const failingAv = new FakeFileScan(failing);
  const extractor = new PdfTextExtractor({ storage: failing });
  const plain = () => pagesDoc(["BT /F1 12 Tf 72 720 Td (Sanction letter) Tj ET"]);

  /** Upload and scan under `failing`, then make its reads fail with `failure`. */
  async function scannedThenFailing(bytes: Uint8Array, failure: Error | null) {
    failing.failure = null;
    const storageKey = `tenant/tnt_a/uploads/${ulid()}.pdf`;
    await failing.put(storageKey, bytes, { bucketClass: "QUARANTINE" });
    const file = { storageKey, sha256: sha256Hex(bytes) };
    const scan = await failingAv.scan(file);
    expect(scan.verdict).toBe("CLEAN");
    failing.failure = failure;
    return { file, scan };
  }

  /** As the `s3` adapter reports a named tenant key that is disabled or no longer granted. */
  const keyGone = (reason = "storage_key_unavailable") =>
    new PortError("IPB-KMS-001", "STORAGE", {
      adapter: "s3",
      detail: "the object's named key is disabled, deleted or no longer granted",
      meta: { reason, keyRef: "lender:a", name: "KMS.DisabledException" },
      cause: new Error("arn:aws:kms:ap-south-1:111122223333:key/0000 is disabled"),
    });

  it("a STORAGE read refused for a disabled or revoked named key is IPB-KMS-001 storage_key_unavailable, not IPB-PORT-002", async () => {
    const req = await scannedThenFailing(plain(), keyGone());
    const e = (await refusal(extractor.extractText(req))) as PortError;
    expect(e).toBeInstanceOf(PortError);
    expect(e).toMatchObject({
      code: "IPB-KMS-001",
      port: "PDF",
      adapter: "pdf-text",
      meta: { reason: "storage_key_unavailable" },
    });
    // Only the fixed label: no key reference, vendor error name, key id or cause.
    expect(e.meta).toEqual({ reason: "storage_key_unavailable" });
    expect(e.cause).toBeUndefined();
    expect(`${e.message} ${e.detail ?? ""}`).not.toMatch(/arn:|lender:a|KMS\./);
  });

  it("a read STORAGE refuses for integrity is IPB-STOR-005 hash_mismatch, not IPB-PORT-002 (PR-UDF-080)", async () => {
    const tampered = new PortError("IPB-STOR-005", "STORAGE", {
      adapter: "s3",
      detail: "object body does not match its stored SHA-256",
      meta: { reason: "hash_mismatch", key: "tenant/tnt_a/uploads/x.pdf" },
      cause: new Error('Checksum mismatch: expected "abc" but received "def"'),
    });
    const req = await scannedThenFailing(plain(), tampered);
    const e = (await refusal(extractor.extractText(req))) as PortError;
    expect(e).toMatchObject({ code: "IPB-STOR-005", port: "PDF", adapter: "pdf-text" });
    expect(e.httpStatus).toBe(500);
    // Only the fixed label: no key, checksum or cause.
    expect(e.meta).toEqual({ reason: "hash_mismatch" });
    expect(e.cause).toBeUndefined();
    expect(`${e.message} ${e.detail ?? ""}`).not.toMatch(/tenant\/|abc|def/);
  });

  it("any other STORAGE failure, including another IPB-KMS-001 reason, stays IPB-PORT-002 unavailable", async () => {
    for (const failure of [
      new Error("connection reset"),
      new PortError("IPB-STOR-001", "STORAGE", { detail: "no such object" }),
      keyGone("integrity"),
    ]) {
      const req = await scannedThenFailing(plain(), failure);
      expect(await refusal(extractor.extractText(req))).toMatchObject({
        code: "IPB-PORT-002",
        meta: { reason: "unavailable" },
      });
    }
  });

  it("a readable but corrupt or encrypted PDF keeps its own refusal (IPB-SEC-010)", async () => {
    const corrupt = await scannedThenFailing(enc("%PDF-1.7 not really a pdf"), null);
    expect(await refusal(extractor.extractText(corrupt))).toMatchObject({ code: "IPB-SEC-010" });
    const encrypted = plain()
      .toString("latin1")
      .replace("/Root 1 0 R", "/Root 1 0 R /Encrypt << /Filter /Standard /V 2 /R 3 /P -4 >>");
    const locked = await scannedThenFailing(enc(encrypted), null);
    expect(await refusal(extractor.extractText(locked))).toMatchObject({
      code: "IPB-SEC-010",
      meta: { reason: "encrypted" },
    });
    // And once the reads work, the same extractor reads the file.
    const ok = await scannedThenFailing(plain(), null);
    expect((await extractor.extractText(ok)).pages[0]?.text).toBe("Sanction letter");
  });
});

// ---- active content ----------------------------------------------------------------------------

describe("pdf-text: active content", () => {
  it("PR-LDC-39: a JavaScript action, a Launch action and an embedded file are ignored, never read", async () => {
    // The JavaScript and the embedded file are decompression bombs: reading either would refuse.
    const objs: Array<string | Buffer> = [
      "<< /Type /Catalog /Pages 2 0 R /OpenAction 6 0 R /Names << /JavaScript 7 0 R /EmbeddedFiles 8 0 R >> /AA << /WC 6 0 R >> >>",
      "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
      "<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> /AA << /O << /S /Launch /F (calc.exe) >> >> /Annots [<< /Subtype /Link /A 6 0 R >>] >>",
      stream("", "BT /F1 12 Tf 72 720 Td (Text beside a script) Tj ET", true),
      HELVETICA,
      "<< /S /JavaScript /JS 9 0 R >>",
      "<< /Names [(init) 6 0 R] >>",
      "<< /Names [(payload.exe) << /Type /Filespec /EF << /F 10 0 R >> >>] >>",
      bomb(24),
      bomb(24, "/Type /EmbeddedFile"),
    ];
    const r = await extract(classic(objs));
    expect(r.pages).toEqual([{ index: 1, text: "Text beside a script", needsOcr: false }]);
  });
});

describe("pdf-text: the other PdfPort methods", () => {
  it("are declared unsupported and refused with IPB-PORT-001", async () => {
    expect(adapter.descriptor.capabilities?.merge).toBe("unsupported");
    await expect(adapter.pageCount()).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "unsupported" },
    });
    expect((await adapter.health()).status).toBe("up");
  });
});
