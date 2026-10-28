import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { IpbError } from "@infrabyx/contracts/errors";
import { PRODUCTS } from "@infrabyx/contracts/env";
import { checkCredentialsFile, generateCredentials } from "./credentials.js";
import { seededFaker } from "./framework.js";
import { assertSeedAllowed } from "./guard.js";
import { COMMON_PERSONAS, SUPER_ADMIN_EMAIL, personaEmail, personasFor } from "./personas/index.js";
import { findRealIdentifiers, gstinCheckChar, synthetic, verhoeffValid } from "./synthetic.js";
import { connectionConfig, main, scaffoldedProduct } from "./cli.js";
import { MemoryIdentity, MemorySecrets } from "./__tests__/fakes.js";

const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as IpbError).code;
  }
};

describe("@IPB-11-AT-05 synthetic identifiers only", () => {
  it("generated values pass the validator; Aadhaar-like values start 9999 and fail Verhoeff; PAN-like have Z fourth", () => {
    const f = seededFaker(20261025, "t");
    const values = Array.from({ length: 500 }, () => ({
      aadhaar: synthetic.aadhaar(f),
      pan: synthetic.pan(f),
      ifsc: synthetic.ifsc(f),
      mobile: synthetic.mobile(f),
      gstin: synthetic.gstin(f),
      cin: synthetic.cin(f),
      email: `${f.internet.username().toLowerCase()}@finbyx.test`,
    }));
    expect(findRealIdentifiers(values)).toEqual([]);
    for (const v of values) {
      expect(v.aadhaar.startsWith("9999")).toBe(true);
      expect(verhoeffValid(v.aadhaar.replace(/\s/g, ""))).toBe(false);
      expect(v.pan[3]).toBe("Z");
      expect(gstinCheckChar(v.gstin.slice(0, 14))).not.toBe(v.gstin[14]);
    }
  });
  it("flags values that look real", () => {
    const realAadhaarShape = (() => {
      for (let i = 0; ; i++) {
        const n = `23456789${String(i).padStart(4, "0")}`;
        if (verhoeffValid(n)) return n;
      }
    })();
    const first14 = "27ABCDE1234F1Z";
    const kinds = findRealIdentifiers({
      a: realAadhaarShape,
      p: "ABCDE1234F",
      g: first14 + gstinCheckChar(first14),
      c: "U12345MH2020PTC123456",
      i: "HDFC0001234",
      m: "+91 98765 43210",
      e: "someone@gmail.com",
      ok: SUPER_ADMIN_EMAIL,
    }).map((v) => v.kind);
    expect(kinds.sort()).toEqual(["aadhaar", "cin", "email", "gstin", "ifsc", "mobile", "pan"]);
  });
  it("only the configured super-admin address (AUTH_SUPER_ADMIN_EMAIL) may be a real address", () => {
    const configured = "owner@example.com";
    expect(SUPER_ADMIN_EMAIL).toMatch(/@example\.test$/);
    expect(findRealIdentifiers({ e: configured }).map((v) => v.kind)).toEqual(["email"]);
    expect(findRealIdentifiers({ e: configured }, "$", new Set([configured]))).toEqual([]);
    expect(
      findRealIdentifiers({ e: "other@example.com" }, "$", new Set([configured])).map(
        (v) => v.kind,
      ),
    ).toEqual(["email"]);
  });
  it("faker is deterministic per seed and module (IPB-11-23)", () => {
    expect(seededFaker(7, "cases").person.fullName()).toBe(
      seededFaker(7, "cases").person.fullName(),
    );
    expect(seededFaker(7, "cases").string.alphanumeric(20)).not.toBe(
      seededFaker(7, "billing").string.alphanumeric(20),
    );
  });
});

describe("@IPB-11-AT-02 @IPB-11-14 seeds refuse production", () => {
  it("refuses prod, dr and pre-prod and requires SEED_ENABLED=true; load needs confirmation", () => {
    for (const e of ["prod", "dr", "pre-prod"] as const)
      expect(code(() => assertSeedAllowed({ APP_ENV: e, SEED_ENABLED: true }))).toBe(
        "IPB-SEED-001",
      );
    expect(code(() => assertSeedAllowed({ APP_ENV: "dev" }))).toBe("IPB-SEED-001");
    expect(code(() => assertSeedAllowed({ APP_ENV: "dev", SEED_ENABLED: true }, "load"))).toBe(
      "IPB-SEED-002",
    );
    expect(
      code(() =>
        assertSeedAllowed({ APP_ENV: "dev", SEED_ENABLED: true, SEED_LOAD_CONFIRM: "yes" }, "load"),
      ),
    ).toBeNull();
  });
  it("the CLI exits 1 with IPB-SEED-001 and emits SeedRefused before reading anything else", async () => {
    const err: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((s) => (err.push(String(s)), true));
    const rc = await main(["--profile", "demo"], {
      APP_ENV: "prod",
      APP_PRODUCT: "LDC",
      SEED_ENABLED: "true",
    });
    spy.mockRestore();
    expect(rc).toBe(1);
    expect(err.join("")).toContain("IPB-SEED-001");
    expect(err.join("")).toContain("in.ldc.seed.SeedRefused.v1");
  });
});

describe("the seed CLI's product and connection (PR-FBX-04 note, PR-FBX-07)", () => {
  const refusal = async (cwd: string) => {
    const err: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((s) => (err.push(String(s)), true));
    const was = process.cwd();
    process.chdir(cwd);
    try {
      // Without SEED_ENABLED a dev run is refused, and APP_PRODUCT is optional there.
      expect(await main(["--profile", "dev"], { APP_ENV: "dev" })).toBe(1);
    } finally {
      process.chdir(was);
      spy.mockRestore();
    }
    return err.join("");
  };

  it("reports a refusal without APP_PRODUCT as the scaffolded product, else unknown, never LD", async () => {
    const root = mkdtempSync(join(tmpdir(), "seed-product-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ infrabyx: { product: "FBX" } }));
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    writeFileSync(join(root, "apps", "api", "package.json"), JSON.stringify({ name: "@fbx/api" }));
    expect(scaffoldedProduct(join(root, "apps", "api"))).toBe("FBX");
    expect(await refusal(join(root, "apps", "api"))).toContain("in.fbx.seed.SeedRefused.v1");
    const bare = mkdtempSync(join(tmpdir(), "seed-bare-"));
    expect(scaffoldedProduct(bare)).toBeUndefined();
    const out = await refusal(bare);
    expect(out).toContain("in.unknown.seed.SeedRefused.v1");
    expect(out).not.toContain("in.ld.");
    writeFileSync(join(bare, "package.json"), JSON.stringify({ infrabyx: { product: "XX" } }));
    expect(scaffoldedProduct(bare)).toBeUndefined();
  });

  it("puts DB_PASSWORD into the URL, percent-encoded, as pg decodes it", () => {
    const pw = "p@ss:w/rd%41 é#?";
    const { connectionString } = connectionConfig("postgres://app@db.example.test:5432/fbx", pw);
    const u = new URL(connectionString);
    expect(u.username).toBe("app");
    expect(decodeURIComponent(u.password)).toBe(pw);
    expect(u.pathname).toBe("/fbx");
    expect(connectionConfig("postgres://app@h/db")).toEqual({
      connectionString: "postgres://app@h/db",
    });
    expect(
      new URL(connectionConfig("postgres://app:old@h/db", "new").connectionString).password,
    ).toBe("new");
  });
});

describe("personas (IPB-11 §11.4.5, IPB-11-33)", () => {
  it("the super admin takes AUTH_SUPER_ADMIN_EMAIL when given and the placeholder otherwise", () => {
    const admin = (email?: string) =>
      personasFor("LDC", email).find((x) => x.key === "super_admin")!;
    expect(personaEmail(admin(), "LDC")).toBe(SUPER_ADMIN_EMAIL);
    expect(personaEmail(admin("owner@example.com"), "LDC")).toBe("owner@example.com");
    expect(COMMON_PERSONAS.find((x) => x.key === "super_admin")?.email).toBe(SUPER_ADMIN_EMAIL);
  });
  it("every product has the common personas plus its own; emails follow test.<persona>@<product>.test", () => {
    for (const p of PRODUCTS) {
      const list = personasFor(p);
      expect(list.slice(0, COMMON_PERSONAS.length)).toEqual(COMMON_PERSONAS);
      expect(new Set(list.map((x) => x.key)).size).toBe(list.length);
      for (const x of list) {
        const email = personaEmail(x, p);
        if (x.key === "super_admin") expect(email).toBe(SUPER_ADMIN_EMAIL);
        else
          expect(email).toMatch(
            /^test\.[a-z0-9_.]+@(lawdocs|ldc|equator|finbyx|udofin|ophub)\.test$/,
          );
        expect(x.role.startsWith("AGT_")).toBe(false);
      }
    }
  });
  it("@IPB-11-AT-03 the super admin is PLT_SUPER_ADMIN in the platform tenant with MFA always on", () => {
    expect(COMMON_PERSONAS[0]).toMatchObject({
      role: "PLT_SUPER_ADMIN",
      tenant: "platform",
      email: SUPER_ADMIN_EMAIL,
      mfaAlways: true,
    });
  });
});

describe("@IPB-11-AT-04 seed credentials never reach logs or git", () => {
  async function run(over: Partial<Parameters<typeof generateCredentials>[0]> = {}) {
    const dir = await mkdtemp(join(tmpdir(), "seedcred-"));
    const secrets = new MemorySecrets();
    const identity = new MemoryIdentity();
    const out: string[] = [];
    const generated: unknown[] = [];
    const filePath = join(dir, "SEED_CREDENTIALS.md");
    const res = await generateCredentials({
      env: { APP_ENV: "dev", SEED_ENABLED: true },
      product: "FBX",
      secrets,
      identity,
      vaultPrefix: "secret://env/infrabyx/fbx/dev/seed",
      hashListPath: "infrabyx/_seed/password-hashes",
      filePath,
      runId: "run_01JTEST0000000000000000000",
      repoRoot: dir,
      out: (l) => out.push(l),
      onGenerated: (d) => generated.push(d),
      ...over,
    });
    return { dir, secrets, identity, out, generated, filePath, res };
  }
  it("writes a 0600 file, one vault entry per persona, one stdout line and no password anywhere else", async () => {
    const r = await run();
    const personas = personasFor("FBX");
    expect((await stat(r.filePath)).mode & 0o777).toBe(0o600);
    const passwords = personas.map(
      (p) => r.secrets.store.get(`infrabyx/fbx/dev/seed/${p.key}`)?.[0]?.value ?? "",
    );
    expect(passwords.every((p) => p.length >= 24)).toBe(true);
    expect(new Set(passwords).size).toBe(personas.length);
    expect(r.out.length).toBe(1);
    expect(r.out[0]).toMatch(
      /^Wrote 20 credentials to .*SEED_CREDENTIALS\.md \(run run_01JTEST0000000000000000000\)$/,
    );
    expect(
      passwords.some((p) => r.out[0]?.includes(p) || JSON.stringify(r.generated).includes(p)),
    ).toBe(false);
    const text = await readFile(r.filePath, "utf8");
    expect(passwords.every((p) => text.includes(p))).toBe(true);
    expect(checkCredentialsFile(text, "FBX")).toEqual([]);
    expect(/\| AGT_VIDHI \| [^|]+ \| [^|]+ \|$/m.test(text)).toBe(true);
    expect(
      text.split("\n").some((l) => l.includes("AGT_") && passwords.some((p) => l.includes(p))),
    ).toBe(false);
    expect(await readFile(join(r.dir, ".git", "info", "exclude"), "utf8")).toContain(
      "SEED_CREDENTIALS.md",
    );
    expect(r.identity.users.get(SUPER_ADMIN_EMAIL)?.mfaRequired).toBe(true);
    expect(r.identity.users.get("test.member@finbyx.test")?.mfaRequired).toBe(false);
    expect(r.generated).toEqual([
      { run_id: "run_01JTEST0000000000000000000", count: 20, rotated: false },
    ]);
  });
  it("--no-file stores only in the vault; rotation produces new unique passwords", async () => {
    const r = await run({ noFile: true });
    expect(r.res.path).toBeNull();
    await expect(stat(r.filePath)).rejects.toThrow();
    const first = r.secrets.store.get("infrabyx/fbx/dev/seed/test.admin")?.[0]?.value;
    await generateCredentials({
      env: { APP_ENV: "dev", SEED_ENABLED: true },
      product: "FBX",
      secrets: r.secrets,
      identity: r.identity,
      vaultPrefix: "secret://env/infrabyx/fbx/dev/seed",
      hashListPath: "infrabyx/_seed/password-hashes",
      filePath: r.filePath,
      runId: "run_01JTEST0000000000000000001",
      noFile: true,
      rotate: true,
      out: () => undefined,
    });
    const second = r.secrets.store.get("infrabyx/fbx/dev/seed/test.admin")?.[1]?.value;
    expect(second !== undefined && second !== first).toBe(true);
    const hashes = JSON.parse(
      r.secrets.store.get("infrabyx/_seed/password-hashes")?.at(-1)?.value ?? "{}",
    ) as { hashes: string[] };
    expect(new Set(hashes.hashes).size).toBe(40);
  });
  it("forces a password change and MFA in staging/demo; refuses prod, dr, pre-prod; vault failure writes no file", async () => {
    const r = await run({ env: { APP_ENV: "staging", SEED_ENABLED: true } });
    expect(r.identity.users.get("test.member@finbyx.test")).toMatchObject({
      mfaRequired: true,
      password: { temporary: true },
    });
    for (const e of ["prod", "dr", "pre-prod"] as const) {
      expect(
        await run({ env: { APP_ENV: e, SEED_ENABLED: true } }).then(
          () => null,
          (x: IpbError) => x.code,
        ),
      ).toBe("IPB-SEED-001");
    }
    const failing = new MemorySecrets();
    failing.failWrites = true;
    const dir = await mkdtemp(join(tmpdir(), "seedcred-"));
    const c = await generateCredentials({
      env: { APP_ENV: "dev", SEED_ENABLED: true },
      product: "LD",
      secrets: failing,
      identity: new MemoryIdentity(),
      vaultPrefix: "secret://env/x/seed",
      hashListPath: "h",
      filePath: join(dir, "S.md"),
      runId: "run_x",
      out: () => undefined,
    }).then(
      () => null,
      (x: IpbError) => x.code,
    );
    expect(c).toBe("IPB-SEED-006");
    await expect(stat(join(dir, "S.md"))).rejects.toThrow();
  });
});
