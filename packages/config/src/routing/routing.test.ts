import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envFromRoutingPath, loadRoutingFile, loadUnprovenAdapters } from "./index.js";
import { main } from "./cli.js";

const repo = new URL("../../../../", import.meta.url);
const reference = (f: string) => new URL(`infra/routing/reference/${f}`, repo).pathname;
const status = new URL("packages/connectors/sandbox-status.json", repo).pathname;

describe("@IPB-01-20 routing files load and refuse invalid ones", () => {
  it("derives the env from the file name and refuses other names", () => {
    expect(envFromRoutingPath("infra/routing/fbx/prod.routing.yaml")).toBe("prod");
    expect(() => envFromRoutingPath("prod.yaml")).toThrow(
      expect.objectContaining({ code: "IPB-PORT-005" }),
    );
  });

  it("the reference local and ci files validate", async () => {
    for (const f of ["local.routing.yaml", "ci.routing.yaml"]) {
      const r = await loadRoutingFile(reference(f));
      expect(r.file.version).toBe(1);
    }
  });

  it("a deliberately broken file fails with IPB-PORT-005 (@IPB-01-AT-07)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "routing-"));
    const bad = join(dir, "dev.routing.yaml");
    await writeFile(
      bad,
      [
        "version: 1",
        "ports:",
        "  PAYMENTS:",
        "    primary: { adapter: razorpay, residency: IN, max_data_class: REGULATED }",
        "    secondary: { adapter: stripe, residency: GLOBAL, max_data_class: INTERNAL, mode: active_failover }",
      ].join("\n"),
    );
    await expect(loadRoutingFile(bad)).rejects.toMatchObject({ code: "IPB-PORT-005" });
    const err = (await loadRoutingFile(bad).catch((e: unknown) => e)) as {
      meta: { problems: string[] };
    };
    expect(err.meta.problems.join()).toMatch(/crosses residency/);
  });

  it("unproven adapters from sandbox-status.json are refused in staging (IPB-DEV-04)", async () => {
    const unproven = await loadUnprovenAdapters(status);
    expect(unproven.has("razorpay")).toBe(true);
    const dir = await mkdtemp(join(tmpdir(), "routing-"));
    const f = join(dir, "staging.routing.yaml");
    await writeFile(
      f,
      "version: 1\nports:\n  PAYMENTS:\n    primary: { adapter: razorpay, residency: IN, max_data_class: REGULATED }\n",
    );
    await expect(loadRoutingFile(f, { unprovenAdapters: unproven })).rejects.toMatchObject({
      code: "IPB-PORT-005",
    });
  });

  it("the CLI exits 0 for valid files and 1 for invalid ones", async () => {
    expect(await main(["check", reference("ci.routing.yaml"), "--sandbox-status", status])).toBe(0);
    const dir = await mkdtemp(join(tmpdir(), "routing-"));
    const f = join(dir, "dev.routing.yaml");
    await writeFile(f, "version: 1\nports:\n  STORAGE: {}\n");
    expect(await main(["check", f])).toBe(1);
    expect(await main([])).toBe(2);
  });
});
