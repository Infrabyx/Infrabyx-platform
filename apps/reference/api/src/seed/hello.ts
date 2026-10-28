// The hello module's seed (IPB-11 §11.3; PL6 plan §8.1). Run with
//   infrabyx-seed --profile dev --modules apps/reference/api/dist/seed/hello.js
// It writes a few greetings into the demo and sandbox tenants with deterministic ids, through the
// seed framework's writer (one kernel transaction and one ledger entry per tenant). The seed never
// runs in prod, dr or pre-prod (`assertSeedAllowed`, PL1-D-06).
import { defineSeedModule, type SeedModule } from "@infrabyx/seed";
import { checkMessage, HELLO_MESSAGE_CEILING } from "../modules/hello/service.js";

const GREETINGS: ReadonlyArray<{ tenant: "demo" | "sandbox"; key: string; message: string }> = [
  { tenant: "demo", key: "welcome", message: "Welcome to the reference application." },
  {
    tenant: "demo",
    key: "pattern",
    message: "Every write goes through the kernel, with its ledger entry.",
  },
  {
    tenant: "sandbox",
    key: "welcome",
    message: "A sandbox greeting, visible to the sandbox tenant only.",
  },
];

export const helloSeedModule: SeedModule = defineSeedModule({
  module: "hello",
  profiles: ["dev", "demo", "test"],
  dependsOn: ["platform"],
  async run(ctx) {
    for (const tenant of ["demo", "sandbox"] as const) {
      await ctx.write(tenant, async (w) => {
        for (const g of GREETINGS.filter((x) => x.tenant === tenant)) {
          await w.upsert({
            table: "hello.greeting",
            key: { tenant_id: ctx.tenantIds[tenant], created_by: `seed:${g.key}` },
            values: { message: checkMessage(g.message, HELLO_MESSAGE_CEILING) },
            id: { prefix: "grt" },
          });
        }
      });
    }
  },
});

/** What `infrabyx-seed --modules` imports. */
export const seedModules: SeedModule[] = [helloSeedModule];
