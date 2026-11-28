// Seed persona roles contract cases (LDC-69, R1-D-325). A product runs them with its own
// `seedAdapters.personaRoles` to prove its seed personas carry its roles end to end:
//   - the roles are accepted (each `<PRODUCT>_…`, never on a platform persona, at most 8, unique);
//   - each named persona is seeded with its platform role, then its product roles;
//   - a credentials run provisions every persona with exactly those roles in the identity
//     provider, and the credentials file lists them and passes `checkCredentialsFile`;
//   - another product's role, an ORG_ or PLT_ role, and a product role on a platform persona are
//     each refused (IPB-SEED-003) before anything is written.
// Synthetic only: the in-memory SECRETS and IDENTITY fakes and a temporary file.
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import type { ProductCode } from "@infrabyx/contracts/env";
import { MemoryIdentity, MemorySecrets } from "@infrabyx/fakes";
import {
  checkCredentialsFile,
  generateCredentials,
  personaRoleProblems,
  personaRolesOf,
  personasFor,
  seedPersonas,
  type PersonaRoles,
} from "@infrabyx/seed";

export interface SeedPersonaRoleCase {
  name: string;
  run(): Promise<void>;
}

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return null;
};

export function seedPersonaRoleContractCases(
  product: ProductCode,
  personaRoles: PersonaRoles,
): SeedPersonaRoleCase[] {
  const keys = Object.keys(personaRoles);
  return [
    {
      name: "the product's persona roles are accepted (LDC-69)",
      async run() {
        expect(keys.length).toBeGreaterThan(0);
        expect(personaRoleProblems(product, personaRoles)).toEqual([]);
      },
    },
    {
      name: "each named persona is seeded with its platform role, then its product roles (LDC-69)",
      async run() {
        const ps = seedPersonas({ product, personaRoles });
        for (const k of keys) {
          const p = ps.find((x) => x.key === k)!;
          expect(personaRolesOf(p)).toEqual([p.role, ...personaRoles[k]!]);
        }
        // Personas the product names no roles for are unchanged.
        const plain = personasFor(product).filter((p) => !keys.includes(p.key));
        for (const p of plain)
          expect(ps.find((x) => x.key === p.key)!.productRoles).toBeUndefined();
      },
    },
    {
      name: "a credentials run provisions every persona with exactly its roles and lists them (LDC-69)",
      async run() {
        const dir = await mkdtemp(join(tmpdir(), "seed-roles-"));
        const identity = new MemoryIdentity();
        const filePath = join(dir, "SEED_CREDENTIALS.md");
        await generateCredentials({
          env: { APP_ENV: "dev", SEED_ENABLED: true },
          product,
          personaRoles,
          secrets: new MemorySecrets(),
          identity,
          vaultPrefix: `secret://env/infrabyx/${product.toLowerCase()}/dev/seed`,
          hashListPath: "infrabyx/_seed/password-hashes",
          filePath,
          runId: "run_01JTEST0000000000000000000",
          repoRoot: dir,
          out: () => undefined,
        });
        for (const p of seedPersonas({ product, personaRoles })) {
          if (p.role === "PLT_SUPER_ADMIN") continue;
          expect(identity.users.get(p.email)?.roles).toEqual(personaRolesOf(p));
        }
        const text = await readFile(filePath, "utf8");
        expect(checkCredentialsFile(text, product, undefined, personaRoles)).toEqual([]);
        // Without the roles the same file no longer matches: the roles are really in it.
        expect(checkCredentialsFile(text, product).length).toBeGreaterThan(0);
      },
    },
    {
      name: "another product's role, an ORG_ or PLT_ role, and a role on a platform persona are refused (LDC-69)",
      async run() {
        const k = keys[0]!;
        const other = product === "LDC" ? "FBX" : "LDC";
        for (const bad of [`${other}_SOMETHING`, "ORG_ADMIN", "PLT_SUPER_ADMIN", "lower_case"])
          expect(code(() => personasFor(product, undefined, { [k]: [bad] }))).toBe("IPB-SEED-003");
        expect(
          code(() => personasFor(product, undefined, { plt_security: [`${product}_X`] })),
        ).toBe("IPB-SEED-003");
        expect(
          code(() => personasFor(product, undefined, { "no.such.persona": [`${product}_X`] })),
        ).toBe("IPB-SEED-003");
        const many = Array.from({ length: 9 }, (_, i) => `${product}_R${i}`);
        expect(code(() => personasFor(product, undefined, { [k]: many }))).toBe("IPB-SEED-003");
      },
    },
  ];
}
