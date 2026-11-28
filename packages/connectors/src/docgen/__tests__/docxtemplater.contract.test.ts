// DOCGEN `docxtemplater` (regulatory templates plan §8, item (c); R1-D-314): the template contract
// cases on a test copy of PD-A02 (the Deposit Receipt, read at its filed SHA-256) with merge fields
// added, and hostile copies of it. In-process, so a unit leg; the PDF and PDF/A route through
// Gotenberg runs in the hermetic leg (docgen.contract.test.ts).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import {
  DOCGEN_HOSTILE_TEMPLATES,
  MemoryStorage,
  defineContractSuite,
  docgenTemplateContractCases,
  type DocgenHostileTemplate,
} from "@infrabyx/testing";
import type { DocFileRef } from "@infrabyx/contracts/ports";
import {
  DocxtemplaterDocgen,
  templateSafetyProblems,
  type DocgenTemplate,
} from "../docxtemplater.js";

const require = createRequire(import.meta.url);
const PizZip = require("pizzip") as new (d?: Uint8Array) => {
  file(name: string): { asText(): string } | null;
  file(name: string, data: string | Uint8Array): unknown;
  generate(o: { type: "nodebuffer" }): Buffer;
  files: Record<string, unknown>;
};

const TEMPLATES = fileURLToPath(
  new URL("../../../../../docs/regulatory-templates/", import.meta.url),
);
const PD_A02 =
  "Templates/NBFC Policies/Acceptance of Public Deposits/Annexures/PD-A02 Deposit Receipt.docx";
function filed(rel: string): Buffer {
  const bytes = readFileSync(`${TEMPLATES}${rel}`);
  const line = readFileSync(`${TEMPLATES}SHA256SUMS`, "utf8")
    .split("\n")
    .find((l) => l.endsWith(`  ./${rel}`));
  expect(line?.slice(0, 64), rel).toBe(sha256Hex(new Uint8Array(bytes)));
  return bytes;
}

const p = (runs: string) => `<w:p>${runs}</w:p>`;
const r = (t: string, bold = false) =>
  `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${t}</w:t></w:r>`;
// The merge fields added to the filed receipt: `{amount}`'s braces in two runs, as Word splits them.
const TAGGED =
  p(r("Depositor: {depositor}")) +
  p(r("Amount: {amo") + r("unt}", true)) +
  p(r("{#rows}")) +
  p(r("{no}: {amt}")) +
  p(r("{/rows}"));

/** A copy of the filed receipt with `extra` paragraphs before its section properties. */
function copy(extra: string, edit?: (z: InstanceType<typeof PizZip>) => void): Buffer {
  const z = new PizZip(new Uint8Array(filed(PD_A02)));
  const xml = z.file("word/document.xml")!.asText();
  const at = xml.lastIndexOf("<w:sectPr");
  z.file("word/document.xml", xml.slice(0, at) + extra + xml.slice(at));
  edit?.(z);
  return z.generate({ type: "nodebuffer" });
}
const HOSTILE: Record<DocgenHostileTemplate, Buffer> = {
  raw: copy(TAGGED + p(r("{@raw}"))),
  inverted: copy(TAGGED + p(r("{^flag}shown when false{/flag}"))),
  dotted: copy(TAGGED + p(r("{customer.name}"))),
  include: copy(
    TAGGED +
      p(
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
          '<w:r><w:instrText xml:space="preserve"> INCLUDETEXT "C:\\\\x.docx" </w:instrText></w:r>' +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
      ),
  ),
  external_image: copy(TAGGED, (z) => {
    const rels = z.file("word/_rels/document.xml.rels")!.asText();
    z.file(
      "word/_rels/document.xml.rels",
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdX1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/i.png" TargetMode="External"/></Relationships>',
      ),
    );
  }),
  macro: copy(TAGGED, (z) =>
    z.file("word/vbaProject.bin", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])),
  ),
};

const TENANT = "tnt_docgen";
const PREFIX = `tenant/${TENANT}/deposits`;
const storage = new MemoryStorage();
const store = new Map<string, DocgenTemplate>();
async function register(templateId: string, bytes: Buffer, version = "1.0.0"): Promise<DocFileRef> {
  const storageKey = `tenant/${TENANT}/templates/${ulid()}.docx`;
  const sha256 = sha256Hex(bytes);
  await storage.put(storageKey, bytes, {
    bucketClass: "GENERAL",
    contentType: "application/octet-stream",
    sha256,
  });
  const file = { storageKey, sha256 };
  store.set(templateId, { templateId, version, file });
  return file;
}
const tagged = {
  templateId: "pd_a02",
  version: "2026.11.1",
  file: await register("pd_a02", copy(TAGGED), "2026.11.1"),
};
const hostile = {} as Record<DocgenHostileTemplate, { templateId: string; file: DocFileRef }>;
for (const k of DOCGEN_HOSTILE_TEMPLATES)
  hostile[k] = { templateId: `hostile_${k}`, file: await register(`hostile_${k}`, HOSTILE[k]) };

const make = () =>
  new DocxtemplaterDocgen({
    storage,
    templates: {
      list: async () => [...store.values()],
      get: async (_t, id) => store.get(id),
    },
  });

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
const textOf = (docx: Uint8Array) => {
  const xml = new PizZip(docx).file("word/document.xml")!.asText();
  return [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map((m) =>
      unescape([...m[1]!.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("")),
    )
    .join("\n");
};

describe("@IPB-01-15 DOCGEN docxtemplater (PD-A02 test copy; item (c))", () => {
  defineContractSuite(
    "DOCGEN",
    make,
    docgenTemplateContractCases({
      storage,
      tenantId: TENANT,
      prefix: PREFIX,
      tagged,
      hostile,
      textOf,
    }),
    { leg: "unit" },
  );

  it("the filed receipt itself is safe and has no tags", async () => {
    const z = new PizZip(new Uint8Array(filed(PD_A02)));
    expect(templateSafetyProblems(z as never)).toEqual([]);
  });

  it("names each problem of a hostile template, never a data value", async () => {
    const v = await make().validateTemplate(hostile.include.file);
    expect(v.problems.join(" ")).toMatch(/INCLUDETEXT/);
    const m = await make().validateTemplate(hostile.macro.file);
    expect(m.problems.join(" ")).toMatch(/macro/);
    const e = await make().validateTemplate(hostile.external_image.file);
    expect(e.problems.join(" ")).toMatch(/external image/);
  });

  it("refuses a template whose bytes changed after it was referenced", async () => {
    const changed = { ...tagged.file, sha256: sha256Hex("other bytes") };
    await expect(make().validateTemplate(changed)).resolves.toMatchObject({ valid: false });
    store.set("changed", { templateId: "changed", version: "1", file: changed });
    await expect(
      make().render({ templateId: "changed", data: {}, format: "docx", outputPrefix: PREFIX }),
    ).rejects.toMatchObject({ meta: { reason: "template_changed" } });
  });

  it("renders pdf only through a converter, never html, and does not preview", async () => {
    const req = { templateId: "pd_a02", data: {}, outputPrefix: PREFIX };
    await expect(make().render({ ...req, format: "pdf" })).rejects.toMatchObject({
      meta: { reason: "unsupported" },
    });
    await expect(make().render({ ...req, format: "html" })).rejects.toMatchObject({
      meta: { reason: "unsupported" },
    });
    await expect(make().previewHtml()).rejects.toMatchObject({ meta: { reason: "unsupported" } });
    const withPdf = new DocxtemplaterDocgen({
      storage,
      templates: { list: async () => [...store.values()], get: async (_t, id) => store.get(id) },
      converter: {
        convertDocx: async () =>
          new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj<</Type/Pages/Count 1>>endobj\n%%EOF")),
      },
    });
    const r = await withPdf.render({
      templateId: "pd_a02",
      data: { depositor: "D", amount: "1", rows: [] },
      format: "pdfa",
      outputPrefix: PREFIX,
    });
    expect(r).toMatchObject({ format: "pdfa", pageCount: 1, templateVersion: "2026.11.1" });
    expect((await storage.get(r.file.storageKey)).meta.contentType).toBe("application/pdf");
  });

  it("a tag cannot reach a prototype: {constructor} is a missing binding", async () => {
    store.set("proto", {
      templateId: "proto",
      version: "1",
      file: await register("proto", copy(p(r("{constructor}")))),
    });
    await expect(
      make().render({ templateId: "proto", data: {}, format: "docx", outputPrefix: PREFIX }),
    ).rejects.toMatchObject({ meta: { reason: "binding_missing", fields: ["constructor"] } });
  });
});
