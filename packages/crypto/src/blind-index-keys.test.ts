import { describe, expect, it } from "vitest";
import type { SecretValue, SecretsPort } from "@infrabyx/contracts/ports";
import { blindIndex } from "./blind-index.js";
import {
  BlindIndexer,
  blindIndexSecretPath,
  loadBlindIndexRoot,
  localBlindIndexRoot,
  tenantBlindIndexKey,
} from "./blind-index-keys.js";
import { toBase64Url, toHex } from "./encoding.js";
import { deriveSubKey } from "./hmac.js";
import { keyMaterial } from "./keys.js";
import { LOCAL_KMS_KEYS, localDevKey } from "./local-kms.js";
import { randomBytes } from "./random.js";

function fakeSecrets(values: Record<string, SecretValue[]>): SecretsPort {
  return {
    descriptor: { port: "SECRETS", adapter: "fake", residency: "IN", maxDataClass: "SECRET" },
    health: async () => ({ status: "up", latency_ms: 0, checked_at: new Date().toISOString() }),
    get: async (path: string, version?: string) => {
      const vs = values[path];
      if (!vs?.length) throw new Error(`no secret at ${path}`);
      const v = version ? vs.find((x) => x.version === version) : vs[vs.length - 1];
      if (!v) throw new Error(`no version ${version}`);
      return v;
    },
    put: async () => ({ version: "1" }),
    rotate: async () => ({ version: "1" }),
    list: async () => [],
    lease: async () => {
      throw new Error("unused");
    },
    audit: async () => [],
  } as unknown as SecretsPort;
}

const PATH = "secrets/prod/kms/blind-index/fbx";

describe("blind-index keys outside test environments (PR-FBX-25, PL1-C-05)", () => {
  it("names one root per product and environment", () => {
    expect(blindIndexSecretPath("prod", "FBX")).toBe(PATH);
    expect(() => blindIndexSecretPath("prod", "../x")).toThrow(/product/);
  });

  it("derives the same tenant key as Finbyx's local shim, so local indexes do not change", () => {
    const shim = deriveSubKey(localDevKey(LOCAL_KMS_KEYS.blindIndex), "fbx/cif/v1/tnt_a");
    const k = tenantBlindIndexKey(localBlindIndexRoot(), {
      product: "FBX",
      scope: "cif",
      tenantId: "tnt_a",
    });
    expect(blindIndex(k, "abcde1234f")).toBe(blindIndex(shim, "abcde1234f"));
  });

  it("keeps tenants, scopes and versions apart", () => {
    const root = localBlindIndexRoot();
    const a = new BlindIndexer({ product: "fbx", scope: "cif", current: root });
    const b = new BlindIndexer({ product: "fbx", scope: "pan", current: root });
    const v2 = new BlindIndexer({
      product: "fbx",
      scope: "cif",
      current: localBlindIndexRoot("2"),
    });
    const x = a.index("tnt_a", "ABCDE1234F").value;
    expect(a.index("tnt_b", "ABCDE1234F").value).not.toBe(x);
    expect(b.index("tnt_a", "ABCDE1234F").value).not.toBe(x);
    expect(v2.index("tnt_a", "ABCDE1234F").value).not.toBe(x);
    expect(a.index("tnt_a", " abcde 1234f ").value).toBe(x);
  });

  it("reads the root from SECRETS, hex or base64url, with its version", async () => {
    const raw = randomBytes(32);
    const s = fakeSecrets({ [PATH]: [{ value: toHex(raw), version: "1", meta: {} }] });
    const root = await loadBlindIndexRoot(s, { appEnv: "prod", product: "fbx" });
    expect(root.version).toBe("1");
    const s2 = fakeSecrets({ [PATH]: [{ value: toBase64Url(raw), version: "1", meta: {} }] });
    const root2 = await loadBlindIndexRoot(s2, { appEnv: "prod", product: "fbx" });
    const i1 = new BlindIndexer({ product: "fbx", scope: "cif", current: root });
    const i2 = new BlindIndexer({ product: "fbx", scope: "cif", current: root2 });
    expect(i1.index("tnt_a", "X").value).toBe(i2.index("tnt_a", "X").value);
    expect(JSON.stringify(root)).not.toContain(toHex(raw));
  });

  it("refuses a dev key, a short key and a non-numeric version", async () => {
    const dev = toHex(new Uint8Array(32));
    const devKey = fakeSecrets({
      [PATH]: [
        {
          value: toHex(keyMaterial(localDevKey(LOCAL_KMS_KEYS.blindIndex))),
          version: "1",
          meta: {},
        },
      ],
    });
    await expect(loadBlindIndexRoot(devKey, { appEnv: "prod", product: "fbx" })).rejects.toThrow(
      /dev key/,
    );
    const short = fakeSecrets({
      [PATH]: [{ value: toHex(randomBytes(16)), version: "1", meta: {} }],
    });
    await expect(loadBlindIndexRoot(short, { appEnv: "prod", product: "fbx" })).rejects.toThrow();
    const opaque = fakeSecrets({
      [PATH]: [{ value: dev.replace(/0/g, "a"), version: "v-abc", meta: {} }],
    });
    await expect(loadBlindIndexRoot(opaque, { appEnv: "prod", product: "fbx" })).rejects.toThrow(
      /positive integer/,
    );
    await expect(
      loadBlindIndexRoot(opaque, { appEnv: "prod", product: "fbx", version: "v-abc" }),
    ).rejects.toThrow(/positive integer/);
  });

  it("rotates: writes under current, looks up under both, flags rows to re-index", async () => {
    const s = fakeSecrets({
      [PATH]: [
        { value: toHex(randomBytes(32)), version: "1", meta: {} },
        { value: toHex(randomBytes(32)), version: "2", meta: {} },
      ],
    });
    const v1 = await loadBlindIndexRoot(s, { appEnv: "prod", product: "fbx", version: "1" });
    const v2 = await loadBlindIndexRoot(s, { appEnv: "prod", product: "fbx" });
    expect(v2.version).toBe("2");
    const before = new BlindIndexer({ product: "fbx", scope: "cif", current: v1 });
    const during = new BlindIndexer({ product: "fbx", scope: "cif", current: v2, previous: v1 });
    const stored = before.index("tnt_a", "ABCDE1234F");
    const c = during.candidates("tnt_a", "ABCDE1234F");
    expect(c.map((x) => x.version)).toEqual(["2", "1"]);
    expect(c[1]).toEqual(stored);
    expect(during.needsReindex(stored)).toBe(true);
    expect(during.needsReindex(during.index("tnt_a", "ABCDE1234F"))).toBe(false);
    expect(
      () => new BlindIndexer({ product: "fbx", scope: "cif", current: v1, previous: v1 }),
    ).toThrow(/same version/);
  });
});
