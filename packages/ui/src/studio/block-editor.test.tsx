// The visual block editor (PR-038; R1-D-02) on a small block library and fake services: the block
// operations, reading a block's form back (rows, groups, cleared fields, unknown properties kept),
// service error paths mapped to their fields, the rendered forms, and the handler's save. Browser
// checks (axe, keyboard) run in `apps/console`.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IpbError } from "@infrabyx/contracts/errors";
import {
  applyBlockOp,
  blockFieldOf,
  blockFromForm,
  blockHandlers,
  blockOpFromForm,
  BlockEditor,
  ContentEditScreen,
  FieldProblem,
  type BlockEditorOptions,
  type ContentReader,
  type ContentWriter,
  type StudioItem,
  type StudioRevision,
} from "./index.js";

const CTX = { who: "usr_editor" };

const OPTIONS: BlockEditorOptions = {
  richText: {
    toText: (v) => (v as { text: string }[]).map((p) => p.text).join("\n\n"),
    fromText: (t) => t.split(/\n\s*\n/).map((text) => ({ text })),
    hint: "Paragraphs.",
  },
  specs: [
    {
      type: "hero",
      label: "Hero",
      template: { heading: "New heading" },
      fields: [
        { kind: "text", name: "heading", label: "Heading", required: true },
        { kind: "text", name: "sub", label: "Subheading", multiline: true },
        {
          kind: "group",
          name: "primary_cta",
          label: "Main button",
          fields: [
            { kind: "text", name: "label", label: "Button text" },
            { kind: "text", name: "href", label: "Link" },
          ],
        },
      ],
    },
    {
      type: "steps",
      label: "Steps",
      template: { items: [{ title: "One", text: "First." }] },
      fields: [
        {
          kind: "list",
          name: "items",
          label: "Steps",
          fields: [
            { kind: "text", name: "title", label: "Title" },
            { kind: "richtext", name: "text", label: "Text" },
          ],
        },
        { kind: "number", name: "limit", label: "Limit" },
      ],
    },
    {
      type: "table",
      label: "Table",
      template: { columns: ["A", "B"], rows: [] },
      fields: [
        { kind: "lines", name: "columns", label: "Columns", required: true },
        { kind: "table", name: "rows", label: "Rows" },
        { kind: "checkbox", name: "names_competitor", label: "Names a competitor" },
        { kind: "select", name: "variant", label: "Style", options: ["primary", "secondary"] },
      ],
    },
    {
      type: "logos",
      label: "Logos",
      template: { logos: [{ org: "Org" }] },
      ref: { name: "logos.0.media_id", label: "Logo id" },
      fields: [],
    },
    {
      type: "quotes",
      label: "Quotes",
      template: {},
      ref: { name: "ids", label: "Quote id", list: true },
      fields: [{ kind: "lines", name: "ids", label: "Quotes" }],
    },
  ],
};

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

const HERO = {
  type: "hero",
  key: "top",
  heading: "Hello",
  primary_cta: { label: "Go", href: "/go" },
};
const STEPS = {
  type: "steps",
  slot: "main",
  items: [
    { title: "One", text: [{ text: "First." }], extra: "kept" },
    { title: "Two", text: [{ text: "Second." }] },
  ],
};
const TABS = { type: "tabs", tabs: [{ label: "A", blocks: [] }] };

describe("applyBlockOp", () => {
  const blocks = [HERO, STEPS];
  it("adds a type's template at a position, filling its reference", () => {
    const out = applyBlockOp(blocks, { op: "add", type: "logos", at: 1, ref: "med_1" }, OPTIONS);
    expect(out.map((b) => b.type)).toEqual(["hero", "logos", "steps"]);
    expect(out[1]).toEqual({ type: "logos", logos: [{ org: "Org", media_id: "med_1" }] });
    expect(OPTIONS.specs[3]!.template).toEqual({ logos: [{ org: "Org" }] });
    const q = applyBlockOp([], { op: "add", type: "quotes", at: 99, ref: "tst_1" }, OPTIONS);
    expect(q).toEqual([{ type: "quotes", ids: ["tst_1"] }]);
    expect(blocks).toEqual([HERO, STEPS]);
  });

  it("refuses an add without its reference or of an unknown type", () => {
    expect(() => applyBlockOp([], { op: "add", type: "logos", at: 0 }, OPTIONS)).toThrow(
      FieldProblem,
    );
    expect(() => applyBlockOp([], { op: "add", type: "script", at: 0 }, OPTIONS)).toThrow(
      FieldProblem,
    );
  });

  it("moves, removes and replaces by index, and refuses a block that is not there", () => {
    expect(applyBlockOp(blocks, { op: "move", index: 1, by: -1 }, OPTIONS)).toEqual([STEPS, HERO]);
    expect(applyBlockOp(blocks, { op: "move", index: 0, by: -1 }, OPTIONS)).toEqual(blocks);
    expect(applyBlockOp(blocks, { op: "remove", index: 0 }, OPTIONS)).toEqual([STEPS]);
    expect(applyBlockOp(blocks, { op: "update", index: 1, block: TABS }, OPTIONS)[1]).toBe(TABS);
    expect(() => applyBlockOp(blocks, { op: "remove", index: 2 }, OPTIONS)).toThrow(FieldProblem);
    expect(() => applyBlockOp(blocks, { op: "remove", index: 0.5 }, OPTIONS)).toThrow(FieldProblem);
  });
});

describe("blockFromForm", () => {
  it("reads rows, drops removed and empty ones, adds the new row and keeps unknown properties", () => {
    const fd = form({
      "b.1.items.0.title": "One",
      "b.1.items.0.text": "First.\n\nAgain.",
      "b.1.items.1.title": "Two",
      "b.1.items.1.remove": "yes",
      "b.1.items.2.title": "Three",
      "b.1.items.2.text": "Third.",
      "b.1.limit": "4",
    });
    expect(blockFromForm(fd, 1, STEPS, OPTIONS)).toEqual({
      type: "steps",
      slot: "main",
      limit: 4,
      items: [
        { title: "One", text: [{ text: "First." }, { text: "Again." }], extra: "kept" },
        { title: "Three", text: [{ text: "Third." }] },
      ],
    });
  });

  it("drops a cleared field and an emptied group, and keeps the block's key", () => {
    const fd = form({ "b.0.heading": "Hi", "b.0.sub": "  ", "b.0.primary_cta.label": "" });
    expect(blockFromForm(fd, 0, HERO, OPTIONS)).toEqual({
      type: "hero",
      key: "top",
      heading: "Hi",
    });
  });

  it("reads lines, tables, checkboxes and selects", () => {
    const block = { type: "table", columns: ["A"], rows: [] };
    const fd = form({
      "b.0.columns": "Feature\n\n Us \nThem",
      "b.0.rows": "Price | Low | High\n\nSpeed|Fast|Slow",
      "b.0.names_competitor": "yes",
      "b.0.variant": "secondary",
    });
    expect(blockFromForm(fd, 0, block, OPTIONS)).toEqual({
      type: "table",
      columns: ["Feature", "Us", "Them"],
      rows: [
        ["Price", "Low", "High"],
        ["Speed", "Fast", "Slow"],
      ],
      names_competitor: true,
      variant: "secondary",
    });
    const off = blockFromForm(
      form({ "b.0.columns": "A" }),
      0,
      { ...block, names_competitor: true },
      OPTIONS,
    );
    expect(off.names_competitor).toBe(false);
    expect(blockFromForm(form({ "b.0.columns": "A" }), 0, block, OPTIONS)).not.toHaveProperty(
      "names_competitor",
    );
  });

  it("names the field of a bad number and of bad JSON for a block without a form", () => {
    const bad = (fd: FormData, b: Record<string, unknown>) => {
      try {
        blockFromForm(fd, 2, b, OPTIONS);
      } catch (e) {
        return (e as FieldProblem).errors[0]?.fieldId;
      }
      return "no error";
    };
    expect(bad(form({ "b.2.limit": "lots" }), STEPS)).toBe("b-2-limit");
    expect(bad(form({ "b.2.json": "{oops" }), TABS)).toBe("b-2-json");
    expect(bad(form({ "b.2.json": "[1]" }), TABS)).toBe("b-2-json");
    expect(
      blockFromForm(form({ "b.2.json": '{"type":"tabs","tabs":[]}' }), 2, TABS, OPTIONS),
    ).toEqual({ type: "tabs", tabs: [] });
  });
});

describe("blockOpFromForm and blockFieldOf", () => {
  it("reads each operation", () => {
    const blocks = [HERO, STEPS];
    expect(
      blockOpFromForm(form({ op: "add", "block-type": "hero", "block-at": "1" }), blocks, OPTIONS),
    ).toEqual({
      op: "add",
      type: "hero",
      at: 1,
    });
    expect(blockOpFromForm(form({ op: "up", index: "1" }), blocks, OPTIONS)).toEqual({
      op: "move",
      index: 1,
      by: -1,
    });
    expect(blockOpFromForm(form({ op: "remove", index: "0" }), blocks, OPTIONS)).toEqual({
      op: "remove",
      index: 0,
    });
    const u = blockOpFromForm(
      form({ op: "update", index: "0", "b.0.heading": "New" }),
      blocks,
      OPTIONS,
    );
    expect(u).toMatchObject({ op: "update", index: 0, block: { heading: "New" } });
    expect(() => blockOpFromForm(form({ op: "update", index: "5" }), blocks, OPTIONS)).toThrow(
      FieldProblem,
    );
    expect(() =>
      blockOpFromForm(form({ op: "add", "block-type": "script" }), blocks, OPTIONS),
    ).toThrow(FieldProblem);
  });

  it("maps service error paths to the fields on the page", () => {
    expect(blockFieldOf("blocks[2].items[0].title")).toBe("b-2-items-0-title");
    expect(blockFieldOf("blocks[2].primary_cta.label")).toBe("b-2-primary_cta-label");
    expect(blockFieldOf("blocks[2].columns[1]")).toBe("b-2-columns");
    expect(blockFieldOf("blocks[2].rows[1][0]")).toBe("b-2-rows");
    expect(blockFieldOf("blocks[2].heading")).toBe("b-2-heading");
    expect(blockFieldOf("blocks[2]")).toBe("block-2");
    expect(blockFieldOf("blocks")).toBeUndefined();
    expect(blockFieldOf("seo.title")).toBeUndefined();
  });
});

describe("BlockEditor", () => {
  const out = renderToStaticMarkup(
    <BlockEditor
      itemId="pag_1"
      revisionId="rev_2"
      blocks={[HERO, STEPS, TABS]}
      action="/a/blocks"
      options={OPTIONS}
      errors={[{ fieldId: "b-1-items-0-title", message: "Enter a title." }]}
    />,
  );

  it("labels every control once, with unique ids", () => {
    const ids = [...out.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const controls = [...out.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(controls.length).toBeGreaterThan(10);
    for (const id of controls) expect(out).toContain(`for="${id}"`);
    expect(out).not.toMatch(/data-help-key=""/);
  });

  it("shows each block's own form, the rows plus a blank one, and JSON for a block without a form", () => {
    expect(out).toContain('name="b.0.heading"');
    expect(out).toContain('value="Hello"');
    expect(out).toContain('name="b.1.items.2.title"');
    expect(out).not.toContain('name="b.1.items.3.title"');
    expect(out).toContain('name="b.1.items.1.remove"');
    expect(out).not.toContain('name="b.1.items.2.remove"');
    expect(out).toContain('name="b.2.json"');
    expect(out).toContain("Enter a title.");
    expect(out).toContain('aria-invalid="true"');
  });

  it("offers moves only where a block can move, and an add form with positions", () => {
    expect(out).not.toContain("Move block 1 up");
    expect(out).toContain("Move block 1 down");
    expect(out).toContain("Move block 3 up");
    expect(out).not.toContain("Move block 3 down");
    expect(out).toContain('name="revisionId" value="rev_2"');
    expect(out).toMatch(/<option value="3" selected="">At the end<\/option>/);
    expect(out).toContain('id="f-block-ref"');
  });
});

const ITEM: StudioItem = {
  id: "pag_1",
  type: "page",
  packId: "brd_1",
  locale: "en-IN",
  slug: "about",
  title: "About",
  status: "approved",
  currentRevisionId: "rev_2",
  publishedRevisionId: null,
  publishedPath: null,
  publishAt: null,
  unpublishAt: null,
  needsLegal: false,
  lastReviewedAt: new Date("2026-10-01T00:00:00Z"),
  deletedAt: null,
};
const REV = (body: Record<string, unknown>): StudioRevision => ({
  id: "rev_2",
  seq: 2,
  title: "About",
  slug: "about",
  body,
  seo: { title: "About us" },
  source: "editor",
  sanitiserReport: [],
  createdBy: "usr_editor",
  createdAt: new Date("2026-10-02T10:00:00Z"),
});

function fakeCms(body: Record<string, unknown>, saves: unknown[], fail?: Error) {
  const reader: ContentReader<typeof CTX> = {
    list: async () => [ITEM],
    get: async () => ITEM,
    revision: async () => REV(body),
    revisions: async () => [REV(body)],
  };
  const writer = {
    saveDraft: async (_c: typeof CTX, itemId: string, input: unknown) => {
      if (fail) throw fail;
      saves.push({ itemId, ...(input as object) });
      return { item: ITEM, warnings: [], removed: [] };
    },
  } as unknown as ContentWriter<typeof CTX>;
  return { ...reader, ...writer } as ContentReader<typeof CTX> & ContentWriter<typeof CTX>;
}

describe("blockHandlers", () => {
  const body = { template: "article", blocks: [HERO, STEPS] };

  it("saves the changed blocks as a new draft with the rest of the revision", async () => {
    const saves: unknown[] = [];
    const h = blockHandlers(fakeCms(body, saves), OPTIONS);
    const r = await h.blocks(
      CTX,
      form({ itemId: "pag_1", revisionId: "rev_2", op: "down", index: "0" }),
    );
    expect(r.flash).toMatchObject({ tone: "success", title: "Block moved" });
    expect(saves).toEqual([
      {
        itemId: "pag_1",
        title: "About",
        slug: "about",
        body: { template: "article", blocks: [STEPS, HERO] },
        seo: { title: "About us" },
        summary: "Block moved (block 1)",
      },
    ]);
  });

  it("refuses a post made against an older revision, without saving", async () => {
    const saves: unknown[] = [];
    const h = blockHandlers(fakeCms(body, saves), OPTIONS);
    const r = await h.blocks(
      CTX,
      form({ itemId: "pag_1", revisionId: "rev_1", op: "remove", index: "0" }),
    );
    expect(saves).toEqual([]);
    expect(r.errors).toEqual([{ fieldId: "blocks", message: expect.stringMatching(/changed/) }]);
  });

  it("puts the service's field errors on the block's fields, and an added block's on the add form", async () => {
    const err = new IpbError("IPB-CMS-001", {
      detail: "blocks[1].items[0].title: Required",
      errors: [
        { path: "blocks[1].items[0].title", code: "IPB-CMS-001", message: "Required" },
        { path: "blocks", code: "IPB-CMS-001", message: "one hero per page" },
      ],
    });
    const h = blockHandlers(fakeCms(body, [], err), OPTIONS);
    const u = await h.blocks(
      CTX,
      form({
        itemId: "pag_1",
        revisionId: "rev_2",
        op: "update",
        index: "1",
        "b.1.items.0.title": "",
      }),
    );
    expect(u.errors).toEqual([
      { fieldId: "b-1-items-0-title", message: "Required" },
      { fieldId: "blocks", message: "one hero per page" },
    ]);
    const addErr = new IpbError("IPB-CMS-001", {
      errors: [
        { path: "blocks[0].logos[0].media_id", code: "IPB-CMS-001", message: "a media library id" },
      ],
    });
    const a = await blockHandlers(fakeCms(body, [], addErr), OPTIONS).blocks(
      CTX,
      form({
        itemId: "pag_1",
        revisionId: "rev_2",
        op: "add",
        "block-type": "logos",
        "block-at": "0",
        "block-ref": "x",
      }),
    );
    expect(a.errors).toEqual([{ fieldId: "f-block-ref", message: "a media library id" }]);
  });

  it("is shown on the edit screen for bodies with blocks only, with the JSON body folded away", async () => {
    const screen = (b: Record<string, unknown>) =>
      ContentEditScreen({
        ctx: CTX,
        base: "/studio",
        sections: ["pages"],
        flash: null,
        errors: [],
        cms: fakeCms(b, []),
        section: "pages",
        itemId: "pag_1",
        transitions: {},
        actions: { save: "/a/save", workflow: "/a/wf", preview: "/a/preview" },
        blocks: { options: OPTIONS, action: "/a/blocks" },
      }).then((el) => renderToStaticMarkup(el));
    const withBlocks = await screen(body);
    expect(withBlocks).toContain("Page blocks");
    expect(withBlocks).toContain('action="/a/blocks"');
    expect(withBlocks).toMatch(/<details class="ibx-studio__json"><summary>/);
    const menu = await screen({ items: [] });
    expect(menu).not.toContain("Page blocks");
    expect(menu).not.toContain("<details");
    expect(menu).toContain('id="f-body"');
  });
});
