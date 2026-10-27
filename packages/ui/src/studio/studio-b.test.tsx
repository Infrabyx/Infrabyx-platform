// Session 8b screens and handlers on fake services: policies (approvals and the MAJOR notice),
// consent texts, the read-only feedback, trust and pricing sections, resource versions, and the
// approvals queue's optional sources.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IpbError } from "@infrabyx/contracts/errors";
import {
  ApprovalsScreen,
  ConsentTextsScreen,
  consentTextHandlers,
  FeedbackScreen,
  PoliciesScreen,
  PolicyEditScreen,
  policyHandlers,
  PricingScreen,
  ResourceVersionsPanel,
  TrustDocumentsScreen,
  type PolicyReader,
  type PolicyWriter,
  type StudioPolicy,
} from "./index.js";

const CTX = { who: "usr_legal" };
const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);
const controls = (out: string) =>
  [...out.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]!);
const labelled = (out: string) => {
  const ids = [...out.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of controls(out)) expect(out).toContain(`for="${id}"`);
};
const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

const policy = (over: Partial<StudioPolicy> = {}): StudioPolicy => ({
  id: "pin_1",
  setId: "pol_1",
  key: "terms",
  versionLabel: "2.0",
  changeClass: "MAJOR",
  title: "Terms of Use",
  body: "# Terms",
  hiSummary: null,
  summaryOfChanges: "New fees clause",
  effectiveAt: new Date("2026-12-01T00:00:00+05:30"),
  privacyClass: false,
  state: "draft",
  seededPlaceholder: false,
  makerId: "usr_legal",
  checkerId: null,
  dpoId: null,
  lastReviewedAt: new Date("2026-10-01T00:00:00Z"),
  ...over,
});
const reader = (v: StudioPolicy, noticeRequired = true): PolicyReader<typeof CTX> => ({
  setFor: async () => ({
    id: "pol_1",
    params: { grievance_officer: "A" },
    paramsVersion: 1,
    pendingParams: null,
    pendingMakerId: null,
  }),
  instances: async () => [v],
  get: async () => v,
  lint: async () => ({
    findings: [{ code: "IPB-POL-002", location: "§4", message: "[COUNSEL] marker left" }],
  }),
  noticeStatus: async () => ({
    required: noticeRequired,
    publishedAt: null,
    sentAt: null,
    notifiedAt: null,
    noticeDays: 30,
    effectiveFrom: null,
  }),
});
const edit = (v: StudioPolicy, required = true) =>
  html(
    PolicyEditScreen({
      ctx: CTX,
      base: "/studio",
      id: v.id,
      policies: reader(v, required),
      actions: { edit: "/e", workflow: "/w" },
    }),
  );

describe("PolicyEditScreen", () => {
  it("offers submit and the editor for a draft, and shows the lint findings", async () => {
    const out = await edit(policy());
    expect(out).toContain('value="submit"');
    expect(out).toContain('name="body"');
    expect(out).toContain("IPB-POL-002 at §4");
    expect(out).not.toContain('value="approve"');
    labelled(out);
  });

  it("asks for the DPO first on a submitted privacy policy, then any checker", async () => {
    const out = await edit(policy({ state: "submitted", privacyClass: true }));
    expect(out).toContain('value="dpo_approve"');
    expect(out).toContain('value="approve"');
    expect(out).toContain('value="request_changes"');
    expect(out).not.toContain('name="body"');
    const done = await edit(policy({ state: "submitted", privacyClass: true, dpoId: "usr_dpo" }));
    expect(done).not.toContain('value="dpo_approve"');
  });

  it("for an approved MAJOR change, offers the notice steps and says when it takes effect (#55)", async () => {
    const out = await edit(policy({ state: "approved" }));
    expect(out).toContain('value="publish_notice"');
    expect(out).toContain('value="notice_sent"');
    expect(out).toContain("30 days after users are notified");
    expect(await edit(policy({ state: "approved", changeClass: "MINOR" }), false)).not.toContain(
      "publish_notice",
    );
  });
});

describe("PoliciesScreen", () => {
  it("lists versions and the parameters, or offers to create the set", async () => {
    const props = {
      ctx: CTX,
      base: "/studio",
      packs: [{ id: "brd_1", label: "Group" }],
      packId: "brd_1",
      templates: [{ key: "terms", title: "Terms of Use" }],
      actions: { createSet: "/c", params: "/p", draft: "/d" },
    };
    const out = await html(PoliciesScreen({ ...props, policies: reader(policy()) }));
    expect(out).toContain('href="/studio/policies/pin_1"');
    expect(out).toContain("grievance_officer");
    labelled(out);
    const none = await html(
      PoliciesScreen({ ...props, policies: { ...reader(policy()), setFor: async () => null } }),
    );
    expect(none).toContain("Create the policy set");
  });
});

function writer(calls: string[]): PolicyWriter<typeof CTX> {
  const log =
    (n: string) =>
    async (..._a: unknown[]) =>
      void calls.push(n);
  return {
    createSet: async () => ({ id: "pol_1" }),
    proposeParams: async (_c, _s, params) => void calls.push(`propose ${JSON.stringify(params)}`),
    approveParams: log("approveParams"),
    draft: async (_c, i) => (
      calls.push(`draft ${i.key} ${i.changeClass} ${i.effectiveAt.toISOString()}`),
      { id: "pin_9" }
    ),
    editDraft: async (_c, _id, patch) => void calls.push(`edit ${JSON.stringify(patch)}`),
    submit: log("submit"),
    requestChanges: log("changes"),
    dpoApprove: log("dpo"),
    approve: log("approve"),
    publishNotice: log("publishNotice"),
    recordNoticeSent: async (_c, _id, at) => void calls.push(`sent ${at.toISOString()}`),
    markReviewed: log("reviewed"),
  };
}

describe("policyHandlers", () => {
  it("drafts with the date as an Indian date and opens the new version", async () => {
    const calls: string[] = [];
    const h = policyHandlers(writer(calls), { base: "/studio" });
    const r = await h.draft(
      CTX,
      form({
        setId: "pol_1",
        key: "terms",
        changeClass: "MAJOR",
        summary: "Fees",
        effectiveAt: "2026-12-01",
      }),
    );
    expect(calls).toEqual(["draft terms MAJOR 2026-11-30T18:30:00.000Z"]);
    expect(r.redirectTo).toBe("/studio/policies/pin_9");
  });

  it("records the notice send time in UTC and refuses parameters that are not an object", async () => {
    const calls: string[] = [];
    const h = policyHandlers(writer(calls), { base: "/studio" });
    await h.workflow(CTX, form({ id: "pin_1", op: "notice_sent", sentAt: "2026-11-01T09:15" }));
    expect(calls).toEqual(["sent 2026-11-01T09:15:00.000Z"]);
    const bad = await h.params(CTX, form({ setId: "pol_1", op: "propose", params: "[1]" }));
    expect(bad.errors?.[0]?.fieldId).toBe("f-params");
    await h.params(CTX, form({ setId: "pol_1", op: "propose", params: '{"dpo_name":"B"}' }));
    expect(calls).toContain('propose {"dpo_name":"B"}');
  });
});

describe("Consent texts", () => {
  it("offers approval only for drafts and drafts with the region and major flag", async () => {
    const out = await html(
      ConsentTextsScreen({
        ctx: CTX,
        base: "/studio",
        texts: {
          list: async () => [
            {
              id: "ctx_1",
              key: "consent.cookie.banner",
              version: "1.0",
              locale: "en-IN",
              region: "IN",
              body: "We use cookies…",
              state: "approved",
            },
            {
              id: "ctx_2",
              key: "consent.cookie.banner",
              version: "1.1",
              locale: "en-IN",
              region: "IN",
              body: "We use cookies…",
              state: "draft",
            },
          ],
        },
        actions: { draft: "/d", approve: "/a" },
      }),
    );
    expect(out).toContain('value="ctx_2"');
    expect(out).not.toContain('value="ctx_1"');
    labelled(out);
    const got: unknown[] = [];
    const h = consentTextHandlers<typeof CTX>({
      draft: async (_c, t) => (
        got.push(t),
        {
          id: "ctx_3",
          key: t.key,
          version: "2.0",
          locale: "en-IN",
          region: "EU",
          body: t.body,
          state: "draft",
        }
      ),
      approve: async () => {
        throw new IpbError("IPB-UX-011", { detail: "consent texts need PLT_LEGAL_REVIEWER" });
      },
    });
    const r = await h.draft(
      CTX,
      form({
        key: "consent.cookie.banner",
        region: "EU",
        locale: "en-IN",
        body: "New",
        major: "yes",
      }),
    );
    expect(got).toEqual([
      { key: "consent.cookie.banner", body: "New", locale: "en-IN", region: "EU", major: true },
    ]);
    expect(r.flash.title).toBe("Version 2.0 drafted");
    expect((await h.approve(CTX, form({ id: "ctx_3" }))).flash.tone).toBe("danger");
  });
});

describe("read-only sections", () => {
  it("Feedback shows the accessibility timers and filters by type", async () => {
    let asked: unknown;
    const out = await html(
      FeedbackScreen({
        ctx: CTX,
        base: "/studio",
        type: "accessibility",
        open: true,
        feedback: {
          queue: async (_c, f) => (
            (asked = f),
            [
              {
                id: "fbk_1",
                type: "accessibility",
                category: "ACCESSIBILITY",
                summary: "Menu not reachable by keyboard",
                route: "/",
                severity: null,
                status: "received",
                ohRef: null,
                priority: "P1",
                regulatedStep: true,
                ackDueAt: new Date("2026-10-28T10:00:00Z"),
                fixDueAt: null,
                slaBreaches: [],
                submittedAt: new Date(),
              },
            ]
          ),
        },
      }),
    );
    expect(asked).toEqual({ type: "accessibility", open: true });
    expect(out).toContain("P1, regulated step; acknowledge by 2026-10-28 10:00 UTC");
    expect(out).toContain("Not handed off yet");
    labelled(out);
  });

  it("Trust documents warns when the mirror is stale", async () => {
    const out = await html(
      TrustDocumentsScreen({
        ctx: CTX,
        base: "/studio",
        trust: {
          rows: async () => [
            {
              vad_id: "vad_1",
              version: 2,
              title: "Security overview",
              category: "POLICY",
              visibility: "PUBLIC",
              nda_required: false,
              valid_from: "2026-01-01",
              valid_until: null,
              mirror_state: "VISIBLE",
              digest_mismatch_at: null,
              synced_at: new Date(),
            },
          ],
          staleness: async () => ({ asOf: "2026-10-26T10:00:00Z", stale: true }),
        },
      }),
    );
    expect(out).toContain("The copy is out of date");
    expect(out).toContain("Security overview (POLICY)");
  });

  it("Pricing formats catalogue amounts and degrades to a notice when billing is down", async () => {
    const props = {
      ctx: CTX,
      base: "/studio",
      packs: [{ id: "brd_1", label: "Group" }],
      packId: "brd_1",
      cms: {
        list: async () => [],
        get: async () => {
          throw new Error("x");
        },
        revision: async () => {
          throw new Error("x");
        },
        revisions: async () => [],
      },
    };
    const out = await html(
      PricingScreen({
        ...props,
        catalogue: async () => ({
          product: "LD",
          brand_pack_id: "brd_1",
          catalogue_version: "v3",
          catalogue_hash: "a".repeat(64),
          plans: [
            {
              plan_key: "pro",
              name: "Pro",
              features: [],
              prices: [
                {
                  currency: "INR",
                  amount_minor: 99900,
                  period: "month",
                  gst_rate_bp: 1800,
                  tax_inclusive: false,
                },
              ],
              trial_days: 14,
            },
          ],
          coupons: [],
          fetched_at: "2026-10-27T10:00:00Z",
        }),
      }),
    );
    expect(out).toContain("₹999.00 per month, GST 18% extra");
    expect(out).toContain("14 days");
    const down = await html(
      PricingScreen({
        ...props,
        catalogue: async () => {
          throw new IpbError("IPB-WEB-006", { detail: "pricing temporarily unavailable" });
        },
      }),
    );
    expect(down).toContain("The price list is unavailable");
    await expect(
      html(
        PricingScreen({
          ...props,
          catalogue: async () => {
            throw new Error("bug");
          },
        }),
      ),
    ).rejects.toThrow("bug");
  });

  it("Resource versions offer withdrawal for live versions only", async () => {
    const out = await html(
      ResourceVersionsPanel({
        packId: "brd_1",
        itemId: "res_1",
        actions: { withdraw: "/w" },
        resources: {
          view: async () => ({
            current: "2.0",
            versions: [
              { version: "2.0", publishedAt: "2026-10-01T00:00:00Z", withdrawn: false },
              { version: "1.0", publishedAt: "2026-01-01T00:00:00Z", withdrawn: true },
            ],
          }),
        },
      }),
    );
    expect(out).toContain("Withdraw version 2.0");
    expect(out).not.toContain("Withdraw version 1.0");
  });
});

describe("Approvals with policies and consent texts", () => {
  it("adds submitted policy versions and leaves out a queue the viewer may not read", async () => {
    const base = {
      list: async () => [],
      get: async () => {
        throw new Error("x");
      },
      revision: async () => {
        throw new Error("x");
      },
      revisions: async () => [],
      redirects: async () => [],
    };
    const out = await html(
      ApprovalsScreen({
        ctx: CTX,
        base: "/studio",
        packs: [{ id: "brd_1", label: "Group" }],
        cms: base,
        brand: { packs: async () => [], revisions: async () => [], pending: async () => [] },
        policies: reader(policy({ state: "submitted", privacyClass: true })),
        texts: {
          drafts: async () => {
            throw new IpbError("IPB-UX-011");
          },
        },
      }),
    );
    expect(out).toContain('href="/studio/policies/pin_1"');
    expect(out).toContain("DPO and checker");
    expect(out).toMatch(/Waiting for approval: 1/);
  });
});
