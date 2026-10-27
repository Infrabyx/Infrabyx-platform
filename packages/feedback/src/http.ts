// The feedback endpoint (`POST /api/feedback`) for the widget, the no-JavaScript `/feedback` form and
// the accessibility report form (IPB-04-98). Framework-free: the app passes the parsed body, its
// CSRF verdict and who is asking, and sends back what this returns. A form post that succeeds is
// redirected to the status page; a refused one re-renders with the error next to the field.
import { isIpbError } from "@infrabyx/contracts/errors";
import type { FeedbackService, Submitter } from "./service.js";

export interface FeedbackPostRequest {
  body: Record<string, unknown>;
  /** The app's CSRF check of the form post (JSON posts rely on the same-origin fetch). */
  csrfOk: boolean;
  /** `json` from the controller's fetch, `form` from the no-JavaScript post. */
  mode: "json" | "form";
  submitter: Submitter;
  /** Where the status page lives; the reference and view key are appended. */
  statusPath?: string;
}

export type FeedbackPostResult =
  | { status: 201; body: { reference: string; status_url: string } }
  | { status: 303; location: string }
  | {
      status: 400 | 403 | 422 | 429;
      body: { code: string; detail: string };
      errors: { fieldId: string; message: string }[];
    };

export async function handleFeedbackPost(
  service: FeedbackService,
  req: FeedbackPostRequest,
): Promise<FeedbackPostResult> {
  if (!req.csrfOk)
    return {
      status: 403,
      body: { code: "IPB-SEC-017", detail: "the form expired; reload and try again" },
      errors: [],
    };
  const body = { ...req.body };
  delete body.csrf;
  // A score radio left on while another type is chosen is UI state, not a field to refuse.
  if (req.mode === "form" && body.type !== "nps") delete body.nps_score;
  for (const k of Object.keys(body)) if (body[k] === "") delete body[k];
  try {
    const r = await service.submit(body, req.submitter);
    const statusUrl = `${req.statusPath ?? "/feedback/status"}/${r.id}?key=${r.viewKey}`;
    return req.mode === "form"
      ? { status: 303, location: statusUrl }
      : { status: 201, body: { reference: r.reference, status_url: statusUrl } };
  } catch (e) {
    if (!isIpbError(e)) throw e;
    const status = e.code === "IPB-FB-002" ? 429 : e.code === "IPB-FB-001" ? 422 : 400;
    const field = body.type === "accessibility" ? "ibx-a11y-summary" : "ibx-fb-summary";
    return {
      status,
      body: { code: e.code, detail: e.detail ?? e.def.title },
      errors: [{ fieldId: field, message: e.detail ?? e.def.title }],
    };
  }
}
