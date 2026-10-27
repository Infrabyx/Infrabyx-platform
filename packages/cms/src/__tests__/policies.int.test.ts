// Policies on PostgreSQL (IPB-05; PL5 plan §5.7, session 5a).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgOutbox } from "@infrabyx/tenancy";
import {
  FakeLawRegister,
  platformContext,
  startPostgres,
  type TestDatabase,
} from "@infrabyx/testing";
import { policyTemplate, PolicyStudio, PublicPolicies } from "../index.js";

let db: TestDatabase;
let clock = new Date("2026-02-01T10:00:00+05:30");
let policies: PolicyStudio;
let pub: PublicPolicies;
const notices: string[] = [];
/** When true, the NOTIFY hook reports the notice as sent at approval (#55). */
let hookSends = false;
const legal = platformContext(["PLT_LEGAL_REVIEWER"], "tnt_platform", "usr_legal");
const admin = platformContext(["PLT_SUPER_ADMIN"], "tnt_platform", "usr_admin");
const dpo = platformContext(["PLT_DPO"], "tnt_platform", "usr_dpo");
const PACK = "brd_01JB0000000000000000000002";

const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? String(e),
  );
/** A complete body: every clause has reviewed wording (no counsel markers). */
const filled = (key: string, extra = "") =>
  policyTemplate(key)
    .body.replace(
      /\[COUNSEL\] Clause wording[^\n]*?(Parameters: ([^\n]*?)\.)?(?: Conditional on: [^\n]*)?$/gm,
      (_m, _p, params?: string) => `Reviewed wording. ${params ?? ""} ${extra}`.trim(),
    )
    .replace(/^## (Annex [^\n]*)\n\n\[COUNSEL\][^\n]*$/gm, "");
let omitted: string[] = [];

async function publish(
  setId: string,
  key: string,
  o: { change?: "MAJOR" | "MINOR"; effectiveAt?: Date; body?: string } = {},
) {
  const i = await policies.draft(legal, {
    setId,
    key,
    ...(o.change ? { changeClass: o.change } : {}),
    body: o.body ?? filled(key),
    summaryOfChanges: "Reviewed text",
    effectiveAt: o.effectiveAt ?? new Date(clock.getTime() + 60_000),
  });
  await policies.submit(legal, i.id);
  if (i.privacyClass) await policies.dpoApprove(dpo, i.id);
  await policies.approve(admin, i.id);
  let at = (o.effectiveAt ?? clock).getTime();
  if (o.change === "MAJOR" && ["terms", "payment_terms"].includes(key)) {
    // Users are notified now: the notice is published and sent (#55).
    await policies.publishNotice(legal, i.id);
    await policies.recordNoticeSent(legal, i.id, clock);
    at = Math.max(at, clock.getTime() + 30 * 86_400_000);
  }
  await policies.tick(new Date(at + 120_000));
  return i;
}

beforeAll(async () => {
  db = await startPostgres();
  policies = new PolicyStudio({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    outbox: new PgOutbox(),
    lawRegister: new FakeLawRegister(),
    now: () => clock,
    hooks: {
      params: async () => ({
        ...Object.fromEntries(
          [
            ...new Set([
              ...["privacy", "terms", "cookies", "grievance", "retention"].flatMap(
                (k) => policyTemplate(k).parameters,
              ),
            ]),
          ]
            .filter((p) => !omitted.includes(p))
            .map((p) => [p, `value of ${p}`]),
        ),
      }),
      notifyPolicyChange: async (n) => {
        notices.push(`${n.key}@${n.version}`);
        return hookSends ? { sentAt: clock } : undefined;
      },
    },
  });
  pub = new PublicPolicies({ kernel: db.kernel });
});
afterAll(async () => {
  await db?.end();
});

describe("@IPB-05-AT-03 parameters", () => {
  it("refuses a Privacy Notice with {{dpo_email}} unset, and a draft still carrying counsel markers", async () => {
    const { id: setId } = await policies.createSet(legal, "brd_01JB0000000000000000000009");
    omitted = ["dpo_email"];
    const i = await policies.draft(legal, {
      setId,
      key: "privacy",
      body: filled("privacy"),
      summaryOfChanges: "First",
      effectiveAt: clock,
    });
    expect(await code(policies.submit(legal, i.id))).toBe("IPB-POL-001");
    omitted = [];
    expect(
      await code(policies.editDraft(legal, i.id, { body: policyTemplate("privacy").body })),
    ).toBeNull();
    expect(await code(policies.submit(legal, i.id))).toBe("IPB-POL-001");
  });
});

describe("@IPB-05-AT-08 approvals", () => {
  it("needs the DPO for a privacy-class template; the maker never approves", async () => {
    const { id: setId } = await policies.createSet(admin, PACK);
    const i = await policies.draft(legal, {
      setId,
      key: "privacy",
      body: filled("privacy"),
      summaryOfChanges: "First",
      effectiveAt: clock,
    });
    expect(
      await code(
        policies.draft(admin, { setId, key: "terms", summaryOfChanges: "x", effectiveAt: clock }),
      ),
    ).toBe("IPB-UX-011");
    await policies.submit(legal, i.id);
    expect(await code(policies.approve(admin, i.id))).toBe("IPB-POL-006");
    expect(await code(policies.dpoApprove(legal, i.id))).toBe("IPB-UX-011");
    await policies.dpoApprove(dpo, i.id);
    expect((await policies.approve(admin, i.id)).state).toBe("approved");
    await policies.tick(new Date(clock.getTime() + 1000));
    expect((await pub.current(PACK, "privacy"))?.versionLabel).toBe("1.0");
  });
});

describe("@IPB-05-AT-04 versions and the archive; IPB-POL-008", () => {
  it("serves the new version, keeps the old one readable with a superseded banner, and refuses in-place edits", async () => {
    const setId = (
      await db.admin.query("select id from cms.policy_set where brand_pack_id = $1", [PACK])
    ).rows[0].id as string;
    const v1 = await publish(setId, "terms", {
      effectiveAt: new Date("2026-01-01T00:00:00+05:30"),
    });
    expect(await code(policies.editDraft(legal, v1.id, { body: "changed" }))).toBe("IPB-POL-008");
    await expect(
      db.admin.query("update cms.policy_instance set body = 'x' where id = $1", [v1.id]),
    ).rejects.toThrow(/cannot be edited in place/);
    clock = new Date("2026-01-20T10:00:00+05:30");
    await publish(setId, "terms", {
      change: "MAJOR",
      effectiveAt: new Date("2026-03-01T00:00:00+05:30"),
    });
    const current = await pub.current(PACK, "terms");
    expect(current).toMatchObject({
      versionLabel: "2.0",
      summaryOfChanges: "Reviewed text",
      supersededBanner: null,
    });
    expect(current!.html).toContain('<h2 id="clause-7">');
    const old = await pub.version(PACK, "terms", "1.0");
    expect(old?.supersededBanner).toMatch(/^Superseded on \d{2} \w{3} 2026$/);
    expect(old?.versions.map((v) => v.versionLabel)).toEqual(["2.0", "1.0"]);
    expect(notices).toContain("terms@2.0");
    const idx = await pub.index(PACK, "https://group.example.org");
    expect(idx.policies.find((p) => p.key === "terms")).toMatchObject({
      version: "2.0",
      url: "https://group.example.org/legal/terms",
    });
  });
});

describe("@IPB-05-AT-05 notice period and re-consent", () => {
  it("refuses a MAJOR Terms change effective inside 30 days, then makes it effective 30 days after users are notified, with re-consent", async () => {
    const setId = (
      await db.admin.query("select id from cms.policy_set where brand_pack_id = $1", [PACK])
    ).rows[0].id as string;
    clock = new Date("2026-04-01T10:00:00+05:30");
    const i = await policies.draft(legal, {
      setId,
      key: "terms",
      changeClass: "MAJOR",
      body: filled("terms"),
      summaryOfChanges: "Liability",
      effectiveAt: new Date("2026-04-10T00:00:00+05:30"),
    });
    expect(await code(policies.submit(legal, i.id))).toBe("IPB-POL-005");
    await policies.editDraft(legal, i.id, { effectiveAt: new Date("2026-05-03T00:00:00+05:30") });
    await policies.submit(legal, i.id);
    hookSends = true;
    expect((await policies.approve(admin, i.id)).reconsentRequired).toBe(true);
    hookSends = false;
    // Sent on approval (1 Apr) but not yet published: users are not notified, nothing takes effect.
    expect((await policies.noticeStatus(legal, i.id)).sentAt).toEqual(clock);
    expect(await pub.upcoming(PACK, "terms")).toBeNull();
    expect(await policies.tick(new Date("2026-05-03T00:01:00+05:30"))).toEqual([]);
    // Published on 5 Apr: the 30 days count from then (OWNER-QUESTIONS #55), not from approval.
    clock = new Date("2026-04-05T10:00:00+05:30");
    const st = await policies.publishNotice(legal, i.id);
    expect(st.notifiedAt).toEqual(clock);
    expect(st.effectiveFrom).toEqual(new Date("2026-05-05T10:00:00+05:30"));
    expect(await code(policies.publishNotice(legal, i.id))).toBe("IPB-CMS-003");
    expect(await pub.upcoming(PACK, "terms")).toMatchObject({
      versionLabel: "3.0",
      effectiveFrom: "2026-05-05T04:30:00.000Z",
      reconsentRequired: true,
    });
    await expect(
      db.admin.query("delete from cms.policy_notice where instance_id = $1", [i.id]),
    ).rejects.toThrow(/append-only/);
    expect(await policies.tick(new Date("2026-05-03T00:01:00+05:30"))).toEqual([]);
    expect(await policies.tick(new Date("2026-05-05T10:01:00+05:30"))).toEqual([i.id]);
    const ev = await db.admin.query<{ data: { reconsent_required: boolean; version: string } }>(
      "select envelope->'data' as data from cms.outbox where type like '%.PolicyEffective.%' order by created_at desc limit 1",
    );
    expect(ev.rows[0]!.data).toMatchObject({ version: "3.0", reconsent_required: true });
  });
});

describe("@IPB-05-AT-06 Hindi", () => {
  it("refuses an unreviewed machine-translated Hindi text", async () => {
    const setId = (
      await db.admin.query("select id from cms.policy_set where brand_pack_id = $1", [PACK])
    ).rows[0].id as string;
    const i = await policies.draft(legal, {
      setId,
      key: "cookies",
      body: filled("cookies"),
      summaryOfChanges: "First",
      effectiveAt: clock,
      hiSummary: "सारांश",
      hiMachineTranslated: true,
    });
    expect(await code(policies.submit(legal, i.id))).toBe("IPB-POL-007");
    await policies.editDraft(legal, i.id, { hiMachineTranslated: false });
    expect((await policies.submit(legal, i.id)).state).toBe("submitted");
  });
});

describe("@IPB-05-AT-07 review cadence", () => {
  it("lists a Cookie Policy last reviewed 7 months ago and emits PolicyReviewDue", async () => {
    const id = (
      await db.admin.query(
        "select id from cms.policy_instance where policy_key = 'cookies' and state = 'submitted'",
      )
    ).rows[0].id as string;
    await policies.dpoApprove(dpo, id);
    await policies.approve(admin, id);
    await policies.tick(new Date(clock.getTime() + 1000));
    await db.admin.query("update cms.policy_instance set last_reviewed_at = $2 where id = $1", [
      id,
      new Date(clock.getTime() - 213 * 86_400_000),
    ]);
    expect((await policies.reviewQueue(legal)).map((i) => i.id)).toEqual([id]);
    expect(await policies.emitReviewDue(legal)).toBe(1);
    await policies.markReviewed(legal, id);
    expect(await policies.reviewQueue(legal)).toEqual([]);
  });
});

describe("@IPB-05-AT-09 banned wording and stale citations", () => {
  it("names IPB-POL-003 and IPB-POL-004 with their clauses", async () => {
    const setId = (
      await db.admin.query("select id from cms.policy_set where brand_pack_id = $1", [PACK])
    ).rows[0].id as string;
    const body = filled("retention").replace(
      "## 2. Schedule\n\nReviewed wording.",
      "## 2. Schedule\n\nWe guarantee deletion under the RBI 2017 NBFC outsourcing directions.",
    );
    const i = await policies.draft(legal, {
      setId,
      key: "retention",
      body,
      summaryOfChanges: "First",
      effectiveAt: clock,
    });
    const l = await policies.lint(legal, i.id);
    expect(l.findings.map((f) => [f.code, f.location])).toEqual([
      ["IPB-POL-003", "clause 2"],
      ["IPB-POL-004", "clause 2"],
    ]);
    expect(await code(policies.submit(legal, i.id))).toBe("IPB-POL-003");
  });
});

describe("@IPB-05-AT-01 mandatory policy set", () => {
  it("the Brand Studio hook refuses an incomplete set with IPB-POL-009 naming the missing templates", async () => {
    const setId = (
      await db.admin.query("select id from cms.policy_set where brand_pack_id = $1", [PACK])
    ).rows[0].id as string;
    const hook = policies.policySetHook();
    const e = await hook(admin, setId).catch(
      (x: { code: string; meta: { missing: string[] } }) => x,
    );
    expect(e).toMatchObject({
      code: "IPB-POL-009",
      meta: { missing: expect.arrayContaining(["grievance", "ai_policy", "retention"]) },
    });
    expect((e as { meta: { missing: string[] } }).meta.missing).not.toContain("terms");
  });

  it("seeds placeholders only where seeds may run; they render with noindex", async () => {
    const { id: setId } = await policies.createSet(admin, "brd_01JB0000000000000000000003");
    expect(
      await code(policies.seedPlaceholder(admin, { setId, key: "grievance", seedAllowed: false })),
    ).toBe("IPB-ENV-001");
    await policies.seedPlaceholder(admin, { setId, key: "grievance", seedAllowed: true });
    expect(await pub.current("brd_01JB0000000000000000000003", "grievance")).toMatchObject({
      placeholder: true,
      noindex: true,
    });
  });
});

describe("Studio readers (PL5 session 8b: Policies)", () => {
  it("finds a pack's set with its parameters and lists every version by key, newest first", async () => {
    expect(await policies.setFor(legal, "brd_01JB00000000000000000000R1")).toBeNull();
    const { id: setId } = await policies.createSet(legal, "brd_01JB00000000000000000000R1");
    await policies.proposeParams(legal, setId, { grievance_officer: "Example Officer" });
    expect(await policies.setFor(admin, "brd_01JB00000000000000000000R1")).toMatchObject({
      id: setId,
      pendingParams: { grievance_officer: "Example Officer" },
      pendingMakerId: "usr_legal",
    });
    const a = await policies.draft(legal, {
      setId,
      key: "terms",
      summaryOfChanges: "First",
      effectiveAt: clock,
    });
    const b = await policies.draft(legal, {
      setId,
      key: "privacy",
      summaryOfChanges: "First",
      effectiveAt: clock,
    });
    const list = await policies.instances(admin, setId);
    expect(list.map((x) => x.key)).toEqual(["privacy", "terms"]);
    expect(list.map((x) => x.id)).toEqual([b.id, a.id]);
  });
});
