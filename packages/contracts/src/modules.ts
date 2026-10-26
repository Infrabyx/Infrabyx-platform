// Module manifest (IPB-01-10, §01.4.3.2). Validated at boot; boot fails with IPB-MOD-001.
import { z } from "zod";
import { DataClass } from "./data-class.js";
import { INTERNAL_TYPE_REGEX, ECOSYSTEM_TYPE_REGEX } from "./events/envelope.js";
import { PORT_NAMES } from "./ports/catalogue.js";

const eventType = z
  .string()
  .refine((t) => INTERNAL_TYPE_REGEX.test(t) || ECOSYSTEM_TYPE_REGEX.test(t), "invalid event type");

export const ModuleManifest = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    schema: z.string().regex(/^[a-z][a-z0-9_]*$/),
    boundedContext: z.string().min(3),
    owner: z.string().min(1),
    publishes: z.array(eventType).default([]),
    consumes: z.array(eventType).default([]),
    ports: z.array(z.enum(PORT_NAMES)).default([]),
    settingsPrefix: z.string().regex(/^[a-z][a-z0-9_]*\.$/),
    settings: z.array(z.string()).default([]),
    helpKeys: z.array(z.string().regex(/^hlp\.[a-z0-9_]+\.[a-z0-9_.]+$/)).default([]),
    dataClasses: z.array(DataClass).min(1),
    extractionReadiness: z.number().int().min(0).max(3),
    rlsTables: z.array(z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/)).default([]),
  })
  .strict()
  .superRefine((m, ctx) => {
    for (const [i, t] of m.rlsTables.entries()) {
      if (!t.startsWith(`${m.schema}.`)) {
        ctx.addIssue({
          code: "custom",
          path: ["rlsTables", i],
          message: `table ${t} is outside schema ${m.schema} (IPB-01-09)`,
        });
      }
    }
    for (const [i, k] of m.settings.entries()) {
      if (!k.startsWith(m.settingsPrefix)) {
        ctx.addIssue({
          code: "custom",
          path: ["settings", i],
          message: `setting ${k} is outside prefix ${m.settingsPrefix}`,
        });
      }
    }
  });
export type ModuleManifest = z.infer<typeof ModuleManifest>;
export type ModuleManifestInput = z.input<typeof ModuleManifest>;

/** Declare a module manifest. Parsing happens here so an invalid manifest fails at import time in tests. */
export function defineModule(m: ModuleManifestInput): ModuleManifest {
  return ModuleManifest.parse(m);
}
