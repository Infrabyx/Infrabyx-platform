// `pnpm check:full` (OWNER-SPEED-01, R1-D-164): the plan covers what CI runs, and the pool keeps
// its bounds.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ciVerifyStepNames,
  contractPorts,
  parseArgs,
  plan,
  readCi,
  runPool,
  summaryTable,
  testImages,
  VERIFY_NOT_LOCAL,
  workspacePackages,
} from "./check-full.mjs";
import { portDir, selectPorts } from "./port-matrix.mjs";

const ci = readCi();
const opts = (argv = []) => parseArgs(argv);

describe("the plan", () => {
  const steps = plan(opts(["--jobs", "4"]), ci);
  const names = steps.map((s) => s.name);

  it("runs every command step of ci.yml's verify job, under CI's own name and in its order", () => {
    const verify = ciVerifyStepNames(ci).filter((n) => !(n in VERIFY_NOT_LOCAL));
    expect(verify.length).toBeGreaterThan(20);
    for (const n of verify) expect(names, n).toContain(n);
    const positions = verify.filter((n) => n !== "Install").map((n) => names.indexOf(n));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("names why each verify step it cannot run is not run, and runs pr-checklist given the PR body", () => {
    for (const n of Object.keys(VERIFY_NOT_LOCAL)) expect(ciVerifyStepNames(ci)).toContain(n);
    const withBody = plan(opts(["--pr-body", "body.md"]), ci).map((s) => s.name);
    for (const n of Object.keys(VERIFY_NOT_LOCAL)) expect(withBody).toContain(n);
  });

  it("runs the contract legs of every port the weekly matrix runs, MinIO for STORAGE", () => {
    const weekly = selectPorts([], {
      all: true,
      has: (p) => existsSync(new URL(`../packages/connectors/src/${portDir(p)}`, import.meta.url)),
    });
    expect(contractPorts()).toEqual(weekly);
    expect(weekly).toEqual(expect.arrayContaining(["STORAGE", "PDF", "AV", "IDENTITY"]));
    const legs = steps.filter((s) => s.group === "contract");
    expect(legs.map((s) => s.cmd)).toEqual(
      weekly.map((p) => `pnpm --filter @infrabyx/connectors test:contract -- --port ${p}`),
    );
    expect(legs.filter((s) => s.resource === "minio").map((s) => s.id)).toEqual([
      "contract-storage",
    ]);
  });

  it("runs every package's test:int and export's golden archive, each on a PostgreSQL of its own", () => {
    const withInt = workspacePackages().filter((p) => p.scripts["test:int"]);
    expect(withInt.length).toBeGreaterThan(15);
    for (const p of withInt) {
      const s = steps.find((x) => x.cmd === `pnpm --filter ${p.name} test:int`);
      expect(s?.resource, p.name).toBe("pg");
    }
    expect(steps.find((s) => s.id === "int-golden")).toMatchObject({
      resource: "pg",
      cmd: "pnpm --filter @infrabyx/export test:golden",
    });
    for (const step of ci.jobs.integration.steps.filter((s) => s.run)) {
      const cmd = step.run.trim();
      if (cmd === "pnpm build" || cmd === "pnpm test:int") continue; // build step; per package above
      const ours = steps.some((s) =>
        s.cmd.includes(cmd.replace("$IPB_TEST_PG_URL", "").split(" --db")[0]),
      );
      expect(ours, step.name).toBe(true);
    }
  });

  it("starts the integration databases from CI's own PostgreSQL image", () => {
    expect(ci.jobs.integration.services.postgres.image).toBe(testImages().pgvector);
  });

  it("needs only steps it has, and starts everything after install", () => {
    const ids = new Set(steps.map((s) => s.id));
    expect(ids.size).toBe(steps.length);
    for (const s of steps) {
      for (const d of s.deps) expect(ids.has(d), `${s.id} -> ${d}`).toBe(true);
      if (s.id !== "install") expect(s.deps.length).toBeGreaterThan(0);
      expect(s.weight).toBeLessThanOrEqual(4);
      expect(s.weight).toBeGreaterThanOrEqual(s.id === "images" ? 0 : 1);
    }
  });

  it("runs every step alone with --sequential, and keeps a lane free beside the build", () => {
    expect(plan(opts(["--sequential"]), ci).every((s) => s.weight === 1)).toBe(true);
    expect(steps.find((s) => s.id === "build").weight).toBe(3);
    expect(steps.find((s) => s.id === "images").weight).toBe(0);
  });

  it("adds the heavy CI jobs only behind their flags", () => {
    expect(steps.some((s) => s.group === "heavy")).toBe(false);
    const heavy = plan(opts(["--with-heavy"]), ci).filter((s) => s.group === "heavy");
    expect(heavy.map((s) => s.id)).toEqual([
      "job-containers",
      "job-compose-reference",
      "job-a11y",
      "job-scaffold",
    ]);
  });

  it("mirrors the no-changeset and export:unchanged labels only when asked", () => {
    const labelled = plan(opts(["--no-changeset", "--export-unchanged"]), ci);
    expect(labelled.find((s) => s.id === "changeset-required").cmd).toMatch(/^echo "not run/);
    expect(labelled.find((s) => s.id === "export-map-gate").cmd).toMatch(/--unchanged-label$/);
    expect(steps.find((s) => s.id === "changeset-required").cmd).toBe(
      'pnpm changeset status --since="origin/main"',
    );
  });
});

describe("parseArgs", () => {
  it("reads the pool size, the base and the flags, and refuses what it does not know", () => {
    expect(parseArgs(["--jobs", "3", "--base", "origin/x"])).toMatchObject({
      jobs: 3,
      base: "origin/x",
    });
    expect(parseArgs(["--sequential"]).jobs).toBe(1);
    expect(() => parseArgs(["--jobs", "0"])).toThrow(/whole number/);
    expect(() => parseArgs(["--skip", "unit"])).toThrow(/unknown option/);
    expect(() => parseArgs(["--base"])).toThrow(/needs a value/);
  });
});

describe("runPool", () => {
  const step = (id, extra = {}) => ({ id, name: id, deps: [], weight: 1, est: 1, ...extra });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  it("never runs more than `jobs` of weight at once, and never two holders of one lock", async () => {
    let load = 0;
    let peak = 0;
    const lockHeld = new Set();
    const steps = [
      step("a", { weight: 2 }),
      step("b"),
      step("c"),
      step("d", { lock: "x" }),
      step("e", { lock: "x" }),
      step("f", { weight: 3 }),
    ];
    const r = await runPool(steps, {
      jobs: 3,
      exec: async (s) => {
        if (s.lock) {
          expect(lockHeld.has(s.lock)).toBe(false);
          lockHeld.add(s.lock);
        }
        load += s.weight;
        peak = Math.max(peak, load);
        await sleep(20);
        load -= s.weight;
        if (s.lock) lockHeld.delete(s.lock);
        return { ok: true };
      },
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(r.every((x) => x.status === "pass")).toBe(true);
  });

  it("blocks the steps after a failure, reports a soft failure as a warning, and runs the rest", async () => {
    const r = await runPool(
      [
        step("build"),
        step("unit", { deps: ["build"] }),
        step("after-unit", { deps: ["unit"] }),
        step("images", { soft: true }),
        step("lint"),
        step("needs-images", { deps: ["images"] }),
      ],
      { jobs: 2, exec: async (s) => ({ ok: !["build", "images"].includes(s.id) }) },
    );
    const status = Object.fromEntries(r.map((x) => [x.step.id, x.status]));
    expect(status).toEqual({
      build: "fail",
      unit: "blocked",
      "after-unit": "blocked",
      images: "warn",
      lint: "pass",
      "needs-images": "pass",
    });
    expect(summaryTable(r, 1000)).toMatch(
      /2 passed, 1 failed, 2 blocked, 1 warnings; wall time 1s$/,
    );
  });

  const order = async (steps, extra) => {
    const started = [];
    await runPool(steps, {
      jobs: 2,
      exec: async (s) => {
        started.push(s.id);
        await sleep(10);
        return { ok: true };
      },
      ...extra,
    });
    return started;
  };
  const mix = () => [
    step("short", { est: 1 }),
    step("long", { est: 100 }),
    step("heavy", { est: 50, weight: 2 }),
    step("tiny", { est: 0.1 }),
  ];

  it("starts the longest ready step first, and lets a step that ends in time use a lane a heavy one cannot", async () => {
    expect(await order(mix(), {})).toEqual(["long", "short", "tiny", "heavy"]);
  });

  it("starts nothing ahead of a waiting heavy step that would end after the room it waits for", async () => {
    // `running` is expected to end in 1 s; `late` (3 s) would hold a lane past it, so it waits.
    const started = [];
    await runPool(
      [
        step("running", { est: 1 }),
        step("gate", { est: 0 }),
        step("heavy", { est: 5, weight: 2, deps: ["gate"] }),
        step("late", { est: 3, deps: ["gate"] }),
      ],
      {
        jobs: 2,
        exec: async (s) => {
          started.push(s.id);
          await sleep(s.id === "running" ? 40 : 5);
          return { ok: true };
        },
      },
    );
    expect(started).toEqual(["running", "gate", "heavy", "late"]);
  });

  it("always has room for a step of weight 0 (network-bound)", async () => {
    const started = await order(
      [step("cpu", { weight: 2, est: 9 }), step("net", { weight: 0 })],
      {},
    );
    expect(started).toEqual(["cpu", "net"]);
  });

  it("keeps the order of definition when it runs one step at a time", async () => {
    const started = [];
    await runPool([step("a", { est: 1 }), step("b", { est: 9 }), step("c", { est: 5 })], {
      jobs: 1,
      exec: async (s) => (started.push(s.id), { ok: true }),
    });
    expect(started).toEqual(["a", "b", "c"]);
  });

  it("refuses a step that needs a step the plan does not have", async () => {
    await expect(
      runPool([step("a", { deps: ["nope"] })], { jobs: 1, exec: async () => ({ ok: true }) }),
    ).rejects.toThrow(/unknown step nope/);
  });
});
