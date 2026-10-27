// Onboarding tours (IPB-07-53, `@IPB-07-AT-19`). At most `tut.tours.max_steps` (7, locked) steps,
// each anchored on a `data-tour-id` element with copy from help keys; never on a regulated-step
// route (`IPB-TUT-003`); skippable at every step and resumable from Help at the step left.
import { z } from "zod";
import { HELP_KEY } from "./entry.js";

export const MAX_TOUR_STEPS = 7;

export const TourSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9_]+)+$/),
    title_key: z.string().regex(HELP_KEY),
    steps: z
      .array(
        z
          .object({
            route: z.string().regex(/^\//),
            target: z.string().regex(/^[a-z0-9_-]+$/, "a data-tour-id value"),
            title_key: z.string().regex(HELP_KEY),
            body_key: z.string().regex(HELP_KEY),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type Tour = z.infer<typeof TourSchema>;

export interface TourLintFinding {
  code?: "IPB-TUT-003";
  tour: string;
  message: string;
}

/**
 * Lint tours against the step ceiling and the regulated-step routes (from the journey registry's
 * `regulated_steps`). Returns the help keys the tours use, for hlp-lint.
 */
export function lintTours(
  raw: readonly unknown[],
  o: { regulatedRoutes?: readonly string[]; maxSteps?: number } = {},
): { findings: TourLintFinding[]; keys: string[] } {
  const max = Math.min(o.maxSteps ?? MAX_TOUR_STEPS, MAX_TOUR_STEPS);
  const regulated = new Set(o.regulatedRoutes ?? []);
  const findings: TourLintFinding[] = [];
  const keys: string[] = [];
  const ids = new Set<string>();
  for (const r of raw) {
    const p = TourSchema.safeParse(r);
    const id = typeof (r as { id?: unknown })?.id === "string" ? (r as { id: string }).id : "?";
    if (!p.success) {
      findings.push({ tour: id, message: z.prettifyError(p.error) });
      continue;
    }
    const t = p.data;
    if (ids.has(t.id)) findings.push({ tour: t.id, message: "duplicate tour ID" });
    ids.add(t.id);
    if (t.steps.length > max)
      findings.push({
        code: "IPB-TUT-003",
        tour: t.id,
        message: `tour has ${t.steps.length} steps; at most ${max}`,
      });
    t.steps.forEach((s, i) => {
      if (regulated.has(s.route))
        findings.push({
          code: "IPB-TUT-003",
          tour: t.id,
          message: `step ${i + 1} targets the regulated step ${s.route}`,
        });
    });
    keys.push(t.title_key, ...t.steps.flatMap((s) => [s.title_key, s.body_key]));
  }
  return { findings, keys };
}

/** One tour's progress as kept in the `tut.progress` USER setting. */
export interface TourState {
  /** Zero-based index of the step to show next. */
  step: number;
  status: "not_started" | "in_progress" | "skipped" | "completed";
}
export type TourProgress = Readonly<Record<string, TourState>>;

const NOT_STARTED: TourState = { step: 0, status: "not_started" };

export function tourState(progress: TourProgress, id: string): TourState {
  return progress[id] ?? NOT_STARTED;
}

/** The pure state machine; callers persist the returned progress to `tut.progress`. */
export const tourActions = {
  start(progress: TourProgress, tour: Tour): TourProgress {
    return { ...progress, [tour.id]: { step: 0, status: "in_progress" } };
  },
  next(progress: TourProgress, tour: Tour): TourProgress {
    const s = tourState(progress, tour.id);
    const step = s.step + 1;
    return {
      ...progress,
      [tour.id]:
        step >= tour.steps.length
          ? { step: tour.steps.length, status: "completed" }
          : { step, status: "in_progress" },
    };
  },
  /** Skip at the current step; the step is kept so Help can resume there. */
  skip(progress: TourProgress, tour: Tour): TourProgress {
    const s = tourState(progress, tour.id);
    return { ...progress, [tour.id]: { step: s.step, status: "skipped" } };
  },
  /** Re-launch from Help: resumes at the step left, or restarts a completed tour. */
  resume(progress: TourProgress, tour: Tour): TourProgress {
    const s = tourState(progress, tour.id);
    return {
      ...progress,
      [tour.id]: { step: s.status === "completed" ? 0 : s.step, status: "in_progress" },
    };
  },
};

/**
 * Whether a tour may start by itself on `route`: only when `tut.tours.auto_start` is on, the tour
 * has not been seen, and the route is not a regulated step (IPB-07-53).
 */
export function mayAutoStart(
  tour: Tour,
  progress: TourProgress,
  route: string,
  o: { autoStart: boolean; regulatedRoutes: readonly string[] },
): boolean {
  if (!o.autoStart || o.regulatedRoutes.includes(route)) return false;
  return tourState(progress, tour.id).status === "not_started" && tour.steps[0]?.route === route;
}
