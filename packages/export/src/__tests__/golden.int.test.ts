// @IPB-09-AT-15 golden archive (IPB-09-35, PL3 plan §7.4): the demo tenant of a freshly seeded
// database, exported with the run-time values normalised, equals the committed golden archive of
// the last release byte for byte. `IPB_UPDATE_GOLDEN=1` rewrites the fixture (with a map bump).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalKms } from "@infrabyx/crypto";
import { platformSeedModule, runSeed } from "@infrabyx/seed";
import { startPostgres, type TestDatabase } from "@infrabyx/testing";
import { diffArchives, loadArchiveFiles } from "../diff.js";
import { goldenArchive } from "../golden.js";
import { REF_EXPORT_MAP } from "../maps.js";
import { kmsArchiveSigner } from "../service.js";

const GOLDEN = fileURLToPath(new URL("../../golden/REF-EXPORT-1.0/", import.meta.url));
const kms = new LocalKms();
const KEY = "local:sign:export";
let db: TestDatabase;
const tmp = mkdtempSync(join(tmpdir(), "ipb-golden-"));

beforeAll(async () => {
  db = await startPostgres();
  await runSeed({
    kernel: db.kernel,
    audit: db.audit,
    env: { APP_ENV: "test", SEED_ENABLED: true },
    product: "LD",
    profile: "demo",
    modules: [platformSeedModule],
    randomSeed: 20261025,
    runDate: new Date("2026-10-01T00:00:00Z"),
  } as never);
});

afterAll(async () => {
  await db?.end();
  rmSync(tmp, { recursive: true, force: true });
});

describe("@IPB-09-AT-15 golden archive", () => {
  it("Refactor must not change downloads: the demo tenant export equals the committed golden archive", async () => {
    const built = await goldenArchive({
      kernel: db.kernel,
      map: REF_EXPORT_MAP,
      signer: await kmsArchiveSigner(kms, KEY),
      tenantId: "tnt_demo",
      product: "REF",
    });
    const actual = new Map([...built.files].map(([p, b]) => [`${built.root}/${p}`, b]));
    if (process.env.IPB_UPDATE_GOLDEN === "1") {
      rmSync(GOLDEN, { recursive: true, force: true });
      for (const [p, b] of actual) {
        mkdirSync(join(GOLDEN, dirname(p)), { recursive: true });
        writeFileSync(join(GOLDEN, p), b);
      }
    }
    expect(diffArchives(actual, loadArchiveFiles(GOLDEN))).toEqual([]);
    // The ZIP itself diffs the same way.
    const zipPath = join(tmp, "golden.zip");
    writeFileSync(zipPath, built.zip);
    expect(diffArchives(loadArchiveFiles(zipPath), loadArchiveFiles(GOLDEN))).toEqual([]);
  });

  it("a changed record is a difference (IPB-ENG-007 in CI)", async () => {
    await db.admin.query(
      "update tenancy.tenant set name = 'Demo Co Renamed' where id = 'tnt_demo'",
    );
    try {
      const built = await goldenArchive({
        kernel: db.kernel,
        map: REF_EXPORT_MAP,
        signer: await kmsArchiveSigner(kms, KEY),
        tenantId: "tnt_demo",
        product: "REF",
      });
      const actual = new Map([...built.files].map(([p, b]) => [`${built.root}/${p}`, b]));
      expect(diffArchives(actual, loadArchiveFiles(GOLDEN)).length).toBeGreaterThan(0);
    } finally {
      await db.admin.query("update tenancy.tenant set name = 'Demo Co' where id = 'tnt_demo'");
    }
  });
});
