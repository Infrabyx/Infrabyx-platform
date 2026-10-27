// Autonomy (IPB-03-69, 03-70, §03.4.8; owner decision O-4; PL4 plan §8.4).
// - Effective level = min(skill ceiling, the tool's ceiling (L2 for a locked tool), the product
//   ceiling for the skill's audience, the kernel's operating level for (tenant, skill), the
//   tenant's `vidhi.skill.<key>.autonomy_level`, and L2 for scheduled runs unless IPB-03-67 allows
//   L3). The operating level is L2 until an approved grant raises it.
// - Promotion to L3/L4 is an R4 approval (`vidhi.autonomy.promote`) checked by ORG_OWNER, refused
//   with `IPB-AI-013` without the evidence (≥ `vidhi.autonomy.promotion_min_runs` L2 runs in 90 days,
//   approval rate ≥ 95 %, zero guardrail incidents) or inside the re-promotion cool-down.
// - Demotion is automatic: a locked-action attempt or guardrail incident lands at L2 (L1 if it was
//   already L2); an approval-rate breach lands one level down. Each demotion resets the evidence.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import {
  AUTONOMY_LEVELS,
  autonomyRank,
  minLevel,
  type AutonomyLevel,
  type VidhiProduct,
} from "@infrabyx/contracts/vidhi";
import { AutonomyChangedData, VIDHI_EVENTS } from "@infrabyx/contracts";
import { internalEvent } from "@infrabyx/config/events";
import { newId } from "@infrabyx/crypto";
import { keySegment, type SettingsReader } from "@infrabyx/ai";
import { productCeiling } from "./ceilings.js";
import type { SkillRegistry } from "./skills.js";

export const PROMOTE_ACTION = "vidhi.autonomy.promote";
/** Error codes that count as guardrail incidents for the evidence (IPB-03-70). */
export const GUARDRAIL_CODES = ["IPB-AI-040", "IPB-AI-041", "IPB-AI-042", "IPB-VID-011"];

export type DemotionReason = "demotion_locked" | "demotion_guardrail" | "demotion_rate";

export interface AutonomyApprovals {
  register(
    action: string,
    policy: {
      checkerRoles?: readonly string[];
      execute?: (
        tx: Tx,
        payload: Record<string, unknown>,
        request: { id: string },
      ) => Promise<void>;
    },
  ): unknown;
  request(
    tx: Tx,
    input: {
      action: string;
      riskClass: "R2" | "R3" | "R4";
      payload: Record<string, unknown>;
      summary?: string;
    },
  ): Promise<{ id: string }>;
}

export interface AutonomyOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: VidhiProduct;
  skills: SkillRegistry;
  settings: SettingsReader;
  approvals: AutonomyApprovals;
  outbox?: OutboxWriter;
}

interface StateRow {
  operating_level: AutonomyLevel;
  enabled: boolean;
  evidence_since: Date;
  demoted_at: Date | null;
}

export class Autonomy {
  constructor(private readonly o: AutonomyOptions) {
    o.approvals.register(PROMOTE_ACTION, {
      checkerRoles: ["ORG_OWNER"],
      execute: (tx, payload, request) => this.executePromotion(tx, payload, request.id),
    });
  }

  private async setting<T>(ctx: KernelContext, key: string, fallback: T): Promise<T> {
    try {
      const v = await this.o.settings.get(ctx, key);
      return v === null || v === undefined ? fallback : (v as T);
    } catch {
      return fallback;
    }
  }

  /** The (tenant, skill) state as stored, or the defaults (L2, enabled) when none exists yet. */
  async readState(tx: Tx, skillKey: string): Promise<StateRow> {
    const r = await tx.query<StateRow>(
      `select operating_level, enabled, evidence_since, demoted_at from vidhi.skill_state
        where skill_key = $1`,
      [skillKey],
    );
    return (
      r.rows[0] ?? {
        operating_level: "L2",
        enabled: true,
        evidence_since: new Date(0),
        demoted_at: null,
      }
    );
  }

  /** The (tenant, skill) state, created at L2 on first use (inside a mutation). */
  async state(tx: Tx, tenantId: string, skillKey: string): Promise<StateRow> {
    await tx.query(
      `insert into vidhi.skill_state (tenant_id, skill_key) values ($1, $2)
       on conflict (tenant_id, skill_key) do nothing`,
      [tenantId, skillKey],
    );
    const r = await tx.query<StateRow>(
      `select operating_level, enabled, evidence_since, demoted_at from vidhi.skill_state
        where tenant_id = $1 and skill_key = $2`,
      [tenantId, skillKey],
    );
    return r.rows[0] as StateRow;
  }

  /** The level a task of this skill runs at (IPB-03-69, 03-67), with the parts that set it. */
  async effectiveLevel(
    ctx: KernelContext,
    tx: Tx,
    skillKey: string,
    o: { toolName?: string; scheduled?: boolean; ownerRoles?: readonly string[] } = {},
  ): Promise<{ level: AutonomyLevel; parts: Record<string, AutonomyLevel> }> {
    const skill = this.o.skills.get(skillKey);
    if (!skill) throw new IpbError("IPB-VID-001", { detail: `skill ${skillKey} is not loaded` });
    const m = skill.manifest;
    const st = await this.state(tx, ctx.tenantId, skillKey);
    const tenant = await this.setting<string>(
      ctx,
      `vidhi.skill.${keySegment(skillKey)}.autonomy_level`,
      "L4",
    );
    const parts: Record<string, AutonomyLevel> = {
      skill: m.autonomy_ceiling,
      product: productCeiling(this.o.product, m.audience, skillKey),
      operating: st.operating_level,
      tenant: (AUTONOMY_LEVELS as readonly string[]).includes(tenant)
        ? (tenant as AutonomyLevel)
        : "L2",
    };
    if (o.toolName) {
      const t = skill.tools.get(o.toolName);
      if (t) parts.tool = t.ceiling;
    }
    if (o.scheduled) {
      const senior = (o.ownerRoles ?? []).some((r) => r === "ORG_OWNER" || r === "ORG_ADMIN");
      parts.schedule = senior ? "L3" : "L2";
    }
    return { level: minLevel(...Object.values(parts)), parts };
  }

  /** Lower the operating level, reset the evidence and record it (in the caller's transaction). */
  async demote(
    tx: Tx,
    ctx: KernelContext,
    skillKey: string,
    reason: DemotionReason,
    taskId?: string,
  ): Promise<AutonomyLevel> {
    const st = await this.state(tx, ctx.tenantId, skillKey);
    const from = st.operating_level;
    const to: AutonomyLevel =
      reason === "demotion_rate"
        ? (AUTONOMY_LEVELS[Math.max(0, autonomyRank(from) - 1)] as AutonomyLevel)
        : autonomyRank(from) > 2
          ? "L2"
          : "L1";
    await tx.query(
      `update vidhi.skill_state set operating_level = $3, evidence_since = now(), demoted_at = now(),
              updated_at = now()
        where tenant_id = $1 and skill_key = $2`,
      [ctx.tenantId, skillKey, to],
    );
    await tx.query(
      `update vidhi.autonomy_grant set state = 'revoked', revoked_at = now()
        where tenant_id = $1 and skill_key = $2 and state = 'active'`,
      [ctx.tenantId, skillKey],
    );
    await tx.query(
      `insert into vidhi.autonomy_event (tenant_id, skill_key, from_level, to_level, reason, task_id, actor_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [ctx.tenantId, skillKey, from, to, reason, taskId ?? null, ctx.principal.id],
    );
    await this.o.audit.record(tx, {
      action: "vidhi.autonomy.demote",
      resourceType: "vidhi_skill",
      resourceId: skillKey,
      before: { level: from },
      after: { level: to, reason, task_id: taskId ?? null },
    });
    await this.emit(tx, ctx, { tenant_id: ctx.tenantId, skill_key: skillKey, from, to, reason });
    return to;
  }

  /** The IPB-03-70 evidence for a skill in the caller's tenant. */
  async evidence(
    ctx: KernelContext,
    skillKey: string,
  ): Promise<{
    l2Runs: number;
    approvalRate: number | null;
    incidents: number;
    demotedAt: Date | null;
  }> {
    return this.o.kernel.read(ctx, async (tx) => {
      const st = await this.readState(tx, skillKey);
      const r = await tx.query<{
        runs: number;
        approved: number;
        rejected: number;
        incidents: number;
      }>(
        // The window start is read in SQL: a JS Date would drop its microseconds and let rows
        // written in the demotion's own transaction count again.
        `with w as (select coalesce((select evidence_since from vidhi.skill_state where skill_key = $1),
                                    '-infinity'::timestamptz) as since)
         select
           (select count(*)::int from vidhi.task t, w
             where t.skill_key = $1 and t.level = 'L2' and t.state = 'DONE'
               and t.created_at > w.since and t.created_at >= now() - interval '90 days') as runs,
           (select count(*)::int from vidhi.task_step s join vidhi.task t on t.id = s.task_id, w
             where t.skill_key = $1 and s.outcome = 'approved' and s.created_at > w.since) as approved,
           (select count(*)::int from vidhi.task_step s join vidhi.task t on t.id = s.task_id, w
             where t.skill_key = $1 and s.outcome = 'rejected' and s.created_at > w.since) as rejected,
           (select count(*)::int from vidhi.task t, w
             where t.skill_key = $1 and t.created_at > w.since
               and (t.error_code = any($2) or exists (select 1 from vidhi.task_step s
                     where s.task_id = t.id and s.outcome = 'locked_attempt'))) as incidents`,
        [skillKey, GUARDRAIL_CODES],
      );
      const x = r.rows[0] ?? { runs: 0, approved: 0, rejected: 0, incidents: 0 };
      const decided = x.approved + x.rejected;
      return {
        l2Runs: x.runs,
        approvalRate: decided ? x.approved / decided : null,
        incidents: x.incidents,
        demotedAt: st.demoted_at,
      };
    });
  }

  /**
   * A sponsor (ORG_OWNER or ORG_ADMIN; ORG_OWNER for L4) asks to raise a skill to L3 or L4: an R4
   * request checked by ORG_OWNER. Refused with `IPB-AI-013` without the evidence or inside the
   * cool-down, and with `IPB-VID-010` above the skill or product ceiling.
   */
  async requestPromotion(
    ctx: KernelContext,
    skillKey: string,
    g: {
      level: "L3" | "L4";
      budget: Record<string, unknown>;
      scope: Record<string, unknown>;
      killSwitchOwnerId: string;
    },
  ): Promise<{ approvalId: string; grantId: string }> {
    const roles = ctx.principal.roles;
    if (
      ctx.principal.type !== "user" ||
      !(roles.includes("ORG_OWNER") || roles.includes("ORG_ADMIN"))
    )
      throw new IpbError("IPB-VID-012", { detail: "the sponsor must be ORG_OWNER or ORG_ADMIN" });
    if (g.level === "L4" && !roles.includes("ORG_OWNER"))
      throw new IpbError("IPB-VID-012", { detail: "an L4 sponsor must be ORG_OWNER" });
    const skill = this.o.skills.get(skillKey);
    if (!skill) throw new IpbError("IPB-VID-001", { detail: `skill ${skillKey} is not loaded` });
    const ceiling = minLevel(
      skill.manifest.autonomy_ceiling,
      productCeiling(this.o.product, skill.manifest.audience, skillKey),
    );
    if (autonomyRank(g.level) > autonomyRank(ceiling))
      throw new IpbError("IPB-VID-010", { detail: `${skillKey} may not exceed ${ceiling}` });
    const ev = await this.evidence(ctx, skillKey);
    const minRuns = await this.setting<number>(ctx, "vidhi.autonomy.promotion_min_runs", 50);
    const cooldown = await this.setting<number>(
      ctx,
      "vidhi.autonomy.repromotion_cooldown_days",
      30,
    );
    const missing: string[] = [];
    if (ev.demotedAt && Date.now() - ev.demotedAt.getTime() < cooldown * 86_400_000)
      missing.push(`demoted less than ${cooldown} days ago`);
    if (ev.l2Runs < minRuns) missing.push(`${ev.l2Runs} of ${minRuns} L2 runs`);
    if (ev.approvalRate === null || ev.approvalRate < 0.95)
      missing.push(`approval rate ${ev.approvalRate ?? "unknown"} below 0.95`);
    if (ev.incidents > 0) missing.push(`${ev.incidents} guardrail incidents`);
    if (missing.length)
      throw new IpbError("IPB-AI-013", { detail: `promotion refused: ${missing.join("; ")}` });
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const grantId = newId("grt");
        const { id } = await this.o.approvals.request(tx, {
          action: PROMOTE_ACTION,
          riskClass: "R4",
          payload: { grantId, skillKey, level: g.level },
          summary: `Raise ${skillKey} to ${g.level}`,
        });
        await tx.query(
          `insert into vidhi.autonomy_grant
             (id, tenant_id, skill_key, level, sponsor_id, budget, scope, kill_switch_owner_id,
              evidence, approval_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            grantId,
            ctx.tenantId,
            skillKey,
            g.level,
            ctx.principal.id,
            JSON.stringify(g.budget),
            JSON.stringify(g.scope),
            g.killSwitchOwnerId,
            JSON.stringify({ l2_runs: ev.l2Runs, approval_rate: ev.approvalRate, incidents: 0 }),
            id,
          ],
        );
        await this.o.audit.record(tx, {
          action: "vidhi.autonomy.promote.request",
          resourceType: "vidhi_skill",
          resourceId: skillKey,
          after: { grant_id: grantId, level: g.level, approval_id: id },
        });
        return { approvalId: id, grantId };
      },
      { action: "vidhi.autonomy.promote.request" },
    );
  }

  private async executePromotion(
    tx: Tx,
    payload: Record<string, unknown>,
    approvalId: string,
  ): Promise<void> {
    const ctx = tx.ctx;
    const skillKey = String(payload.skillKey);
    const level = String(payload.level) as AutonomyLevel;
    const st = await this.state(tx, ctx.tenantId, skillKey);
    const g = await tx.query(
      `update vidhi.autonomy_grant set state = 'active', granted_at = now()
        where id = $1 and approval_id = $2 and state = 'requested' returning id`,
      [String(payload.grantId), approvalId],
    );
    if (!g.rowCount)
      throw new IpbError("IPB-VID-022", { detail: "the grant is no longer requested" });
    await tx.query(
      `update vidhi.skill_state set operating_level = $3, updated_at = now()
        where tenant_id = $1 and skill_key = $2`,
      [ctx.tenantId, skillKey, level],
    );
    await tx.query(
      `insert into vidhi.autonomy_event (tenant_id, skill_key, from_level, to_level, reason, actor_id)
       values ($1, $2, $3, $4, 'promotion', $5)`,
      [ctx.tenantId, skillKey, st.operating_level, level, ctx.principal.id],
    );
    await this.o.audit.record(tx, {
      action: "vidhi.autonomy.promote",
      resourceType: "vidhi_skill",
      resourceId: skillKey,
      before: { level: st.operating_level },
      after: { level, approval_id: approvalId },
    });
    await this.emit(tx, ctx, {
      tenant_id: ctx.tenantId,
      skill_key: skillKey,
      from: st.operating_level,
      to: level,
      reason: "promotion",
    });
  }

  private async emit(tx: Tx, ctx: KernelContext, data: Record<string, unknown>): Promise<void> {
    if (!this.o.outbox) return;
    await this.o.outbox.publish(tx, "vidhi", {
      envelope: internalEvent({
        product: this.o.product === "PLATFORM" ? "REF" : this.o.product,
        event: VIDHI_EVENTS.AutonomyChanged,
        tenantId: ctx.tenantId,
        data: AutonomyChangedData.parse(data),
      }),
    });
  }
}
