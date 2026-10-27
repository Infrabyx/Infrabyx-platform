// Cross-tenant background reads (OWNER-QUESTIONS #22, PL3-D-21). A worker that finds due work
// across tenants (the workflow timer poller, the NOTIFY dispatcher) reads through a
// `ServiceReader`: a read-only platform context as its own SVC_ role, run by the kernel as that
// role's database role, which is granted only the columns the worker needs. Every row must carry
// its `tenant_id`, and each read that returned rows is ledgered in every tenant it touched (one
// `platform.service_read` entry per tenant, with the role, table and row count), so a tenant's
// ledger shows each time a platform worker looked at its data.
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { SERVICE_READER_ROLES, type ServiceReaderRole } from "@infrabyx/contracts/roles";
import { serviceReaderContext } from "./context.js";
import { SERVICE_READ_ACTION } from "./kernel.js";

export interface ServiceReadRecord {
  role: ServiceReaderRole;
  principalId: string;
  table: string;
  /** Rows returned, by tenant. */
  tenants: ReadonlyMap<string, number>;
}

export interface ServiceReaderOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  role: ServiceReaderRole;
  principalId: string;
  /** Operational log of every read that returned rows (after the ledger entries are written). */
  onRead?: (r: ServiceReadRecord) => void;
}

export class ServiceReader {
  private readonly ctx: KernelContext;
  constructor(private readonly o: ServiceReaderOptions) {
    this.ctx = serviceReaderContext(o.role, o.principalId);
  }

  /** The tenant context the reader's ledger entries are written in. */
  tenantContext(tenantId: string): KernelContext {
    return { ...this.ctx, tenantId, scope: "tenant" };
  }

  /**
   * Run one query against `table` (one of the role's tables) and ledger it per tenant. The query
   * must select `tenant_id`; rows without one are refused, so no read can go unrecorded.
   */
  async read<R extends { tenant_id: string }>(
    table: string,
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<R[]> {
    const allowed: readonly string[] = SERVICE_READER_ROLES[this.o.role].tables;
    if (!allowed.includes(table))
      throw new Error(`${this.o.role} may not read ${table} (allowed: ${allowed.join(", ")})`);
    if (!new RegExp(`\\bfrom\\s+${table.replace(".", "\\.")}\\b`, "i").test(sql))
      throw new Error(`the query does not read ${table}`);
    const rows = await this.o.kernel.read(
      this.ctx,
      async (tx: Tx) => (await tx.query<R>(sql, params)).rows,
    );
    const tenants = new Map<string, number>();
    for (const r of rows) {
      if (typeof r.tenant_id !== "string") throw new Error("a service read must select tenant_id");
      tenants.set(r.tenant_id, (tenants.get(r.tenant_id) ?? 0) + 1);
    }
    for (const [tenantId, n] of tenants)
      await this.o.kernel.mutate(
        this.tenantContext(tenantId),
        async (tx) => {
          await this.o.audit.record(tx, {
            action: SERVICE_READ_ACTION,
            resourceType: "table",
            resourceId: table,
            after: { role: this.o.role, rows: n },
          });
        },
        { action: SERVICE_READ_ACTION },
      );
    if (tenants.size)
      this.o.onRead?.({ role: this.o.role, principalId: this.o.principalId, table, tenants });
    return rows;
  }
}
