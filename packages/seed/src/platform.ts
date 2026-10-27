// Platform seed module: the three seed tenants (IPB-11-26), persona users and memberships
// (IPB-11-27, IPB-11-32), and an explicit OFF for every switchable fut.* flag (IPB-11-29,
// PL1-D-10). Settings stay at their registry defaults; nothing production-only is written.
import { defaultFlagRegistry } from "@infrabyx/config/flags";
import { deterministicId } from "@infrabyx/crypto";
import {
  SEED_EPOCH,
  SEED_PRINCIPAL,
  defineSeedModule,
  type SeedModuleContext,
} from "./framework.js";
import { personaEmail, personasFor, type Persona } from "./personas/index.js";

export const SEED_TENANTS = [
  { tenant: "platform", id: "tnt_platform", product: "PLATFORM", name: "Infrabyx" },
  { tenant: "demo", id: "tnt_demo", product: null, name: "Demo Co" },
  { tenant: "sandbox", id: "tnt_sandbox", product: null, name: "Sandbox" },
] as const;

/** Deterministic user id for a persona email (IPB-11-23). */
export const personaUserId = (email: string): string =>
  deterministicId("usr", "tenancy.user", email.toLowerCase(), SEED_EPOCH);

export function seedPersonas(
  ctx: Pick<SeedModuleContext, "product"> & { superAdminEmail?: string | undefined },
): Array<Persona & { email: string; userId: string }> {
  return personasFor(ctx.product, ctx.superAdminEmail).map((p) => {
    const email = personaEmail(p, ctx.product);
    return { ...p, email, userId: personaUserId(email) };
  });
}

export const platformSeedModule = defineSeedModule({
  module: "platform",
  profiles: ["dev", "demo", "test", "load"],
  async run(ctx) {
    const personas = seedPersonas(ctx);
    await ctx.write("platform", async (w) => {
      for (const t of SEED_TENANTS) {
        await w.upsert({
          table: "tenancy.tenant",
          key: { id: t.id },
          values: {
            product: t.product ?? ctx.product,
            name: t.name,
            status: "active",
            residency: "IN",
            brand_id: t.tenant === "demo" ? "brand_demo_co" : null,
          },
        });
      }
      for (const p of personas) {
        await w.upsert({
          table: "tenancy.user",
          key: { id: p.userId },
          values: { idp_subject: `seed:${p.userId}`, type: "user", status: "active" },
        });
      }
      for (const f of defaultFlagRegistry.all()) {
        if (f.kind !== "fut" || f.locked) continue;
        await w.upsert({
          table: "config.flag_value",
          key: { flag_key: f.key },
          values: { value: false, updated_by: SEED_PRINCIPAL.id },
          json: ["value"],
        });
      }
    });
    for (const tenant of ["platform", "demo", "sandbox"] as const) {
      const members = personas.filter((p) => p.tenant === tenant);
      if (members.length === 0) continue;
      await ctx.write(tenant, async (w) => {
        for (const p of members) {
          await w.upsert({
            table: "tenancy.membership",
            key: { tenant_id: ctx.tenantIds[tenant], user_id: p.userId },
            values: { roles: [p.role], product_scope: [...(p.productScope ?? [])] },
          });
        }
      });
    }
  },
});
