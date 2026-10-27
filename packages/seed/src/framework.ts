// Seed framework (IPB-11 §11.3.D): deterministic (fixed faker seed, namespace-hash IDs), idempotent
// (upsert on a natural key; a re-run reports 0 inserted / N unchanged), synthetic-only (every row
// passes the "no real identifier" validator) and tracked in seed.seed_row so purge removes exactly
// what a profile created. Every write goes through the transaction kernel and the audit ledger.
import { Faker, base, en, en_IN } from "@faker-js/faker";
import type { ProductCode } from "@infrabyx/contracts/env";
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import { internalEvent } from "@infrabyx/config/events";
import { canonicalize, deterministicId, newId, sha256 } from "@infrabyx/crypto";
import { assertSeedAllowed, type SeedEnv, type SeedProfile } from "./guard.js";
import type { SeedTenant } from "./personas/index.js";
import { findRealIdentifiers } from "./synthetic.js";

export const SEED_TENANT_IDS: Readonly<Record<SeedTenant, string>> = {
  platform: "tnt_platform",
  demo: "tnt_demo",
  sandbox: "tnt_sandbox",
};
/** Fixed time component for seeded ULIDs, so IDs never depend on the clock (IPB-11-23). */
export const SEED_EPOCH = new Date("2026-01-01T00:00:00.000Z");
export const SEED_PRINCIPAL = {
  id: "svc_seed",
  type: "service" as const,
  roles: ["SVC_SEED", "PLT_RELEASE_MANAGER"],
};

export type UpsertOutcome = "inserted" | "updated" | "unchanged";

export interface UpsertSpec {
  /** schema.table */
  table: string;
  /** Natural-key columns and values. */
  key: Record<string, unknown>;
  values?: Record<string, unknown>;
  /** Derive `<column>` = deterministicId(prefix, table, JCS(key)) when the table has a prefixed id. */
  id?: { column?: string; prefix: string };
  /** Columns sent as JSON text (jsonb columns). */
  json?: readonly string[];
}

export interface SeedWriter {
  readonly tx: Tx;
  upsert(spec: UpsertSpec): Promise<{ outcome: UpsertOutcome; id?: string }>;
}

export interface SeedModuleContext {
  profile: SeedProfile;
  product: ProductCode;
  runId: string;
  faker: Faker;
  /** Run date for narrative-relative data (IPB-11-28 demo); never used for IDs. */
  runDate: Date;
  tenantIds: Readonly<Record<SeedTenant, string>>;
  /** `AUTH_SUPER_ADMIN_EMAIL`, when set; the persona otherwise uses the placeholder. */
  superAdminEmail?: string;
  /** One kernel transaction (and one ledger entry) in the given seed tenant. */
  write(tenant: SeedTenant, fn: (w: SeedWriter) => Promise<void>): Promise<void>;
  /**
   * The run's kernel, audit sink and outbox, for modules that seed through a package's own
   * services (Studio maker-checker, consent texts, the trust mirror) instead of table rows. The run
   * has already passed the seed guard (`assertSeedAllowed`), so `seedAllowed` is always true here.
   */
  services: {
    kernel: MutationKernel;
    audit: AuditSink;
    outbox?: OutboxWriter;
    seedAllowed: true;
  };
}

export interface SeedModule {
  module: string;
  profiles: readonly SeedProfile[];
  dependsOn?: readonly string[];
  run(ctx: SeedModuleContext): Promise<void>;
}

export function defineSeedModule(m: SeedModule): SeedModule {
  if (!/^[a-z][a-z0-9_]*$/.test(m.module)) throw new Error(`invalid seed module name ${m.module}`);
  if (m.profiles.length === 0) throw new Error(`${m.module}: no profiles`);
  return m;
}

export type Counts = Record<UpsertOutcome, number>;

export interface SeedReport {
  runId: string;
  profile: SeedProfile;
  totals: Counts;
  modules: Record<string, Counts>;
}

export interface RunSeedOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  outbox?: OutboxWriter;
  env: SeedEnv;
  product: ProductCode;
  profile: SeedProfile;
  modules: readonly SeedModule[];
  /** SEED_RANDOM_SEED (IPB-11-23). */
  randomSeed: number;
  /** AUTH_SUPER_ADMIN_EMAIL: the one real address a seed may write (IPB-11-32). */
  superAdminEmail?: string;
  runDate?: Date;
  onRefused?: (envelope: Record<string, unknown>) => void;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(s: string): string {
  if (!IDENT.test(s)) throw new Error(`invalid identifier ${s}`);
  return s;
}
function table(s: string): string {
  const [a, b, ...rest] = s.split(".");
  if (!a || !b || rest.length) throw new Error(`expected schema.table, got ${s}`);
  return `${ident(a)}.${ident(b)}`;
}

/** Faker seeded per module, so adding a module never shifts another module's data. */
export function seededFaker(randomSeed: number, module: string): Faker {
  const f = new Faker({ locale: [en_IN, en, base] });
  const h = sha256(`${randomSeed}:${module}`);
  f.seed([
    ((h[0] as number) << 16) | ((h[1] as number) << 8) | (h[2] as number),
    ((h[3] as number) << 16) | ((h[4] as number) << 8) | (h[5] as number),
  ]);
  return f;
}

const zero = (): Counts => ({ inserted: 0, updated: 0, unchanged: 0 });
const norm = (v: unknown): string =>
  canonicalize(v === undefined ? null : JSON.parse(JSON.stringify(v)));

class Writer implements SeedWriter {
  constructor(
    readonly tx: Tx,
    private readonly run: { runId: string; profile: SeedProfile },
    private readonly counts: Counts,
    private readonly allowEmails: ReadonlySet<string> = new Set(),
  ) {}

  async upsert(spec: UpsertSpec): Promise<{ outcome: UpsertOutcome; id?: string }> {
    const t = table(spec.table);
    const violations = findRealIdentifiers(
      { ...spec.key, ...spec.values },
      spec.table,
      this.allowEmails,
    );
    if (violations.length) {
      throw new IpbError("IPB-SEED-004", {
        detail: violations.map((v) => `${v.path}: ${v.reason}`).join("; "),
      });
    }
    const idCol = spec.id ? ident(spec.id.column ?? "id") : undefined;
    const id = spec.id
      ? deterministicId(spec.id.prefix, spec.table, canonicalize(spec.key), SEED_EPOCH)
      : undefined;
    const keyCols: Record<string, unknown> = { ...(idCol ? { [idCol]: id } : {}), ...spec.key };
    const all: Record<string, unknown> = { ...keyCols, ...spec.values };
    const json = new Set(spec.json ?? []);
    const param = (c: string, v: unknown) => (json.has(c) ? JSON.stringify(v) : v);
    const keyNames = Object.keys(idCol ? { [idCol]: id } : spec.key).map(ident);
    const lookup = idCol ? { [idCol]: id } : spec.key;
    const where = keyNames.map((c, i) => `${c} = $${i + 1}`).join(" and ");
    const existing = await this.tx.query<{ row: Record<string, unknown> }>(
      `select to_jsonb(t) as row from ${t} t where ${where} for update`,
      keyNames.map((c) => param(c, lookup[c])),
    );
    const cols = Object.keys(all).map(ident);
    const row = existing.rows[0]?.row;
    let outcome: UpsertOutcome;
    if (!row) {
      await this.tx.query(
        `insert into ${t} (${cols.join(", ")}) values (${cols.map((c, i) => `$${i + 1}${json.has(c) ? "::jsonb" : ""}`).join(", ")})`,
        cols.map((c) => param(c, all[c])),
      );
      await this.tx.query(
        `insert into seed.seed_row (run_id, tenant_id, profile, table_name, row_key) values ($1, $2, $3, $4, $5::jsonb)
         on conflict (table_name, row_key) do nothing`,
        [
          this.run.runId,
          this.tx.ctx.tenantId,
          this.run.profile,
          spec.table,
          JSON.stringify(lookup),
        ],
      );
      outcome = "inserted";
    } else {
      const changed = Object.keys(spec.values ?? {}).filter(
        (c) => norm(row[c]) !== norm((spec.values as Record<string, unknown>)[c]),
      );
      if (changed.length === 0) outcome = "unchanged";
      else {
        const sets = changed.map(
          (c, i) => `${ident(c)} = $${i + 1 + keyNames.length}${json.has(c) ? "::jsonb" : ""}`,
        );
        await this.tx.query(`update ${t} set ${sets.join(", ")} where ${where}`, [
          ...keyNames.map((c) => param(c, lookup[c])),
          ...changed.map((c) => param(c, (spec.values as Record<string, unknown>)[c])),
        ]);
        outcome = "updated";
      }
    }
    this.counts[outcome]++;
    return id ? { outcome, id } : { outcome };
  }
}

function ordered(modules: readonly SeedModule[]): SeedModule[] {
  const byName = new Map(modules.map((m) => [m.module, m]));
  const out: SeedModule[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (m: SeedModule) => {
    if (state.get(m.module) === "done") return;
    if (state.get(m.module) === "visiting") throw new Error(`seed module cycle at ${m.module}`);
    state.set(m.module, "visiting");
    for (const d of m.dependsOn ?? []) {
      const dep = byName.get(d);
      if (!dep) throw new Error(`${m.module} depends on unknown seed module ${d}`);
      visit(dep);
    }
    state.set(m.module, "done");
    out.push(m);
  };
  modules.forEach(visit);
  return out;
}

export async function runSeed(o: RunSeedOptions): Promise<SeedReport> {
  try {
    assertSeedAllowed(o.env, o.profile);
  } catch (e) {
    o.onRefused?.(
      internalEvent({
        product: o.product,
        event: "SeedRefused",
        tenantId: SEED_TENANT_IDS.platform,
        data: { env: o.env.APP_ENV, actor: SEED_PRINCIPAL.id, profile: o.profile },
      }),
    );
    throw e;
  }
  const ctxFor = (tenant: SeedTenant): KernelContext => ({
    tenantId: SEED_TENANT_IDS[tenant],
    scope: "platform",
    principal: SEED_PRINCIPAL,
  });
  const platformCtx = ctxFor("platform");
  const runId = newId("run");
  const report: SeedReport = { runId, profile: o.profile, totals: zero(), modules: {} };
  const emit = async (
    tx: Tx,
    event: "SeedRunStarted" | "SeedRunCompleted",
    data: Record<string, unknown>,
  ) => {
    if (o.outbox)
      await o.outbox.publish(tx, "seed", {
        envelope: internalEvent({ product: o.product, event, tenantId: tx.ctx.tenantId, data }),
      });
  };
  await o.kernel.mutate(
    platformCtx,
    async (tx) => {
      await tx.query("insert into seed.seed_run (id, profile, product) values ($1, $2, $3)", [
        runId,
        o.profile,
        o.product,
      ]);
      await o.audit.record(tx, {
        action: "seed.run.start",
        resourceType: "seed_run",
        resourceId: runId,
        after: { profile: o.profile },
      });
      await emit(tx, "SeedRunStarted", { profile: o.profile, run_id: runId });
    },
    { action: "seed.run.start" },
  );

  const allowEmails = new Set(o.superAdminEmail ? [o.superAdminEmail.toLowerCase()] : []);
  for (const m of ordered(o.modules)) {
    if (!m.profiles.includes(o.profile)) continue;
    const counts = zero();
    report.modules[m.module] = counts;
    const ctx: SeedModuleContext = {
      profile: o.profile,
      product: o.product,
      runId,
      faker: seededFaker(o.randomSeed, m.module),
      runDate: o.runDate ?? new Date(),
      tenantIds: SEED_TENANT_IDS,
      ...(o.superAdminEmail ? { superAdminEmail: o.superAdminEmail } : {}),
      services: {
        kernel: o.kernel,
        audit: o.audit,
        ...(o.outbox ? { outbox: o.outbox } : {}),
        seedAllowed: true,
      },
      write: async (tenant, fn) => {
        await o.kernel.mutate(
          ctxFor(tenant),
          async (tx) => {
            const before = { ...counts };
            await fn(new Writer(tx, { runId, profile: o.profile }, counts, allowEmails));
            await o.audit.record(tx, {
              action: "seed.module.apply",
              resourceType: "seed_module",
              resourceId: m.module,
              after: {
                run_id: runId,
                inserted: counts.inserted - before.inserted,
                updated: counts.updated - before.updated,
                unchanged: counts.unchanged - before.unchanged,
              },
            });
          },
          { action: "seed.module.apply" },
        );
      },
    };
    await m.run(ctx);
    for (const k of ["inserted", "updated", "unchanged"] as const) report.totals[k] += counts[k];
  }
  await o.kernel.mutate(
    platformCtx,
    async (tx) => {
      await tx.query(
        "update seed.seed_run set finished_at = now(), counts = $2::jsonb where id = $1",
        [runId, JSON.stringify(report.totals)],
      );
      await o.audit.record(tx, {
        action: "seed.run.complete",
        resourceType: "seed_run",
        resourceId: runId,
        after: report.totals,
      });
      await emit(tx, "SeedRunCompleted", {
        profile: o.profile,
        run_id: runId,
        counts: report.modules,
      });
    },
    { action: "seed.run.complete" },
  );
  return report;
}
