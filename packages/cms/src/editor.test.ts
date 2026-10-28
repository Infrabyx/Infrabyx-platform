// The block editor's CMS side (PR-038; R1-D-02): every block type of the library has a form whose
// fields are properties of its schema, every template is a valid block once its reference is
// filled, and the rich text codec round-trips the portable text an editor can write.
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  BLOCK_EDITOR,
  BLOCK_EDITOR_SPECS,
  BLOCK_SCHEMAS,
  htmlToPortableText,
  parseBlocks,
  portableTextToText,
  textToPortableText,
  type PortableText,
} from "./index.js";

const MED = "med_01JC0000000000000000000000";
const REFS: Record<string, string> = {
  media: MED,
  logo_wall: MED,
  testimonial: "tst_1",
  form: "frm_1",
  pricing_table: "plan_basic",
};

describe("BLOCK_EDITOR_SPECS", () => {
  it("has a form for every block type of the library, and nothing else", () => {
    expect(BLOCK_EDITOR_SPECS.map((s) => s.type).sort()).toEqual(Object.keys(BLOCK_SCHEMAS).sort());
    expect(BLOCK_EDITOR.specs).toBe(BLOCK_EDITOR_SPECS);
  });

  it("names only properties of each type's schema", () => {
    for (const spec of BLOCK_EDITOR_SPECS) {
      const shape = (BLOCK_SCHEMAS[spec.type as keyof typeof BLOCK_SCHEMAS] as z.ZodObject).shape;
      for (const f of spec.fields)
        expect(Object.keys(shape), `${spec.type}.${f.name}`).toContain(f.name);
    }
  });

  it("starts every new block valid once its reference is filled", () => {
    for (const spec of BLOCK_EDITOR_SPECS) {
      const block: Record<string, unknown> = structuredClone({ type: spec.type, ...spec.template });
      if (spec.ref) {
        expect(REFS[spec.type], spec.type).toBeDefined();
        const path = spec.ref.name.split(".");
        let t = block;
        for (const k of path.slice(0, -1)) t = t[k] as Record<string, unknown>;
        t[path.at(-1)!] = spec.ref.list ? [REFS[spec.type]] : REFS[spec.type];
      }
      const r = parseBlocks([block], { mermaid: true });
      expect(r.issues, spec.type).toEqual([]);
    }
  });
});

describe("the rich text codec", () => {
  it("reads the text conventions into portable text", () => {
    const pt = textToPortableText(
      [
        "## Why it matters",
        "",
        "Plain, **bold**, *italic*, `code` and a [link](/contact).",
        "Same paragraph.",
        "",
        "- one",
        "- two with **bold**",
        "  - nested",
        "1. first",
        "",
        "> A quotation",
        "",
        `![image](${MED})`,
        "",
        "Not a heading: \\## and \\*stars\\*; [bad](javascript:alert)",
      ].join("\n"),
    );
    expect(
      pt.map((n) =>
        n._type === "block" ? `${n.style}${n.listItem ? `:${n.listItem}${n.level}` : ""}` : "image",
      ),
    ).toEqual([
      "h2",
      "normal",
      "normal:bullet1",
      "normal:bullet1",
      "normal:bullet2",
      "normal:number1",
      "blockquote",
      "image",
      "normal",
    ]);
    const p = pt[1] as Extract<(typeof pt)[number], { _type: "block" }>;
    expect(p.children.map((c) => [c.text, c.marks.join("+")])).toEqual([
      ["Plain, ", ""],
      ["bold", "strong"],
      [", ", ""],
      ["italic", "em"],
      [", ", ""],
      ["code", "code"],
      [" and a ", ""],
      ["link", "l1"],
      [".\nSame paragraph.", ""],
    ]);
    expect(p.markDefs).toEqual([{ _key: "l1", _type: "link", href: "/contact" }]);
    // An unsafe link keeps its text; the sanitiser drops the link.
    const last = pt.at(-1) as Extract<(typeof pt)[number], { _type: "block" }>;
    expect(last.children.map((c) => c.text).join("")).toBe("Not a heading: ## and *stars*; bad");
    expect(last.markDefs).toEqual([]);
  });

  it("round-trips what it writes", () => {
    const html =
      "<h2>Title</h2><p>Some <strong>bold <em>and italic</em></strong> text with a " +
      '<a href="https://example.org/x">link</a> and *stars* [brackets] \\ backslash.</p>' +
      "<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol><blockquote>Quoted</blockquote>" +
      "<p># not a heading<br>- not a list</p>";
    const pt = htmlToPortableText(html).value;
    const text = portableTextToText(pt);
    expect(textToPortableText(text)).toEqual(
      textToPortableText(portableTextToText(textToPortableText(text))),
    );
    // Compare text and marks only: link keys are renumbered and adjacent spans with the same
    // marks are merged.
    const strip = (v: PortableText) =>
      v.map((n) =>
        n._type === "block"
          ? {
              ...n,
              markDefs: n.markDefs.map((d) => d.href),
              children: n.children.reduce<{ text: string; marks: string }[]>((acc, c) => {
                const marks = c.marks
                  .map((m) => n.markDefs.find((d) => d._key === m)?.href ?? m)
                  .join("+");
                const last = acc.at(-1);
                if (last && last.marks === marks) last.text += c.text;
                else acc.push({ text: c.text, marks });
                return acc;
              }, []),
            }
          : n,
      );
    expect(strip(textToPortableText(text))).toEqual(strip(pt));
    expect(text).toContain("## Title");
    expect(text).toContain("**bold _and italic_**");
    expect(text).toContain("\\*stars\\* \\[brackets\\] \\\\ backslash");
    expect(text).toContain("\\# not a heading\n\\- not a list");
  });

  it("is empty for empty or unsafe input", () => {
    expect(textToPortableText("   \n\n  ")).toEqual([]);
    expect(portableTextToText(undefined)).toBe("");
    expect(portableTextToText([{ _type: "script", text: "x" }])).toBe("");
  });
});
