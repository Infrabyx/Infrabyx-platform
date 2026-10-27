// Journey registry (IPB-06-58, §06.4.3). One YAML file per product lists the persona journeys:
// their routes, regulated steps, voice and text twins, AT scripts and click budget (IPB-07). The
// lint fails a route that the app serves but no journey covers and that is not `out_of_journey`,
// and a voice journey without a text twin (`IPB-A11Y-009`, `@IPB-06-AT-07`).
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const route = z.string().regex(/^\/[^\s]*$/, "a route starts with / and has no spaces");
const journeyId = z
  .string()
  .regex(/^[a-z0-9]+(\.[a-z0-9_]+)+$/, "a journey ID is dotted lower case, like udf.borrower.kyc");

export const JourneySchema = z
  .object({
    id: journeyId,
    persona: z.string().min(1),
    title: z.string().min(1),
    routes: z.array(route).min(1),
    regulated_steps: z.array(route).default([]),
    voice: z.boolean().default(false),
    /** The journey that completes the same task by text; the journey itself when it has both. */
    text_twin_journey_id: journeyId.optional(),
    /** IPB-07 click budget for the journey's main task. */
    click_budget: z.number().int().min(1).optional(),
    at_scripts: z.array(z.string().regex(/^[A-Za-z0-9._-]+\.md$/)).default([]),
    isl_tutorial_required: z.boolean().default(false),
    locales_required: z.union([z.literal("all12"), z.array(z.string().min(2))]).optional(),
  })
  .strict();
export type Journey = z.infer<typeof JourneySchema>;

export const JourneyRegistrySchema = z
  .object({
    product: z.string().regex(/^[A-Z]{2,4}$/, "a product code such as UDF or GRP"),
    journeys: z.array(JourneySchema).min(1),
    /** Routes that deliberately belong to no journey (error pages, the component gallery). */
    out_of_journey: z.array(route).default([]),
  })
  .strict();
export type JourneyRegistry = z.infer<typeof JourneyRegistrySchema>;

export interface JourneyLintFinding {
  severity: "error" | "warning";
  /** The error code when the finding has one (`IPB-A11Y-009`). */
  code?: string;
  /** The journey ID, the route, or `registry`. */
  subject: string;
  message: string;
}

export interface JourneyLintOptions {
  /** Every route the app serves. Without it the coverage check is skipped. */
  routes?: readonly string[];
  /** Whether an AT script listed by a journey exists. Without it the file check is skipped. */
  atScriptExists?: (product: string, file: string) => boolean;
}

/** `/x/*` covers `/x` and everything below it; otherwise routes match exactly. */
export function routeCovered(pattern: string, path: string): boolean {
  if (pattern.endsWith("/*")) {
    const base = pattern.slice(0, -2);
    return path === base || path.startsWith(`${base}/`);
  }
  return pattern === path;
}

export function parseJourneyRegistry(text: string): JourneyRegistry {
  return JourneyRegistrySchema.parse(parseYaml(text));
}

export function lintJourneys(raw: unknown, opts: JourneyLintOptions = {}): JourneyLintFinding[] {
  const parsed = JourneyRegistrySchema.safeParse(raw);
  if (!parsed.success)
    return parsed.error.issues.map((i) => ({
      severity: "error" as const,
      subject: i.path.length ? i.path.join(".") : "registry",
      message: i.message,
    }));
  const reg = parsed.data;
  const out: JourneyLintFinding[] = [];
  const err = (subject: string, message: string, code?: string) =>
    out.push(
      code
        ? { severity: "error", code, subject, message }
        : { severity: "error", subject, message },
    );
  const warn = (subject: string, message: string) =>
    out.push({ severity: "warning", subject, message });

  const ids = new Set<string>();
  for (const j of reg.journeys) {
    if (ids.has(j.id)) err(j.id, "duplicate journey ID");
    ids.add(j.id);
  }
  for (const j of reg.journeys) {
    if (j.voice && !j.text_twin_journey_id)
      err(j.id, `Journey ${j.id} has voice=true but no text_twin_journey_id.`, "IPB-A11Y-009");
    if (j.text_twin_journey_id && !ids.has(j.text_twin_journey_id))
      err(j.id, `text_twin_journey_id ${j.text_twin_journey_id} is not a journey in this registry`);
    for (const s of j.regulated_steps)
      if (!j.routes.includes(s))
        err(j.id, `regulated step ${s} is not one of the journey's routes`);
    if (!j.at_scripts.length)
      warn(j.id, "no AT script listed (IPB-06-15 needs one per journey before release)");
    if (opts.atScriptExists)
      for (const f of j.at_scripts)
        if (!opts.atScriptExists(reg.product, f))
          err(j.id, `AT script ${f} not found under at-scripts/${reg.product.toLowerCase()}/`);
  }

  const journeyRoutes = reg.journeys.flatMap((j) => j.routes);
  for (const r of reg.out_of_journey)
    if (journeyRoutes.some((jr) => routeCovered(r, jr)))
      warn(r, "listed in out_of_journey but also in a journey");

  if (opts.routes) {
    for (const r of opts.routes) {
      const inJourney = journeyRoutes.includes(r);
      const excluded = reg.out_of_journey.some((p) => routeCovered(p, r));
      if (!inJourney && !excluded)
        err(r, `route ${r} is in no journey and not marked out_of_journey (IPB-06-58)`);
    }
    for (const jr of new Set(journeyRoutes))
      if (!opts.routes.includes(jr)) warn(jr, "journey route is not served by the app");
  }
  return out;
}
