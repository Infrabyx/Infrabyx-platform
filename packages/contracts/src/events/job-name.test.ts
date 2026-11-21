import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isQueueJobName, QUEUE_JOB_NAME_MAX } from "../ports/queue.js";
import * as events from "./index.js";
import { isEcosystemType, isInternalType } from "./envelope.js";
import { eventJobName, eventTypeOfJobName, isEventJobName } from "./job-name.js";

const isType = (t: string) => isInternalType(t) || isEcosystemType(t);

/** Every event type the package declares: literal types, `{ module, name }` catalogues, sources. */
function declaredTypes(): string[] {
  const found = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): void => {
    if (depth > 6 || v === null || seen.has(v)) return;
    if (typeof v === "string") {
      if (isType(v)) found.add(v);
      return;
    }
    if (typeof v !== "object" && typeof v !== "function") return;
    seen.add(v);
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.module === "string" && typeof o.name === "string") {
        const t = `in.ipb.${o.module}.${o.name}.v1`;
        if (isType(t)) found.add(t);
      }
      for (const k of Object.keys(o)) walk(o[k], depth + 1);
    }
  };
  walk(events, 0);
  // String literals and `in.<p>.` templates in the sources, for types no export lists.
  const dir = fileURLToPath(new URL("../", import.meta.url));
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? files(`${d}${e.name}/`)
        : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")
          ? [`${d}${e.name}`]
          : [],
    );
  for (const f of files(dir))
    for (const m of readFileSync(f, "utf8").matchAll(
      /in\.(?:<p>|[a-z][a-z0-9]*)\.[A-Za-z0-9_.]+/g,
    )) {
      const t = m[0].replace("<p>", "ipb");
      if (isType(t)) found.add(t);
    }
  return [...found].sort();
}

describe("eventJobName / eventTypeOfJobName (Finbyx PR-FBX-53; R1-D-266)", () => {
  it("maps Finbyx's reference type: only the event segment, in kebab case", () => {
    expect(eventJobName("in.fbx.cms.ContentPublished.v1")).toBe("in.fbx.cms.content-published.v1");
    expect(eventTypeOfJobName("in.fbx.cms.content-published.v1")).toBe(
      "in.fbx.cms.ContentPublished.v1",
    );
  });

  it.each([
    ["in.infrabyx.origination.KFSIssued.v1", "in.infrabyx.origination.k-f-s-issued.v1"],
    ["in.infrabyx.origination.ESignCompleted.v1", "in.infrabyx.origination.e-sign-completed.v1"],
    ["in.ld.documents.DocumentSigned.v12", "in.ld.documents.document-signed.v12"],
    ["in.udf2.loan_book.Step2Done.v3", "in.udf2.loan_book.step2-done.v3"],
    ["in.fbx.cms.A.v1", "in.fbx.cms.a.v1"],
    ["in.fbx.cms.AB.v1", "in.fbx.cms.a-b.v1"],
    ["in.fbx.cms.A1B2.v1", "in.fbx.cms.a1-b2.v1"],
    ["in.fbx.cms.V2Report.v1", "in.fbx.cms.v2-report.v1"],
    ["in.fbx.cms.Abc123.v9", "in.fbx.cms.abc123.v9"],
  ])("edge case %s", (type, name) => {
    expect(eventJobName(type)).toBe(name);
    expect(isQueueJobName(name)).toBe(true);
    expect(eventTypeOfJobName(name)).toBe(type);
  });

  it("is one to one: acronyms and their title-case spelling get different names", () => {
    const pairs = [
      ["in.infrabyx.origination.KFSIssued.v1", "in.infrabyx.origination.KfsIssued.v1"],
      ["in.fbx.cms.ABc.v1", "in.fbx.cms.AbC.v1"],
    ];
    for (const [a, b] of pairs) expect(eventJobName(a!)).not.toBe(eventJobName(b!));
  });

  it("round-trips every event type the package declares, each a valid job name", () => {
    const types = declaredTypes();
    expect(types.length).toBeGreaterThan(80);
    expect(types).toContain("in.infrabyx.origination.KFSIssued.v1");
    const names = new Set<string>();
    for (const t of types) {
      const n = eventJobName(t);
      expect(isQueueJobName(n), n).toBe(true);
      expect(eventTypeOfJobName(n)).toBe(t);
      names.add(n);
    }
    expect(names.size).toBe(types.length);
  });

  it("round-trips generated types (letters, digits, runs of capitals)", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const pick = (s: string) => s[rnd(s.length)]!;
    const UP = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const ALL = `${UP}abcdefghijklmnopqrstuvwxyz0123456789`;
    for (let i = 0; i < 2000; i++) {
      let ev = pick(UP);
      for (let j = rnd(14); j > 0; j--) ev += pick(rnd(3) ? ALL : UP);
      const t = rnd(2)
        ? `in.infrabyx.dom_${rnd(9)}.${ev}.v${1 + rnd(20)}`
        : `in.p${rnd(9)}.mod_${rnd(9)}.${ev}.v${1 + rnd(20)}`;
      const n = eventJobName(t);
      expect(isQueueJobName(n)).toBe(true);
      expect(eventTypeOfJobName(n)).toBe(t);
    }
  });

  it("refuses what is not an event type (IPB-PORT-003, not_event_type)", () => {
    for (const bad of [
      "",
      "canary",
      "in.fbx.cms.content-published.v1",
      "in.fbx.cms.ContentPublished",
      "in.fbx.cms.ContentPublished.v0",
      "in.FBX.cms.ContentPublished.v1",
      "in.infrabyx.cms.x.ContentPublished.v1",
      "in.fbx.cms.Content-Published.v1",
      "in.fbx.cms.Content_Published.v1",
      "x.fbx.cms.ContentPublished.v1",
      42 as unknown as string,
    ])
      expect(() => eventJobName(bad)).toThrowError(
        expect.objectContaining({ code: "IPB-PORT-003", meta: { reason: "not_event_type" } }),
      );
  });

  it("refuses a job name over 100 characters (job_name_too_long)", () => {
    const long = `in.fbx.cms.${"Ab".repeat(39)}.v1`; // a 116-character event segment
    expect(isType(long)).toBe(true);
    expect(() => eventJobName(long)).toThrowError(
      expect.objectContaining({ code: "IPB-PORT-003", meta: { reason: "job_name_too_long" } }),
    );
    // The longest that fits is exactly 100 characters.
    const event = `E${"x".repeat(QUEUE_JOB_NAME_MAX - "in.fbx.cms.".length - ".v1".length - 1)}`;
    const t = `in.fbx.cms.${event}.v1`;
    expect(eventJobName(t)).toHaveLength(QUEUE_JOB_NAME_MAX);
    expect(() => eventJobName(`in.fbx.cms.${event}x.v1`)).toThrowError(/IPB-PORT-003/);
  });

  it("refuses a name no event type maps to (not_event_job_name)", () => {
    for (const bad of [
      "canary",
      "in.fbx.cms.ContentPublished.v1",
      "in.fbx.cms.content--published.v1",
      "in.fbx.cms.-content.v1",
      "in.fbx.cms.content-.v1",
      "in.fbx.cms.content-2x.v1",
      "in.fbx.cms.content_published.v1",
      "in.fbx.cms.content-published.v0",
      "in.fbx.cms.x.content-published.v1",
      "in.infrabyx.a.b.content-published.v1",
      `in.fbx.cms.${"a".repeat(100)}.v1`,
    ]) {
      expect(isEventJobName(bad)).toBe(false);
      expect(() => eventTypeOfJobName(bad)).toThrowError(
        expect.objectContaining({ code: "IPB-PORT-003", meta: { reason: "not_event_job_name" } }),
      );
    }
    expect(isEventJobName("in.fbx.cms.content-published.v1")).toBe(true);
  });
});
