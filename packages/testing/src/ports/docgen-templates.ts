// DOCGEN template contract cases (regulatory templates plan §8, item (c); owner answer 6,
// R1-D-301; R1-D-314): every DOCGEN adapter that fills a product's `.docx` templates passes them
// against a tagged template and hostile templates the caller builds (the platform's own leg uses a
// test copy of PD-A02, the Deposit Receipt, with merge fields added):
//   - it renders, with a tag split across Word runs, the values escaped, the template version and
//     the stored bytes' own SHA-256; an extra data key is ignored;
//   - a missing binding is refused `binding_missing`, naming each field; nothing is stored;
//   - a loop given a boolean, or a field given an object, is refused `data_invalid`;
//   - a raw-XML tag, an inverted section, a dotted name, an INCLUDETEXT field, an external image and
//     a macro part each make `validateTemplate` refuse, and a render refuse `template_unsafe`.
import { expect } from "vitest";
import type { DocFileRef, DocgenPort, StoragePort } from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";

/** What the hostile templates carry, one each. */
export const DOCGEN_HOSTILE_TEMPLATES = [
  "raw",
  "inverted",
  "dotted",
  "include",
  "external_image",
  "macro",
] as const;
export type DocgenHostileTemplate = (typeof DOCGEN_HOSTILE_TEMPLATES)[number];

export interface DocgenTemplateFixtures {
  storage: StoragePort;
  tenantId: string;
  /** The output prefix, under the tenant (`tenant/<id>/<module>`). */
  prefix: string;
  /**
   * A template registered with the adapter's store under `templateId` at `version`, holding
   * `{depositor}`, `{amount}` (its `{` and `}` in different Word runs) and the loop
   * `{#rows}{no}: {amt}{/rows}`.
   */
  tagged: { templateId: string; version: string; file: DocFileRef };
  /** Each hostile template, registered under `templateId` too. */
  hostile: Record<DocgenHostileTemplate, { templateId: string; file: DocFileRef }>;
  /** The text of a rendered `.docx` (its `word/document.xml` text runs, joined). */
  textOf(docx: Uint8Array): string;
}

const DATA = {
  depositor: 'Synthetic Depositor <w:p>&"x"',
  amount: "₹1,00,000",
  rows: [
    { no: 1, amt: "₹50,000" },
    { no: 2, amt: "₹50,000" },
  ],
};

export function docgenTemplateContractCases(
  fx: DocgenTemplateFixtures,
): Array<ContractCase<DocgenPort>> {
  const render = (p: DocgenPort, templateId: string, data: Record<string, unknown>) =>
    p.render({ templateId, data, format: "docx", outputPrefix: fx.prefix });
  const keys = async () => new Set((await fx.storage.list(fx.prefix)).keys);
  const nothingStored = async (before: Set<string>) =>
    expect([...(await keys())].filter((k) => !before.has(k))).toEqual([]);
  return [
    {
      name: "renders a tagged template: values escaped, a tag split across runs, the version and the stored bytes' SHA-256 (item (c))",
      async run(p) {
        const listed = (await p.listTemplates(fx.tenantId)).find(
          (t) => t.templateId === fx.tagged.templateId,
        );
        expect(listed?.version).toBe(fx.tagged.version);
        const v = await p.validateTemplate(fx.tagged.file);
        expect(v).toMatchObject({ valid: true, problems: [] });
        const r = await render(p, fx.tagged.templateId, { ...DATA, unused_extra_key: "ignored" });
        expect(r.templateVersion).toBe(fx.tagged.version);
        expect(r.format).toBe("docx");
        expect(r.file.storageKey.startsWith(`${fx.prefix}/`)).toBe(true);
        const stored = await fx.storage.get(r.file.storageKey);
        expect(sha256Hex(stored.body)).toBe(r.file.sha256);
        const text = fx.textOf(stored.body);
        // The value is text, never markup: the angle brackets and quotes read back as written.
        expect(text).toContain(DATA.depositor);
        expect(text).toContain(DATA.amount);
        expect(text).toContain("1: ₹50,000");
        expect(text).toContain("2: ₹50,000");
        expect(text).not.toMatch(/[{}]/);
        expect(text).not.toContain("ignored");
      },
    },
    {
      name: "a missing binding is refused binding_missing, naming each field, and nothing is stored (item (c))",
      async run(p) {
        const before = await keys();
        const { amount: _a, ...partial } = DATA;
        await expect(
          render(p, fx.tagged.templateId, { ...partial, rows: [{ no: 1 }] }),
        ).rejects.toMatchObject({
          meta: { reason: "binding_missing", fields: ["amount", "rows[].amt"] },
        });
        await nothingStored(before);
      },
    },
    {
      name: "a loop given a boolean, or a field given an object, is refused data_invalid (no conditions in templates)",
      async run(p) {
        await expect(
          render(p, fx.tagged.templateId, { ...DATA, rows: true }),
        ).rejects.toMatchObject({
          meta: { reason: "data_invalid" },
        });
        await expect(
          render(p, fx.tagged.templateId, { ...DATA, depositor: { name: "x" } }),
        ).rejects.toMatchObject({ meta: { reason: "data_invalid" } });
      },
    },
    {
      name: "a raw-XML tag, an inverted section, a dotted name, an INCLUDETEXT field, an external image and a macro part are each refused",
      async run(p) {
        for (const k of DOCGEN_HOSTILE_TEMPLATES) {
          const h = fx.hostile[k];
          const v = await p.validateTemplate(h.file);
          expect(v.valid, k).toBe(false);
          expect(v.problems.length, k).toBeGreaterThan(0);
          await expect(render(p, h.templateId, DATA), k).rejects.toMatchObject({
            meta: { reason: expect.stringMatching(/^template_(unsafe|invalid)$/) },
          });
        }
      },
    },
  ];
}
