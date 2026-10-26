import { describe, expect, it } from "vitest";
import type { IpbError } from "@infrabyx/contracts/errors";
import type { VerifiedClaims } from "@infrabyx/contracts/ports";
import { LocalKms, localTenantKeyId } from "@infrabyx/crypto";
import { contextFromClaims, currentContext, runWithContext } from "./context.js";
import { rlsPolicySql, dataClassCommentsSql } from "./drizzle/index.js";
import { FieldCrypto } from "./field-crypto.js";
import { assertAllowedStatement, assertMayMutate } from "./kernel.js";
import { mask } from "./mask.js";
import { TenantContextInterceptor } from "./nest/index.js";

const claims = (over: Partial<VerifiedClaims> = {}): VerifiedClaims => ({
  sub: "usr_a",
  tid: "tnt_a",
  typ: "user",
  roles: ["ORG_ADMIN"],
  exp: 2_000_000_000,
  iat: 1_900_000_000,
  ...over,
});
const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as IpbError).code ?? (e as Error).name;
  }
};

describe("@IPB-02-AT-04 @NN-01 context comes from verified claims only (IPB-02-13)", () => {
  it("the Nest interceptor ignores X-Tenant-Id and uses the token tenant", async () => {
    const req = {
      verifiedClaims: claims(),
      headers: {
        "x-tenant-id": "tnt_b",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
    };
    const http = { switchToHttp: () => ({ getRequest: () => req }) };
    const seen: Array<string | undefined> = [];
    const next = {
      handle: () => ({
        subscribe: (s: { complete: () => void }) => (
          seen.push(currentContext()?.tenantId, currentContext()?.traceId),
          s.complete(),
          { unsubscribe() {} }
        ),
      }),
    };
    await new Promise<void>((done) =>
      new TenantContextInterceptor()
        .intercept(http as never, next as never)
        .subscribe({ complete: done }),
    );
    expect(seen).toEqual(["tnt_a", "4bf92f3577b34da6a3ce929d0e0e4736"]);
  });
  it("requests without verified claims are refused", () => {
    const http = {
      switchToHttp: () => ({ getRequest: () => ({ headers: { "x-tenant-id": "tnt_b" } }) }),
    };
    expect(() => new TenantContextInterceptor().intercept(http as never, {} as never)).toThrow(
      /Unauthorized/,
    );
  });
  it("maps act and bg claims and refuses a platform scope without a PLT_* role", () => {
    const c = contextFromClaims(claims({ act: { sub: "usr_staff", sid: "imp_1" }, bg: "bgr_1" }));
    expect(c).toMatchObject({
      act: { sub: "usr_staff", sessionId: "imp_1" },
      breakGlassGrantId: "bgr_1",
    });
    expect(code(() => contextFromClaims(claims(), { scope: "platform" }))).toBe("IPB-SEC-005");
    expect(
      code(() =>
        contextFromClaims(claims({ typ: "agent", roles: ["AGT_VIDHI", "PLT_SUPER_ADMIN"] }), {
          scope: "platform",
        }),
      ),
    ).toBe("IPB-SEC-005");
    expect(
      runWithContext(
        contextFromClaims(claims({ roles: ["PLT_SUPER_ADMIN"] }), { scope: "platform" }),
        () => currentContext()?.scope,
      ),
    ).toBe("platform");
  });
});

describe("kernel guards", () => {
  it("refuses session-level SET, app.* writes, role switches and transaction control", () => {
    for (const s of [
      "set app.tenant_id = 'tnt_b'",
      "SET search_path = public",
      "reset role",
      "set local role postgres",
      "set local app.tenant_id = 'tnt_b'",
      "select set_config('app.tenant_id', 'tnt_b', true)",
      "select set_config('statement_timeout', '0', false)",
      "set local session_replication_role = replica",
      "commit",
    ]) {
      expect(
        code(() => assertAllowedStatement(s)),
        s,
      ).toBe("KernelGuardError");
    }
    expect(code(() => assertAllowedStatement("set local statement_timeout = '5s'"))).toBeNull();
    expect(code(() => assertAllowedStatement("select * from tenancy.tenant"))).toBeNull();
  });
  it("@IPB-02-AT-08 refuses any mutation during impersonation (IPB-SEC-003)", () => {
    const ctx = contextFromClaims(claims({ act: { sub: "usr_staff", sid: "imp_1" } }));
    expect(code(() => assertMayMutate(ctx, { action: "documents.document.create" }))).toBe(
      "IPB-SEC-003",
    );
  });
  it("@IPB-02-AT-11 agents never approve, sign, disburse, delete or grant (IPB-SEC-004)", () => {
    const agent = contextFromClaims(
      claims({ typ: "agent", sub: "agt_vidhi", roles: ["AGT_VIDHI", "ORG_CHECKER"] }),
    );
    for (const verb of ["approve", "sign", "disburse", "delete", "grant"]) {
      expect(code(() => assertMayMutate(agent, { action: `x.y.${verb}` }))).toBe("IPB-SEC-004");
    }
    expect(code(() => assertMayMutate(agent, { action: "documents.draft.create" }))).toBeNull();
    const roleOnly = contextFromClaims(claims({ roles: ["AGT_VIDHI"] }));
    expect(code(() => assertMayMutate(roleOnly, { action: "approvals.request.approve" }))).toBe(
      "IPB-SEC-004",
    );
  });
});

describe("masking (IPB-02 §02.4.3.3)", () => {
  it("applies the shared rules", () => {
    expect(mask("aadhaar", "9999 1234 5678")).toBe("XXXX XXXX 5678");
    expect(mask("pan", "ABCDE1234F")).toBe("ABCXX1234X");
    expect(mask("bank_account", "001234567890")).toBe("XXXX7890");
    expect(mask("mobile", "+91 99999 01234")).toBe("+91 XXXXXXX234");
    expect(mask("email", "test.user@lawdocs.test")).toBe("tXXXXXXXX@lawdocs.test");
    expect(() => mask("unknown", "x")).toThrow();
  });
});

describe("field encryption (IPB-02-20)", () => {
  it("binds ciphertext to tenant and location and never stores plaintext", async () => {
    const fc = new FieldCrypto({ kms: new LocalKms(), keyIdFor: localTenantKeyId });
    const at = { table: "kyc.party", column: "pan", rowId: "pty_1" };
    const sealed = await fc.encryptField("tnt_a", "REGULATED", "ZZZZA1234Z", at);
    expect(Buffer.from(sealed.enc).toString("latin1")).not.toContain("ZZZZA1234Z");
    expect(await fc.decryptFieldText("tnt_a", sealed, at)).toBe("ZZZZA1234Z");
    await expect(fc.decryptField("tnt_b", sealed, at)).rejects.toThrow(/another tenant/);
    await expect(fc.decryptField("tnt_a", sealed, { ...at, rowId: "pty_2" })).rejects.toThrow();
    await expect(fc.encryptField("tnt_a", "INTERNAL", "x", at)).rejects.toThrow();
  });
});

describe("drizzle helpers", () => {
  it("emit RLS and data-class SQL", () => {
    expect(rlsPolicySql("cases.note")).toContain("force row level security");
    expect(rlsPolicySql("cases.note")).toContain("current_setting('app.tenant_id', true)");
    expect(dataClassCommentsSql("cases.note", { body: "CONFIDENTIAL" })).toBe(
      "comment on column cases.note.body is 'dataclass:CONFIDENTIAL';",
    );
    expect(() => rlsPolicySql("note; drop table x")).toThrow();
  });
});
