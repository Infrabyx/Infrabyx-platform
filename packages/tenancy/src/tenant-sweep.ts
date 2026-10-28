// Scheduled per-tenant jobs (Udofin platform request PR-UDF-013; R1-D-12). A product's worker
// lists the tenants as SVC_TENANT_SWEEP, a service reader whose database role reads only `id` and
// `status` of `tenancy.tenant`; the read is ledgered in every tenant it lists. It then runs the job
// once per tenant in that tenant's own context, under its RLS, as the job's own service principal
// (a reader is read-only, so the job is not run as one); its writes are ledgered under that
// principal. One tenant's failure is reported and does not stop the others. The platform tenant
// is included (its ledger holds the platform-scope actions).
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  Principal,
} from "@infrabyx/contracts/kernel";
import { ServiceReader } from "./service-reader.js";

export const TENANT_SWEEP_PRINCIPAL_ID = "svc_tenant_sweep";

/** The default principal a job runs as in each tenant; products name their own per job. */
export const TENANT_JOB_PRINCIPAL: Principal = Object.freeze({
  id: "svc_tenant_job",
  type: "service",
  roles: Object.freeze(["SVC_TENANT_JOB"]),
});

export interface TenantSweepOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The sweep's service principal (default `svc_tenant_sweep`). */
  principalId?: string;
  /** Also run for suspended tenants (default true: their ledgers still need verifying). */
  includeSuspended?: boolean;
  /**
   * The service principal each tenant's job runs as (default `svc_tenant_job`). It must not hold a
   * service-reader role, which would make the job read-only.
   */
  jobPrincipal?: Principal;
}

export interface TenantRunResult<T> {
  tenantId: string;
  ok: boolean;
  value?: T;
  /** The error's code (an IPB code where there is one); never its message, which may hold data. */
  error?: string;
}

export class TenantSweep {
  private readonly principalId: string;
  private readonly reader: ServiceReader;

  constructor(private readonly o: TenantSweepOptions) {
    this.principalId = o.principalId ?? TENANT_SWEEP_PRINCIPAL_ID;
    this.reader = new ServiceReader({
      kernel: o.kernel,
      audit: o.audit,
      role: "SVC_TENANT_SWEEP",
      principalId: this.principalId,
    });
  }

  /** The tenants to run for: every one not deleted (and not suspended, if so configured). */
  async tenants(): Promise<string[]> {
    const states = this.o.includeSuspended === false ? ["active"] : ["active", "suspended"];
    const rows = await this.reader.read<{ tenant_id: string }>(
      "tenancy.tenant",
      "select id as tenant_id from tenancy.tenant where status = any($1) order by id",
      [states],
    );
    return rows.map((r) => r.tenant_id);
  }

  /** The context a job runs in for one tenant: tenant scope, the job's service principal. */
  tenantContext(tenantId: string): KernelContext {
    const p = this.o.jobPrincipal ?? TENANT_JOB_PRINCIPAL;
    return { tenantId, scope: "tenant", principal: { ...p, roles: [...p.roles] } };
  }

  /** Run `job` for every tenant in turn; returns one result per tenant, failures included. */
  async run<T>(job: (ctx: KernelContext) => Promise<T>): Promise<TenantRunResult<T>[]> {
    const out: TenantRunResult<T>[] = [];
    for (const tenantId of await this.tenants()) {
      try {
        out.push({ tenantId, ok: true, value: await job(this.tenantContext(tenantId)) });
      } catch (e) {
        const code = (e as { code?: unknown })?.code;
        out.push({ tenantId, ok: false, error: typeof code === "string" ? code : "error" });
      }
    }
    return out;
  }
}
