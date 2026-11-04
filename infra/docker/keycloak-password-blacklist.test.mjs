// The Keycloak customer image's breached-password list (LawDocsComply PR-LDC-04, R1-D-83): the
// bundled file is well formed and matches the source and checksum its README records, the image
// copies it where Keycloak's `passwordBlacklist` policy looks it up, nothing is fetched at build or
// run time, and the realm option in @infrabyx/connectors names the same file. Static checks; the
// IDENTITY contract leg proves the policy on the built image.
// A file checksum in a repository check, outside the workspace packages; no key material.
// eslint-disable-next-line ipb/no-direct-crypto
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const IMAGE = join(ROOT, "infra/keycloak/customer-otp");
const LISTS = join(IMAGE, "password-blacklists");
const FILE = "ipb-common-passwords.txt";
const SHA256 = "ec8c0a3e04cb76025fbb33469bd8e5b35def58cc913649e548237ffed657a4eb";
const SOURCE_SHA256 = "424a3e03a17df0a2bc2b3ca749d81b04e79d59cb7aeec8876a5a3f308d0caf51";
const read = (...p) => readFileSync(join(...p), "utf8");

describe("Keycloak breached-password list (PR-LDC-04, R1-D-83)", () => {
  const bytes = readFileSync(join(LISTS, FILE));
  const text = bytes.toString("utf8");
  const lines = text.split("\n").slice(0, -1);

  it("is 10,000 unique lower-case passwords of 12 or more printable ASCII characters, one per line", () => {
    expect(text.endsWith("\n")).toBe(true);
    expect(lines).toHaveLength(10_000);
    expect(new Set(lines).size).toBe(10_000);
    expect(lines.filter((l) => !/^[ -~]{12,}$/.test(l) || l !== l.toLowerCase())).toEqual([]);
  });

  it("matches the checksum, source and MIT licence its README records", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(SHA256);
    const readme = read(LISTS, "README.md");
    for (const s of [SHA256, SOURCE_SHA256, "SecLists", "MIT", "LICENSE.SecLists", "10,000"])
      expect(readme).toContain(s);
    const licence = read(LISTS, "LICENSE.SecLists");
    expect(licence).toMatch(/^MIT License\n\nCopyright \(c\) 2018 Daniel Miessler\n/);
    expect(licence).toContain("The above copyright notice and this permission notice shall be");
  });

  it("is copied into the image where Keycloak looks lists up, with its licence, and nothing is fetched", () => {
    const dockerfile = read(IMAGE, "Dockerfile");
    expect(dockerfile).toContain(
      `password-blacklists/${FILE} /opt/keycloak/data/password-blacklists/${FILE}`,
    );
    expect(dockerfile).toContain("password-blacklists/LICENSE.SecLists");
    expect(dockerfile).not.toMatch(/\b(curl|wget)\b|^\s*ADD\s+https?:/im);
    expect(read(ROOT, "infra/docker/BASE_IMAGES.md")).toContain(FILE);
  });

  it("is the file the realm option names (@infrabyx/connectors KEYCLOAK_PASSWORD_BLACKLIST)", () => {
    const src = read(ROOT, "packages/connectors/src/identity/keycloak.ts");
    expect(src).toContain(`export const KEYCLOAK_PASSWORD_BLACKLIST = "${FILE}";`);
    expect(src).toContain("and passwordBlacklist(${passwordBlacklist})");
  });
});
