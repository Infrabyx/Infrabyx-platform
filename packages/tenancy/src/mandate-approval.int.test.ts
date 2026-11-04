// The mandate approval action (owner answer #100's gap, 4 Nov 2026; R1-D-66): the approvals engine
// consumes an approved `payments.mandate.change` request once, for the same tenant, mandate and
// amount in integer paise, before the mandate adapter calls the vendor.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { MANDATE_APPROVAL_ACTION } from "@infrabyx/contracts/ports";
import { newId } from "@infrabyx/crypto";
import { ApprovalsEngine } from "./approvals/engine.js";
import { PgKernel } from "./kernel.js";
import { freshDb, type TestDb } from "./__tests__/pg.js";

class RecordingAudit implements AuditSink {
  readonly entries: AuditEntryInput[] = [];
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    this.entries.push(e);
    tx.markAudited();
    return { id: "led_x" };
  }
}

let db: TestDb;
let kernel: PgKernel;
let engine: ApprovalsEngine;
const audit = new RecordingAudit();
const MAKER = newId("usr");
const CHECKER = newId("usr");
const user = (id: string, roles: string[], tenantId = "tnt_a"): KernelContext => ({
  tenantId,
  principal: { id, type: "user", roles },
});
const service = (tenantId: string): KernelContext => ({
  tenantId,
  principal: { id: "svc_mandates", type: "service", roles: [] },
});
const reason = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; meta?: { reason?: string }; message?: string }) =>
      e.meta?.reason ?? e.code ?? e.message,
  );
const subject = (over: Record<string, unknown> = {}) => ({
  operation: "register" as const,
  mandate: "mandate-key-0001",
  maxAmountMinor: 25_000_00,
  ...over,
});

/** Raise and approve a request in `tenantId` with `payload`, at `risk`. */
async function approved(
  payload: Record<string, unknown>,
  opts: { tenantId?: string; risk?: "R2" | "R3" | "R4"; action?: string; decide?: boolean } = {},
): Promise<string> {
  const tenantId = opts.tenantId ?? "tnt_a";
  const { id } = await kernel.mutate(
    user(MAKER, ["ORG_MAKER"], tenantId),
    (tx) =>
      engine.request(tx, {
        action: opts.action ?? MANDATE_APPROVAL_ACTION,
        riskClass: opts.risk ?? "R3",
        payload,
        payloadDataClass: "INTERNAL",
        summary: "mandate",
      }),
    { action: "fbx.mandate.request" },
  );
  if (opts.decide !== false)
    await engine.decide(user(CHECKER, ["ORG_CHECKER"], tenantId), id, "approve");
  return id;
}

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'FBX', 'A'), ('tnt_b', 'FBX', 'B')",
  );
  for (const id of [MAKER, CHECKER]) {
    await db.admin.query("insert into tenancy.user (id, idp_subject) values ($1, $1)", [id]);
    for (const t of ["tnt_a", "tnt_b"])
      await db.admin.query("insert into tenancy.membership (tenant_id, user_id) values ($1, $2)", [
        t,
        id,
      ]);
  }
  engine = new ApprovalsEngine({ kernel, audit, product: "FBX" });
  engine.register("fbx.other.action", { autoExecute: false });
});
afterAll(async () => {
  await db?.end();
});

describe("R1-D-66 the mandate approval action", () => {
  it("is never executed on approval, and consumed once for the same tenant, mandate and amount", async () => {
    const id = await approved(subject());
    expect((await engine.get(user(MAKER, ["ORG_MAKER"]), id)).state).toBe("approved");
    const verify = engine.mandateVerifier(service);
    expect(
      await reason(verify.consume({ tenantId: "tnt_b", approvalRef: id, subject: subject() })),
    ).toBe("not_found");
    expect(
      await reason(
        verify.consume({
          tenantId: "tnt_a",
          approvalRef: id,
          subject: subject({ mandate: "other-key-01" }),
        }),
      ),
    ).toBe("other_mandate");
    expect(
      await reason(
        verify.consume({
          tenantId: "tnt_a",
          approvalRef: id,
          subject: subject({ maxAmountMinor: 25_000_01 }),
        }),
      ),
    ).toBe("other_amount");
    expect(
      await reason(
        verify.consume({
          tenantId: "tnt_a",
          approvalRef: id,
          subject: subject({ operation: "cancel" }),
        }),
      ),
    ).toBe("other_operation");
    expect(await engine.get(user(MAKER, ["ORG_MAKER"]), id)).toMatchObject({ state: "approved" });

    await verify.consume({ tenantId: "tnt_a", approvalRef: id, subject: subject() });
    expect((await engine.get(user(MAKER, ["ORG_MAKER"]), id)).state).toBe("executed");
    expect(audit.entries.map((e) => e.action)).toContain("approvals.request.consume");
    expect(
      await reason(verify.consume({ tenantId: "tnt_a", approvalRef: id, subject: subject() })),
    ).toBe("consumed");
  });

  it("two concurrent calls on one approval: exactly one consumes it", async () => {
    const id = await approved(subject({ mandate: "mandate-key-0002" }));
    const verify = engine.mandateVerifier(service);
    const s = subject({ mandate: "mandate-key-0002" });
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        reason(verify.consume({ tenantId: "tnt_a", approvalRef: id, subject: s })),
      ),
    );
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r === "consumed")).toHaveLength(2);
  });

  it("refuses a pending request, another action, a risk class below R3 and an agent caller", async () => {
    const verify = engine.mandateVerifier(service);
    const pending = await approved(subject({ mandate: "mandate-key-0003" }), { decide: false });
    expect(
      await reason(
        verify.consume({
          tenantId: "tnt_a",
          approvalRef: pending,
          subject: subject({ mandate: "mandate-key-0003" }),
        }),
      ),
    ).toBe("not_approved");
    const other = await approved(subject({ mandate: "mandate-key-0004" }), {
      action: "fbx.other.action",
    });
    expect(
      await reason(
        verify.consume({
          tenantId: "tnt_a",
          approvalRef: other,
          subject: subject({ mandate: "mandate-key-0004" }),
        }),
      ),
    ).toBe("other_action");
    const low = await approved(subject({ mandate: "mandate-key-0005" }), { risk: "R2" });
    expect(
      await reason(
        verify.consume({
          tenantId: "tnt_a",
          approvalRef: low,
          subject: subject({ mandate: "mandate-key-0005" }),
        }),
      ),
    ).toBe("risk_class");
    const ok = await approved(subject({ mandate: "mandate-key-0006" }));
    const agent: KernelContext = {
      tenantId: "tnt_a",
      principal: { id: "agt_vidhi", type: "agent", roles: [] },
    };
    expect(
      await reason(
        engine.consumeMandateApproval(agent, ok, subject({ mandate: "mandate-key-0006" })),
      ),
    ).toBe("agent");
  });

  it("cannot be executed by hand, nor registered with an executor", async () => {
    const id = await approved(subject({ mandate: "mandate-key-0007" }));
    await expect(engine.execute(user(CHECKER, ["ORG_CHECKER"]), id)).rejects.toThrow(
      /consumed only by the mandate adapter/,
    );
    expect(() =>
      engine.register(MANDATE_APPROVAL_ACTION, { execute: async () => undefined }),
    ).toThrow(/never executed/);
    engine.register(MANDATE_APPROVAL_ACTION, { checkerRoles: ["ORG_CHECKER"] });
    const id2 = await approved(subject({ mandate: "mandate-key-0008" }));
    expect((await engine.get(user(MAKER, ["ORG_MAKER"]), id2)).state).toBe("approved");
  });
});
