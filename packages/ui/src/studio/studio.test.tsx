// The Studio screens and handlers on fake services (PL5 plan §9.6). The screens render server-side
// with only the moves the state machine allows; the handlers call the service and say what
// happened. Browser checks (axe, HTML_CodeSniffer, reflow, keyboard) run in `apps/console`.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IpbError } from "@infrabyx/contracts/errors";
import {
  ApprovalsScreen,
  BrandEditScreen,
  ClaimsScreen,
  contentHandlers,
  ContentEditScreen,
  ContentListScreen,
  decodeResult,
  encodeResult,
  MediaScreen,
  RedirectsScreen,
  redirectHandlers,
  run,
  sectionOfType,
  utc,
  type ContentReader,
  type ContentWriter,
  type StudioItem,
  type StudioRevision,
} from "./index.js";

const CTX = { who: "usr_editor" };
const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);
const ids = (out: string) => [...out.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
/** Ids of form controls (each must have a label). */
const controls = (out: string) =>
  [...out.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);

const item = (over: Partial<StudioItem> = {}): StudioItem => ({
  id: "pag_1",
  type: "page",
  packId: "brd_1",
  locale: "en-IN",
  slug: "about",
  title: "About",
  status: "draft",
  currentRevisionId: "rev_2",
  publishedRevisionId: null,
  publishedPath: null,
  publishAt: null,
  unpublishAt: null,
  needsLegal: false,
  lastReviewedAt: new Date("2026-10-01T00:00:00Z"),
  deletedAt: null,
  ...over,
});
const rev = (id: string, seq: number): StudioRevision => ({
  id,
  seq,
  title: "About",
  slug: "about",
  body: { template: "article", blocks: [] },
  seo: {},
  source: "editor",
  sanitiserReport: [],
  createdBy: "usr_editor",
  createdAt: new Date("2026-10-02T10:00:00Z"),
});
const reader = (it: StudioItem, list: StudioItem[] = [it]): ContentReader<typeof CTX> => ({
  list: async (_c, f = {}) =>
    list.filter((x) => (!f.status || x.status === f.status) && (!f.type || x.type === f.type)),
  get: async () => it,
  revision: async (_c, id) => rev(id, id === "rev_2" ? 2 : 1),
  revisions: async () => [rev("rev_2", 2), rev("rev_1", 1)],
});
const TRANSITIONS = {
  submit: { from: ["draft"] },
  approve: { from: ["in_review"] },
  legal_approve: { from: ["legal_review"] },
  request_changes: { from: ["in_review", "legal_review"] },
  publish_now: { from: ["approved"] },
  schedule: { from: ["approved"] },
  unschedule: { from: ["scheduled"] },
  unpublish: { from: ["published"] },
};
const actions = { save: "/a/save", workflow: "/a/wf", preview: "/a/preview" };

describe("ContentEditScreen", () => {
  it("offers only the moves allowed from the item's state", async () => {
    const draft = await html(
      ContentEditScreen({
        ctx: CTX,
        base: "/studio",
        section: "pages",
        cms: reader(item()),
        itemId: "pag_1",
        transitions: TRANSITIONS,
        actions,
      }),
    );
    expect(draft).toContain('value="submit"');
    expect(draft).not.toContain('value="approve"');
    expect(draft).not.toContain('value="publish_now"');

    const review = await html(
      ContentEditScreen({
        ctx: CTX,
        base: "/studio",
        section: "pages",
        cms: reader(item({ status: "in_review" })),
        itemId: "pag_1",
        transitions: TRANSITIONS,
        actions,
      }),
    );
    expect(review).toContain('value="approve"');
    expect(review).toContain('value="request_changes"');
    expect(review).not.toContain('value="submit"');
    expect(review).toContain("Saving changes moves the item back to draft");
  });

  it("labels every field, keeps ids unique, and offers rollback to older revisions only", async () => {
    const out = await html(
      ContentEditScreen({
        ctx: CTX,
        base: "/studio",
        section: "pages",
        cms: reader(item({ status: "published", publishedPath: "/about" })),
        itemId: "pag_1",
        transitions: TRANSITIONS,
        actions,
      }),
    );
    const all = ids(out);
    expect(new Set(all).size).toBe(all.length);
    for (const id of controls(out)) expect(out).toContain(`for="${id}"`);
    expect(out).toContain('value="rev_1"');
    expect(out).not.toContain('name="revisionId" value="rev_2"');
    expect(out).toContain('value="unpublish"');
    expect(out).toContain('value="mark_reviewed"');
  });

  it("shows the field errors linked from the summary and the one-off preview link", async () => {
    const out = await html(
      ContentEditScreen({
        ctx: CTX,
        base: "/studio",
        section: "pages",
        cms: reader(item()),
        itemId: "pag_1",
        transitions: TRANSITIONS,
        actions,
        flash: { tone: "danger", title: "Check the form" },
        errors: [{ fieldId: "f-title", message: "Enter a title." }],
        reveal: "/__preview/abc",
      }),
    );
    expect(out).toContain('href="#f-title"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain("/__preview/abc");
  });
});

describe("ContentListScreen", () => {
  it("lists only the section's types, links each item and posts new drafts with the pack", async () => {
    const list = [item(), item({ id: "nav_1", type: "nav_menu", title: "Header" })];
    const out = await html(
      ContentListScreen({
        ctx: CTX,
        base: "/studio",
        section: "menus",
        title: "Menus",
        cms: reader(list[1]!, list),
        packs: [{ id: "brd_1", label: "Group" }],
        packId: "brd_1",
        types: ["nav_menu"],
        actions: { create: "/a/create" },
      }),
    );
    expect(out).toContain('href="/studio/menus/nav_1"');
    expect(out).not.toContain("/studio/menus/pag_1");
    expect(out).toContain('name="packId" value="brd_1"');
    expect(out).toContain('aria-current="page"');
  });
});

function writer(calls: string[]): ContentWriter<typeof CTX> {
  const r = { item: item(), warnings: [], removed: [] };
  const log =
    (name: string) =>
    async (..._a: unknown[]) =>
      void calls.push(name);
  return {
    createItem: async (_c, i) => (
      calls.push(`create ${i.type} ${i.title}`),
      { ...r, item: item({ id: "pag_9" }) }
    ),
    saveDraft: async (_c, id, i) => (calls.push(`save ${id} ${JSON.stringify(i.body)}`), r),
    submit: log("submit"),
    requestChanges: async (_c, id, reason) => void calls.push(`changes ${id} ${reason}`),
    legalApprove: log("legal"),
    approve: log("approve"),
    schedule: async (_c, _id, at) => void calls.push(`schedule ${at.publishAt.toISOString()}`),
    unschedule: log("unschedule"),
    publishNow: log("publish"),
    unpublish: async (_c, _id, o) => void calls.push(`unpublish ${o.behaviour} ${o.to ?? ""}`),
    requestRollback: async (_c, _id, to) => void calls.push(`rollback ${to}`),
    softDelete: async () => (calls.push("delete"), { deleted: false, pendingApproval: "apr_1" }),
    restore: log("restore"),
    markReviewed: log("reviewed"),
    createPreview: async () => ({
      token: "t",
      path: "/__preview/t",
      expiresAt: new Date("2026-11-01T10:00:00Z"),
    }),
    revokePreview: async () => 2,
  };
}
const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

describe("contentHandlers", () => {
  it("creates a draft and sends the editor to it", async () => {
    const calls: string[] = [];
    const h = contentHandlers(writer(calls), { base: "/studio", section: "pages" });
    const r = await h.create(
      CTX,
      form({ type: "page", packId: "brd_1", title: "New", body: "{}" }),
    );
    expect(calls).toEqual(["create page New"]);
    expect(r.redirectTo).toBe("/studio/pages/pag_9");
  });

  it("reports invalid JSON on its field without calling the service", async () => {
    const calls: string[] = [];
    const h = contentHandlers(writer(calls), { base: "/studio", section: "pages" });
    const r = await h.save(CTX, form({ itemId: "pag_1", title: "A", body: "{oops" }));
    expect(calls).toEqual([]);
    expect(r.flash.tone).toBe("danger");
    expect(r.errors?.[0]?.fieldId).toBe("f-body");
  });

  it("maps each move to its service call, reading dates as UTC", async () => {
    const calls: string[] = [];
    const h = contentHandlers(writer(calls), { base: "/studio", section: "pages" });
    await h.workflow(CTX, form({ itemId: "pag_1", op: "submit" }));
    await h.workflow(CTX, form({ itemId: "pag_1", op: "schedule", publishAt: "2026-11-01T09:30" }));
    await h.workflow(
      CTX,
      form({ itemId: "pag_1", op: "unpublish", behaviour: "redirect", to: "/x" }),
    );
    await h.workflow(CTX, form({ itemId: "pag_1", op: "rollback", revisionId: "rev_1" }));
    const del = await h.workflow(CTX, form({ itemId: "pag_1", op: "delete", reason: "Old" }));
    expect(calls).toEqual([
      "submit",
      "schedule 2026-11-01T09:30:00.000Z",
      "unpublish redirect /x",
      "rollback rev_1",
      "delete",
    ]);
    expect(del.flash.title).toMatch(/checker/);
    const bad = await h.workflow(CTX, form({ itemId: "pag_1", op: "drop_table" }));
    expect(bad.errors?.[0]?.fieldId).toBe("f-op");
  });

  it("turns a service IpbError into a notice and rethrows anything else", async () => {
    const w = writer([]);
    w.submit = async () => {
      throw new IpbError("IPB-CMS-003", { detail: "submit is not allowed from published" });
    };
    const h = contentHandlers(w, { base: "/studio", section: "pages" });
    const r = await h.workflow(CTX, form({ itemId: "pag_1", op: "submit" }));
    expect(r.flash).toMatchObject({
      tone: "danger",
      detail: "submit is not allowed from published",
    });
    expect(r.flash.title).toContain("IPB-CMS-003");
    await expect(run(async () => Promise.reject(new Error("db down")))).rejects.toThrow("db down");
  });

  it("returns the preview path once", async () => {
    const h = contentHandlers(writer([]), { base: "/studio", section: "pages" });
    const r = await h.preview(CTX, form({ itemId: "pag_1", op: "create" }));
    expect(r.reveal).toBe("/__preview/t");
    expect((await h.preview(CTX, form({ itemId: "pag_1", op: "revoke" }))).flash.title).toMatch(
      /^2 /,
    );
  });
});

describe("results across the redirect", () => {
  it("round-trips a result and refuses tampered or oversized values", () => {
    const enc = encodeResult({
      flash: { tone: "warning", title: "Saved — check", detail: "Removed: <script>" },
      errors: [{ fieldId: "f-title", message: "Enter a title." }],
      reveal: "/__preview/x",
    });
    expect(decodeResult(enc)).toEqual({
      flash: { tone: "warning", title: "Saved — check", detail: "Removed: <script>" },
      errors: [{ fieldId: "f-title", message: "Enter a title." }],
      reveal: "/__preview/x",
    });
    expect(decodeResult(enc.slice(0, -3) + "!!!")).toBeNull();
    expect(decodeResult(btoa(JSON.stringify({ f: { tone: "evil", title: "x" } })))).toBeNull();
    expect(decodeResult("A".repeat(5000))).toBeNull();
    expect(decodeResult(undefined)).toBeNull();
  });

  it("reads datetime-local values as UTC and rejects anything else", () => {
    expect(utc("2026-11-01T09:30", "f")!.toISOString()).toBe("2026-11-01T09:30:00.000Z");
    expect(() => utc("tomorrow", "f-x")).toThrow();
  });
});

describe("other screens", () => {
  it("Approvals lists content, brand and redirect items waiting, each linked to its section", async () => {
    const list = [
      item({ id: "pag_2", status: "in_review" }),
      item({ id: "ofc_1", type: "office", status: "legal_review", title: "Delhi" }),
    ];
    const out = await html(
      ApprovalsScreen({
        ctx: CTX,
        base: "/studio",
        packs: [{ id: "brd_1", label: "Group" }],
        cms: {
          ...reader(list[0]!, list),
          redirects: async () => [
            {
              id: "rdr_1",
              from: "/old",
              to: "/new",
              status: 301,
              source: "manual",
              state: "pending",
              checkerId: null,
              legalReviewerId: "usr_l",
              hits: 0,
            },
          ],
        },
        brand: {
          packs: async () => [],
          revisions: async () => [],
          pending: async () => [
            {
              id: "brv_1",
              packId: "brd_1",
              body: {},
              hosts: [],
              status: "pending_approval",
              contrastGuardPassed: true,
              svgSanitised: true,
              legalReviewRequired: true,
              rollbackOf: null,
              makerId: "usr_a",
              checkerId: null,
              legalReviewerId: null,
            },
          ],
        },
      }),
    );
    expect(out).toContain('href="/studio/pages/pag_2"');
    expect(out).toContain('href="/studio/footer/ofc_1"');
    expect(out).toContain('href="/studio/brand/brd_1"');
    expect(out).toContain("Redirect /old");
    expect(out).toMatch(/Waiting for approval: 4/);
    expect(sectionOfType("nav_menu")).toBe("menus");
  });

  it("Redirects, Media, Claims and Brand render their forms with unique, labelled fields", async () => {
    const outs = [
      await html(
        RedirectsScreen({
          ctx: CTX,
          base: "/studio",
          packs: [{ id: "brd_1", label: "Group" }],
          packId: "brd_1",
          cms: { redirects: async () => [] },
          actions: { add: "/a", review: "/b", import: "/c" },
        }),
      ),
      await html(
        MediaScreen({
          ctx: CTX,
          base: "/studio",
          media: {
            list: async () => [
              {
                id: "med_1",
                kind: "image",
                mime: "image/png",
                bytes: 2048,
                altText: null,
                decorative: false,
                createdAt: new Date(),
              },
            ],
          },
          actions: { upload: "/a", describe: "/b", remove: "/c" },
        }),
      ),
      await html(
        ClaimsScreen({
          ctx: CTX,
          base: "/studio",
          cms: {
            claims: async () => [
              {
                id: "clm_1",
                text: "Claim",
                value: "10",
                unit: "%",
                asOf: new Date(),
                evidenceClass: "E0",
                kind: "figure",
                status: "proposed",
                reviewDue: new Date(),
              },
            ],
          },
          actions: { propose: "/a", assign: "/b", withdraw: "/c" },
        }),
      ),
      await html(
        BrandEditScreen({
          ctx: CTX,
          base: "/studio",
          packId: "brd_1",
          brand: { packs: async () => [], revisions: async () => [] },
          actions: { save: "/a", logo: "/b", workflow: "/c" },
        }),
      ),
    ];
    for (const out of outs) {
      const all = ids(out);
      expect(new Set(all).size).toBe(all.length);
      for (const id of controls(out)) expect(out).toContain(`for="${id}"`);
    }
    expect(outs[1]).toContain("Missing");
  });

  it("redirect handlers need no target for 410 and report the dry run", async () => {
    const calls: unknown[] = [];
    const h = redirectHandlers<typeof CTX>({
      addRedirect: async (_c, _p, rule) => (calls.push(rule), { id: "rdr_1" }),
      reviewRedirect: async () => ({ active: true }),
      importRedirects: async (_c, _p, _csv, o) => ({
        accepted: [1],
        conflicts: [],
        loops: [{ line: 2, reason: "a → a" }],
        chains: [],
        invalid: [],
        committed: o?.commit ? 1 : 0,
      }),
    });
    await h.add(CTX, form({ packId: "brd_1", from: "/gone", status: "410" }));
    expect(calls).toEqual([{ from: "/gone", to: null, status: 410 }]);
    const dry = await h.import(CTX, form({ packId: "brd_1", csv: "x", op: "dry_run" }));
    expect(dry.flash).toMatchObject({ tone: "warning", title: "Dry run" });
    expect(dry.flash.detail).toContain("Line 2: a → a.");
  });
});
