// `infrabyx-ai prompts sync` on PostgreSQL (PL4 plan §4.4): platform prompt files become ACTIVE
// only with a current eval result; live-only environments need a live result.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type TestDatabase } from "@infrabyx/testing";
import { loadPromptFiles } from "../prompt-files.js";
import { syncPrompts } from "../prompt-sync.js";

let db: TestDatabase;
beforeAll(async () => {
  db = await startPostgres();
});
afterAll(async () => {
  await db?.end();
});

const status = async () =>
  (
    await db.admin.query<{ prompt_key: string; status: string }>(
      "select prompt_key, status from ai.prompt_version where tenant_id = 'tnt_platform' order by prompt_key",
    )
  ).rows;

describe("prompts sync", () => {
  const files = loadPromptFiles();
  const sync = (env: string, prompts = files) =>
    syncPrompts({ kernel: db.kernel, audit: db.audit, actorId: "usr_release", env, prompts });

  it("in pre-prod, prod and DR a scripted CI result leaves the version as a draft", async () => {
    for (const env of ["pre-prod", "prod", "dr"]) {
      const r = await sync(env);
      expect(r.every((x) => x.action === "draft_only" && /live eval/.test(x.reason ?? ""))).toBe(
        true,
      );
    }
    expect((await status()).every((s) => s.status === "DRAFT")).toBe(true);
  });

  it("in staging the CI result activates each version (OWNER-QUESTIONS #35); a second sync changes nothing", async () => {
    expect((await sync("staging")).map((x) => x.action)).toEqual([
      "activated",
      "activated",
      "activated",
    ]);
    expect((await status()).every((s) => s.status === "ACTIVE")).toBe(true);
    expect((await sync("test")).map((x) => x.action)).toEqual([
      "unchanged",
      "unchanged",
      "unchanged",
    ]);
    const ledger = await db.admin.query(
      "select 1 from audit.ledger where actor_id = 'usr_release' and action = 'ai.prompt.activate'",
    );
    expect(ledger.rowCount).toBe(3);
  });

  it("a stored version with other content is refused", async () => {
    const edited = files.map((f) => ({ ...f, contentSha256: "0".repeat(64) }));
    await expect(sync("test", edited)).rejects.toThrow(/other content/);
  });
});
