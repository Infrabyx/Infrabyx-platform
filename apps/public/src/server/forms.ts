// Published forms and their consent texts (the exact text the visitor is asked to agree to).
import type { FormDefinition } from "../render/blocks.tsx";
import type { RequestContext } from "./request.ts";
import { listed } from "./site.ts";

export async function formsFor(ctx: RequestContext): Promise<Map<string, FormDefinition>> {
  const items = await listed(ctx.site, ctx.packId, "form");
  const out = new Map<string, FormDefinition>();
  for (const f of items) {
    const body = f.body as unknown as FormDefinition["body"] & { consent_text_ref?: string };
    const key =
      body.consent_text_ref ??
      (body.destination === "hr_application" ? "consent.careers" : "consent.contact_form");
    const text = await ctx.site.texts.current(key, { region: ctx.region });
    out.set(f.id, {
      id: f.id,
      title: f.title,
      body,
      consentText: text?.body ?? "I agree that you may use these details to answer my message.",
    });
  }
  return out;
}

/** Errors a refused form post carried back (`?form=<id>&e=<base64url JSON>`). */
export function formStateFrom(sp: Record<string, string | string[] | undefined>) {
  const formId = typeof sp.form === "string" ? sp.form : undefined;
  const e = typeof sp.e === "string" ? sp.e : undefined;
  if (!formId || !e) return undefined;
  try {
    const errors = JSON.parse(Buffer.from(e, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(errors)) return undefined;
    return {
      formId,
      errors: errors
        .filter(
          (x): x is { fieldId: string; message: string } =>
            typeof x?.fieldId === "string" && typeof x?.message === "string",
        )
        .slice(0, 20)
        .map((x) => ({ fieldId: x.fieldId.slice(0, 60), message: x.message.slice(0, 200) })),
    };
  } catch {
    return undefined;
  }
}
