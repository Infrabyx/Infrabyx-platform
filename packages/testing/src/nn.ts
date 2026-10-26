// NN pattern suites (IPB-14 §14.5 item 4; PL1-D-04). Products call these against their own modules;
// PL1 runs them against the platform packages. Tags: @NN-01 tenant isolation, @NN-02 / @NN-45
// audit ledger, @NN-18 maker-checker, @IPB-02-10 locked actions, @IPB-11-14 seed refusal.
import { describe, expect, it } from "vitest";
import type { KernelContext, Tx } from "@infrabyx/contracts/kernel";
import type { ApprovalRequestInput } from "@infrabyx/contracts/kernel";
import { AGENT_FORBIDDEN_VERBS } from "@infrabyx/contracts/roles";
import { verifyChain, type LedgerEntry } from "@infrabyx/audit";
import type { ApprovalsEngine } from "@infrabyx/tenancy";
import { lintRls } from "@infrabyx/tenancy/rls-lint";
import type { TestDatabase } from "./postgres.js";

const codeOf = async (p: Promise<unknown>): Promise<string | null> =>
  p.then(
    () => null,
    (e: { code?: string; name?: string }) => e.code ?? e.name ?? "Error",
  );

export interface TenantIsolationSpec {
  db: () => TestDatabase;
  /** schema.table under test. */
  table: string;
  tenantA: string;
  tenantB: string;
  /** Insert a row for the context tenant inside the mutation (write the ledger too); return its id. */
  insert(tx: Tx): Promise<string>;
  /** Select by id inside the context tenant; return the rows found. */
  select(tx: Tx, id: string): Promise<unknown[]>;
  ctx?: (tenantId: string) => KernelContext;
}

export function describeTenantIsolation(s: TenantIsolationSpec): void {
  const ctx =
    s.ctx ??
    ((tenantId: string): KernelContext => ({
      tenantId,
      principal: { id: "usr_nn01", type: "user", roles: ["ORG_ADMIN"] },
    }));
  describe(`@NN-01 tenant isolation: ${s.table}`, () => {
    it("a crafted ID from tenant B returns nothing for tenant A (404, not 403)", async () => {
      const { kernel } = s.db();
      const id = await kernel.mutate(ctx(s.tenantB), (tx) => s.insert(tx));
      expect(await kernel.read(ctx(s.tenantA), (tx) => s.select(tx, id))).toEqual([]);
      expect((await kernel.read(ctx(s.tenantB), (tx) => s.select(tx, id))).length).toBe(1);
    });
    it("a header-style tenant switch inside the transaction is refused", async () => {
      const { kernel } = s.db();
      expect(
        await codeOf(
          kernel.read(ctx(s.tenantA), (tx) =>
            tx.query(`select set_config('app.tenant_id', $1, true)`, [s.tenantB]),
          ),
        ),
      ).toBe("KernelGuardError");
    });
    it("without SET LOCAL app.tenant_id the application role sees no rows (deny by default)", async () => {
      const { admin } = s.db();
      await admin.query("begin");
      try {
        await admin.query("set local role app_rw");
        const r = await admin.query(`select count(*)::int as n from ${s.table}`);
        expect(r.rows[0].n).toBe(0);
      } finally {
        await admin.query("rollback");
      }
    });
    it("RLS is enabled, forced and tenant-scoped; views over it are security_invoker", async () => {
      const [schema] = s.table.split(".");
      const findings = (
        await lintRls(s.db().admin, { schemas: [schema as string], rlsTables: [s.table] })
      ).filter((f) => f.object === s.table || f.rule === "security-invoker-view");
      expect(findings).toEqual([]);
    });
  });
}

export interface AuditChainSpec {
  db: () => TestDatabase;
  tenantId: string;
  /** One mutating operation of the module, through the kernel. */
  mutate(ctx: KernelContext): Promise<unknown>;
  /** Ledger entries one call writes (default 1). */
  entriesPerMutation?: number;
  ctx?: KernelContext;
}

const ledger = async (db: TestDatabase, tenantId: string): Promise<LedgerEntry[]> =>
  (
    await db.admin.query("select * from audit.ledger where tenant_id = $1 order by seq", [tenantId])
  ).rows.map((r) => ({
    ...r,
    seq: Number(r.seq),
    occurred_at: (r.occurred_at as Date).toISOString(),
  })) as LedgerEntry[];

export function describeAuditChain(s: AuditChainSpec): void {
  const ctx = s.ctx ?? {
    tenantId: s.tenantId,
    principal: { id: "usr_nn02", type: "user" as const, roles: ["ORG_ADMIN"] },
  };
  describe(`@NN-45 @NN-02 audit ledger: ${s.tenantId}`, () => {
    it("every mutation leaves its chained ledger entries in the same transaction", async () => {
      const db = s.db();
      const before = (await ledger(db, s.tenantId)).length;
      await s.mutate(ctx);
      const after = await ledger(db, s.tenantId);
      expect(after.length - before).toBe(s.entriesPerMutation ?? 1);
      expect(verifyChain(after).ok).toBe(true);
    });
    it("a mutation that writes no ledger entry is refused (IPB-MOD-003)", async () => {
      expect(await codeOf(s.db().kernel.mutate(ctx, async () => undefined))).toBe("IPB-MOD-003");
    });
    it("history cannot be edited and tampering is detected", async () => {
      const db = s.db();
      await expect(
        db.admin.query("update audit.ledger set resource_id = 'x' where tenant_id = $1", [
          s.tenantId,
        ]),
      ).rejects.toThrow();
      await db.admin.query("alter table audit.ledger disable trigger ledger_no_update");
      try {
        await db.admin.query(
          "update audit.ledger set after_digest = repeat('e', 64) where tenant_id = $1 and seq = (select max(seq) from audit.ledger where tenant_id = $1)",
          [s.tenantId],
        );
      } finally {
        await db.admin.query("alter table audit.ledger enable trigger ledger_no_update");
      }
      expect(verifyChain(await ledger(db, s.tenantId)).ok).toBe(false);
    });
  });
}

export interface MakerCheckerSpec {
  db: () => TestDatabase;
  engine: () => ApprovalsEngine;
  request: ApprovalRequestInput;
  maker: KernelContext;
  checker: KernelContext;
  agent: KernelContext;
}

export function describeMakerChecker(s: MakerCheckerSpec): void {
  describe(`@NN-18 maker-checker: ${s.request.action} (${s.request.riskClass})`, () => {
    const make = () => s.db().kernel.mutate(s.maker, (tx) => s.engine().request(tx, s.request));
    it("the maker cannot check their own request (IPB-SEC-007)", async () => {
      const { id } = await make();
      expect(await codeOf(s.engine().decide(s.maker, id, "approve"))).toBe("IPB-SEC-007");
    });
    it("an agent cannot check (IPB-SEC-004)", async () => {
      const { id } = await make();
      expect(await codeOf(s.engine().decide(s.agent, id, "approve"))).toBe("IPB-SEC-004");
    });
    it("the delay window of the risk class holds (IPB-SEC-008)", async () => {
      const { id } = await make();
      const r = await s.engine().decide(s.checker, id, "approve");
      if (r.delayMinutes > 0)
        expect(await codeOf(s.engine().execute(s.checker, id))).toBe("IPB-SEC-008");
      else expect(["approved", "executed"]).toContain(r.state);
    });
  });
}

export interface LockedActionsSpec {
  db: () => TestDatabase;
  /** Dotted actions whose last segment is one of approve/sign/disburse/delete/grant. */
  actions: readonly string[];
  agent: KernelContext;
}

export function describeLockedActions(s: LockedActionsSpec): void {
  describe("@IPB-02-10 locked actions: agents are makers only", () => {
    it("the actions under test end in a locked verb", () => {
      for (const a of s.actions)
        expect(AGENT_FORBIDDEN_VERBS as readonly string[]).toContain(a.split(".").at(-1));
    });
    for (const action of s.actions) {
      it(`${action} is refused for ${s.agent.principal.id} (IPB-SEC-004)`, async () => {
        expect(await codeOf(s.db().kernel.mutate(s.agent, async () => undefined, { action }))).toBe(
          "IPB-SEC-004",
        );
      });
    }
  });
}

export interface SeedRefusalSpec {
  /** Run the product's seed entry point in the given environment; resolve to an exit code or throw. */
  entrypoint(env: { APP_ENV: "prod" | "dr" | "pre-prod"; SEED_ENABLED: true }): Promise<unknown>;
}

export function describeSeedRefusal(s: SeedRefusalSpec): void {
  describe("@IPB-11-14 @IPB-11-AT-02 seeds refuse production-group environments", () => {
    for (const APP_ENV of ["prod", "dr", "pre-prod"] as const) {
      it(`refuses in ${APP_ENV} (IPB-SEED-001)`, async () => {
        const r = await s.entrypoint({ APP_ENV, SEED_ENABLED: true }).then(
          (v) => ({ v }),
          (e: { code?: string }) => ({ e }),
        );
        if ("e" in r) expect(r.e.code).toBe("IPB-SEED-001");
        else expect(r.v).toBe(1);
      });
    }
  });
}
