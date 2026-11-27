// LDC-65 (R1-D-299): the local-file SECRETS adapter runs in local and test only, keeps versions
// across processes in a 0600 file, serialises writers, and never echoes a value.
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ENVS } from "@infrabyx/contracts/env";
import { LOCAL_SECRETS_ENVS, LocalFileSecrets } from "../local-file.js";

const tmpFile = () => join(mkdtempSync(join(tmpdir(), "ldc65-")), "nested", "secrets.json");

describe("LocalFileSecrets (LDC-65)", () => {
  it("is refused in every environment but local and test", () => {
    expect(LOCAL_SECRETS_ENVS).toEqual(["local", "test"]);
    for (const appEnv of APP_ENVS) {
      const make = () => new LocalFileSecrets({ appEnv, file: null });
      if (appEnv === "local" || appEnv === "test") expect(make).not.toThrow();
      else
        expect(make, appEnv).toThrow(
          expect.objectContaining({
            code: "IPB-PORT-001",
            meta: expect.objectContaining({ reason: "local_only", appEnv }),
          }),
        );
    }
  });

  it("keeps versions in the file across instances, as a seed run and a service would", async () => {
    const file = tmpFile();
    const seed = new LocalFileSecrets({ appEnv: "local", file });
    const v1 = await seed.put("secrets/local/seed/admin", "one", { owner: "PLT_SUPER_ADMIN" });
    await seed.rotate("secrets/local/seed/admin", async (c) => `${c.value}-two`);
    const api = new LocalFileSecrets({ appEnv: "local", file });
    expect((await api.get("secrets/local/seed/admin")).value).toBe("one-two");
    expect((await api.get("secrets/local/seed/admin", v1.version)).value).toBe("one");
    expect((await api.get("secrets/local/seed/admin")).meta).toMatchObject({
      owner: "PLT_SUPER_ADMIN",
      dataClass: "SECRET",
    });
    expect(await api.list("secrets/local/seed/")).toEqual(["secrets/local/seed/admin"]);
    expect((await api.audit("secrets/local/seed/admin")).map((a) => a.op)).toEqual([
      "put",
      "get",
      "put",
      "get",
      "get",
      "get",
    ]);
  });

  it("writes the file 0600 in a 0700 directory", async () => {
    const file = tmpFile();
    await new LocalFileSecrets({ appEnv: "test", file }).put("secrets/test/x", "v");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(file, "..")).mode & 0o777).toBe(0o700);
  });

  it("serialises concurrent writers in two instances on one file: no version is lost", async () => {
    const file = tmpFile();
    const a = new LocalFileSecrets({ appEnv: "test", file });
    const b = new LocalFileSecrets({ appEnv: "test", file });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).put("secrets/test/race", `v${i}`)),
    );
    const versions = new Set<string>();
    for (let i = 1; i <= 20; i++) versions.add((await a.get("secrets/test/race", String(i))).value);
    expect(versions.size).toBe(20);
  });

  it("a missing secret is IPB-PORT-001 not_found; a bad path or one outside the prefix is refused", async () => {
    const p = new LocalFileSecrets({ appEnv: "test", file: null, prefix: "secrets/test/" });
    await expect(p.get("secrets/test/none")).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "not_found" },
    });
    await expect(p.put("secrets/test/../x", "v")).rejects.toMatchObject({ code: "IPB-PORT-003" });
    await expect(p.put("secrets/prod/x", "v")).rejects.toMatchObject({ code: "IPB-PORT-003" });
  });

  it("a corrupt file is refused without echoing what it holds", async () => {
    const file = tmpFile();
    await new LocalFileSecrets({ appEnv: "test", file }).put("secrets/test/x", "v");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^\{/, "{oops ") + "sk-live-123");
    const e = await new LocalFileSecrets({ appEnv: "test", file })
      .get("secrets/test/x")
      .catch((x: unknown) => x);
    expect(e).toMatchObject({ code: "IPB-PORT-002", meta: { reason: "corrupt" } });
    expect(JSON.stringify(e) + String(e)).not.toContain("sk-live-123");
  });

  it("memory mode keeps nothing on disk", async () => {
    const p = new LocalFileSecrets({ appEnv: "test", file: null });
    await p.put("secrets/test/m", "v");
    expect((await p.get("secrets/test/m")).value).toBe("v");
    expect((await p.health()).status).toBe("up");
  });
});
