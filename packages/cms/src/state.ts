// The content publish state machine (IPB-04 §04.4.3 with the 26 October revisions; PL5 plan §5.3).
// Every move is a named transition; anything else is `IPB-CMS-003` with `reason: transition`.
//
//   draft ──submit──▶ in_review ──approve(checker≠maker)──▶ approved ──schedule──▶ scheduled
//   draft ──submit (legal type or lint flag)──▶ legal_review ──legal_approve──▶ in_review
//   in_review / legal_review ──request_changes(reason)──▶ draft
//   approved ──publish_now(checker)──▶ published;  scheduled ──publish_due(worker)──▶ published
//   scheduled ──unschedule──▶ approved;  published ──unpublish / unpublish_due──▶ archived
//   any edit (body, slug, SEO, blocks) ──edit──▶ draft (voids approval and legal sign-off)
//
// `legal_approve` returns the item to `in_review`, not `approved`: `@IPB-04-AT-03` needs a separate
// checker approval after the legal reviewer (PL5-D-06, PR-034). Agents may only `edit` and
// `submit` (IPB-04 §04.4.3; `IPB-SEC-004` otherwise).
import { IpbError } from "@infrabyx/contracts/errors";

export const STATES = [
  "draft",
  "in_review",
  "legal_review",
  "approved",
  "scheduled",
  "published",
  "archived",
] as const;
export type ContentState = (typeof STATES)[number];

export const TRANSITIONS = {
  edit: {
    from: ["draft", "in_review", "legal_review", "approved", "scheduled", "published", "archived"],
    to: "draft",
  },
  submit: { from: ["draft"], to: "in_review" },
  submit_legal: { from: ["draft"], to: "legal_review" },
  needs_legal: { from: ["in_review"], to: "legal_review" },
  legal_approve: { from: ["legal_review"], to: "in_review" },
  request_changes: { from: ["in_review", "legal_review"], to: "draft" },
  approve: { from: ["in_review"], to: "approved" },
  schedule: { from: ["approved"], to: "scheduled" },
  unschedule: { from: ["scheduled"], to: "approved" },
  publish_now: { from: ["approved"], to: "published" },
  publish_due: { from: ["scheduled"], to: "published" },
  unpublish: { from: ["published"], to: "archived" },
  unpublish_due: { from: ["published"], to: "archived" },
} as const satisfies Record<string, { from: readonly ContentState[]; to: ContentState }>;
export type TransitionName = keyof typeof TRANSITIONS;

/** Transitions an agent principal may perform. */
export const AGENT_TRANSITIONS: ReadonlySet<TransitionName> = new Set([
  "edit",
  "submit",
  "submit_legal",
]);

/** The state a transition leads to from `from`, or `IPB-CMS-003`. */
export function transition(from: ContentState, name: TransitionName): ContentState {
  const t = TRANSITIONS[name];
  if (!(t.from as readonly string[]).includes(from))
    throw new IpbError("IPB-CMS-003", {
      detail: `${name} is not allowed from ${from}`,
      meta: { reason: "transition", from, transition: name },
    });
  return t.to;
}

export const isAgent = (p: { type: string; roles: readonly string[] }) =>
  p.type === "agent" || p.roles.some((r) => r.startsWith("AGT_"));
