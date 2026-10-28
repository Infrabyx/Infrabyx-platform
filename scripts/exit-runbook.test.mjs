// The exit runbook generator (IPB-01 §01.4.13, IPB-01-38; PL6 plan §9.2).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generatedOn, main, renderRunbook, TARGET_RTO } from "./exit-runbook.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const tmp = () => mkdtempSync(join(tmpdir(), "exit-"));
const quiet = async (argv) => {
  const log = console.log;
  const err = console.error;
  console.log = console.error = () => {};
  try {
    return await main(argv);
  } finally {
    console.log = log;
    console.error = err;
  }
};

const catalogue = { STORAGE: { tier: 1 }, KMS: { tier: 0 } };
const exits = [
  {
    port: "STORAGE",
    primary: "s3",
    exitTarget: "minio",
    dataMove: "replicateTo",
    volumeClass: "M",
    lockIn: "None",
  },
  {
    port: "KMS",
    primary: "aws-kms",
    exitTarget: "vault-transit",
    dataMove: "re-wrap",
    volumeClass: "S",
    lockIn: "Key material",
  },
];

describe("renderRunbook", () => {
  it("states every field of §01.4.13 per port, with the routing's adapters and the latest drill", () => {
    const md = renderRunbook({
      catalogue,
      exits,
      routing: {
        ports: { STORAGE: { primary: { adapter: "azure-blob" }, secondary: { adapter: "s3" } } },
      },
      drills: [
        {
          port: "KMS",
          date: "2026-01-01",
          env: "staging",
          measuredRtoHours: 30,
          evidence: "vad_old",
        },
        {
          port: "KMS",
          date: "2026-06-01",
          env: "staging",
          measuredRtoHours: 12,
          evidence: "vad_new",
        },
      ],
      sources: { routing: "routing.yaml", drills: "drills.json" },
      generatedOn: "2026-10-28",
    });
    expect(generatedOn(md)).toBe("2026-10-28");
    expect(md).toContain(
      "| STORAGE / azure-blob | s3 | replicateTo | M | Not yet drilled | Tier 1: 48 h | None | None |",
    );
    expect(md).toContain(
      `| KMS / aws-kms | vault-transit | re-wrap | S | 12 h | Tier 0: ${TARGET_RTO[0]} | Key material | 2026-06-01, staging, vad_new |`,
    );
  });

  it("refuses a port the catalogue does not know", () => {
    expect(() =>
      renderRunbook({
        catalogue: {},
        exits,
        routing: null,
        drills: [],
        sources: { drills: "d" },
        generatedOn: "2026-10-28",
      }),
    ).toThrow(/not in the port catalogue/);
  });
});

describe("@IPB-01-AT-17 exit runbook currency", () => {
  it("the release check fails when the runbook was generated more than 180 days ago", async () => {
    const out = join(tmp(), "EXIT_RUNBOOK.md");
    expect(await quiet(["--out", out, "--now", "2026-04-01T00:00:00Z"])).toBe(0);
    expect(generatedOn(readFileSync(out, "utf8"))).toBe("2026-04-01");
    // 200 days later.
    expect(
      await quiet(["--out", out, "--max-age-days", "180", "--now", "2026-10-18T00:00:00Z"]),
    ).toBe(1);
    expect(
      await quiet(["--out", out, "--max-age-days", "180", "--now", "2026-09-01T00:00:00Z"]),
    ).toBe(0);
  });

  it("the drift check fails when the inputs changed after the runbook was generated", async () => {
    const out = join(tmp(), "EXIT_RUNBOOK.md");
    expect(await quiet(["--out", out])).toBe(0);
    expect(await quiet(["--out", out, "--check"])).toBe(0);
    writeFileSync(out, readFileSync(out, "utf8").replace("| zitadel |", "| hand-edited |"));
    expect(await quiet(["--out", out, "--check"])).toBe(1);
  });

  it("the committed runbook matches its inputs", async () => {
    expect(await quiet(["--check", "--out", join(ROOT, "docs/exit/EXIT_RUNBOOK.md")])).toBe(0);
  });
});
