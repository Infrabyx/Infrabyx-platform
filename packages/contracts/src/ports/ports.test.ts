import { describe, expect, it } from "vitest";
import { isValidStorageKey, storageKey } from "./storage.js";
import { parseSecretRef, isSecretRef } from "./secrets.js";
import { PORT_CATALOGUE, PORT_NAMES } from "./catalogue.js";
import { VerifiedClaims } from "./identity.js";

describe("ports", () => {
  it("formats storage keys as tenant/<tid>/<module>/<ulid> (IPB-01-27)", () => {
    const k = storageKey(
      "tnt_01H00000000000000000000000",
      "audit",
      "01J9ZC9Q2K7M8N3P4R5S6T7V8W",
      "json",
    );
    expect(k).toBe("tenant/tnt_01H00000000000000000000000/audit/01J9ZC9Q2K7M8N3P4R5S6T7V8W.json");
    expect(isValidStorageKey("s3://bucket/tenant/x")).toBe(false);
    expect(isValidStorageKey("tenant/tnt_platform/audit/01J9ZC9Q2K7M8N3P4R5S6T7V8W")).toBe(true);
  });
  it("parses secret references (IPB-11 §11.2)", () => {
    expect(parseSecretRef("secret://aws-sm/infrabyx/fbx/prod/db#password")).toEqual({
      adapter: "aws-sm",
      path: "infrabyx/fbx/prod/db",
      key: "password",
    });
    expect(isSecretRef("app")).toBe(false);
    expect(parseSecretRef("secret://aws-sm/no-key")).toBeNull();
  });
  it("catalogues the 42 primary ports plus supplementary ports, with interfaces for the five PL1 ports", () => {
    expect(PORT_NAMES.length).toBeGreaterThanOrEqual(55);
    const defined = PORT_NAMES.filter((p) => PORT_CATALOGUE[p].interfaceDefined).sort();
    expect(defined).toEqual(["FEATURE_FLAG", "IDENTITY", "KMS", "SECRETS", "STORAGE"]);
  });
  it("parses verified claims with act and bg", () => {
    const c = VerifiedClaims.parse({
      sub: "usr_1",
      tid: "tnt_platform",
      typ: "user",
      roles: ["PLT_SUPER_ADMIN"],
      act: { sub: "usr_2", sid: "imp_1" },
      exp: 2,
      iat: 1,
    });
    expect(c.act?.sub).toBe("usr_2");
  });
});
