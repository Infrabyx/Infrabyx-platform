// Persona, reserved advice and disclosure (IPB-03-56 to 03-58, 03-53, 03-60; PL4 plan §8.2, §8.9).
// - `Vidhi.answer` asks the gateway with the persona prompt (`vidhi.persona@1`), the product, the
//   audience and the user's language; the gateway's guardrails apply as for any call.
// - Reserved advice is routed, not given: when the question asks what to do about the user's own
//   matter, or the output classifier found a recommendation (already replaced by the neutral notice),
//   the answer carries a hand-off card to a human professional, plus the product's contacts (for
//   Udofin, the regulated entity's grievance officer). Wording is neutral platform text; products
//   override it after counsel review (OWNER-QUESTIONS #33).
// - The display name is a brand setting (`vidhi.brand.display_name`): the disclosure says
//   "<name>, an AI assistant", while logs, events, runs and ledger rows keep the kernel id `vidhi`.
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { AiProvenance, type DataBlock } from "@infrabyx/contracts";
import type { LlmGateway, LlmResult, SettingsReader } from "@infrabyx/ai";

export const KERNEL_ID = "vidhi";
export const PERSONA_PROMPT = "vidhi.persona@1";
export const PLAIN_LANGUAGE_PROMPT = "vidhi.plain_language@1";

/** Questions that ask what the user should do about their own matter (IPB-03-57). */
const ADVICE_QUESTIONS: readonly RegExp[] = [
  /\bshould\s+i\b/i,
  /\b(do|would)\s+you\s+(recommend|advise|suggest)\b/i,
  /\bwhat\s+(should|would)\s+(i|you)\s+do\b/i,
  /\bis\s+it\s+(better|wise|safe|a good idea)\s+(to|for me|if i)\b/i,
  /\b(must|ought)\s+i\b/i,
  /\bkya\s+mujhe\b/i,
  /क्या\s+मुझे/u,
];

export function asksForAdvice(question: string): boolean {
  return ADVICE_QUESTIONS.some((re) => re.test(question));
}

export interface HandoffContact {
  role: string;
  label: string;
  /** A product deep link or contact route; never a personal phone or e-mail in platform text. */
  link?: string;
}

/** The routing card the UI renders (IPB-03-57, AT-09). */
export interface HandoffCard {
  kind: "professional_handoff";
  reason: "reserved_advice";
  message: string;
  contacts: HandoffContact[];
}

/** Neutral platform text keys; products override them after counsel review (#33). */
export const HANDOFF_TEXT = {
  message:
    "This is general information about the document, not advice for your own situation. For a decision about your matter, please speak to a qualified professional.",
  professional: "A qualified professional",
} as const;

export interface VidhiAnswer extends LlmResult {
  handoff: HandoffCard | null;
  /** "<display name>, an AI assistant" (IPB-03-58). */
  assistant: string;
}

export function assistantName(displayName?: string | null): string {
  const n = displayName?.trim();
  return `${n ? n : "Vidhi"}, an AI assistant`;
}

/** "27 Oct 2026" in India Standard Time. */
export const labelDate = (d: Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(d);

/**
 * The AI label on every output (IPB-03-53, 03-60; AT-06 and AT-11): "Drafted by Vidhi AI on
 * 27 Oct 2026 using <family>; reviewed by: <name or not yet reviewed>", or with a display name,
 * "Drafted by <name>, an AI assistant, on …".
 */
export function aiLabel(o: {
  displayName?: string | null;
  date: Date;
  modelFamily: string;
  reviewer?: string | null;
}): string {
  const who = o.displayName?.trim() ? assistantName(o.displayName) + "," : "Vidhi AI";
  return `Drafted by ${who} on ${labelDate(o.date)} using ${o.modelFamily}; reviewed by: ${
    o.reviewer?.trim() || "not yet reviewed"
  }`;
}

/** The model family shown in labels: the adapter's provider, never the internal model id. */
export function modelFamily(modelId: string): string {
  const adapter = modelId.split("/")[0] ?? "";
  if (adapter.startsWith("bedrock_claude")) return "Claude (AWS Bedrock, Mumbai)";
  if (adapter.startsWith("gemini")) return "Gemini (Google Vertex AI, Mumbai)";
  if (adapter.startsWith("self_hosted")) return "an open-weights model on Infrabyx infrastructure";
  return adapter || "an AI model";
}

/** The disclosure attached to every artefact (IPB-03-53, AT-06 platform side). */
export interface Disclosure {
  /** The visible label, with the run id: "Drafted by Vidhi AI on … (run run_…)". */
  label: string;
  run_id: string;
  /** The machine-readable sidecar products store as `ai_provenance jsonb`. */
  ai_provenance: AiProvenance;
}

/**
 * Build the label and the `ai_provenance` sidecar for a gateway result. Tenants cannot remove
 * either; a brand display name changes only the wording (IPB-03-58).
 */
export function disclosure(
  r: { runId: string; modelId: string; provenance: AiProvenance },
  o: { displayName?: string | null; reviewer?: string | null; date?: Date } = {},
): Disclosure {
  const sidecar = AiProvenance.parse(r.provenance);
  if (sidecar.run_id !== r.runId) throw new Error("provenance belongs to another run");
  const label = `${aiLabel({
    date: o.date ?? new Date(sidecar.created_at),
    modelFamily: modelFamily(r.modelId),
    ...(o.displayName !== undefined ? { displayName: o.displayName } : {}),
    ...(o.reviewer !== undefined ? { reviewer: o.reviewer } : {}),
  })} (run ${r.runId})`;
  return { label, run_id: r.runId, ai_provenance: sidecar };
}

export interface VidhiOptions {
  gateway: LlmGateway;
  settings: SettingsReader;
  product: string;
  /** Contacts shown on the hand-off card (e.g. Udofin's grievance officer). */
  handoffContacts?: (ctx: KernelContext) => HandoffContact[] | Promise<HandoffContact[]>;
}

export class Vidhi {
  constructor(private readonly o: VidhiOptions) {}

  private async displayName(ctx: KernelContext): Promise<string | null> {
    try {
      const v = await this.o.settings.get(ctx, "vidhi.brand.display_name");
      return typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "vidhi"
        ? v.trim()
        : null;
    } catch {
      return null;
    }
  }

  /** Answer a question as Vidhi, with citations to the data blocks and a hand-off when needed. */
  async answer(
    ctx: KernelContext,
    q: {
      featureKey: string;
      question: string;
      dataClass: LlmResult["dataClass"];
      dataBlocks?: readonly DataBlock[];
      audience: "staff" | "borrower" | "customer";
      language?: string;
      plainLanguage?: boolean;
    },
  ): Promise<VidhiAnswer> {
    const display = await this.displayName(ctx);
    const r = await this.o.gateway.chat(ctx, {
      featureKey: q.featureKey,
      dataClass: q.dataClass,
      promptRef: q.plainLanguage ? PLAIN_LANGUAGE_PROMPT : PERSONA_PROMPT,
      variables: {
        assistant: assistantName(display),
        product: this.o.product,
        audience: q.audience,
        language: q.language ?? "English",
      },
      messages: [{ role: "user", content: q.question }],
      ...(q.dataBlocks ? { dataBlocks: q.dataBlocks } : {}),
    });
    const needsHandoff =
      asksForAdvice(q.question) || r.guard.outputFlags.includes("reserved_advice");
    const handoff: HandoffCard | null = needsHandoff
      ? {
          kind: "professional_handoff",
          reason: "reserved_advice",
          message: HANDOFF_TEXT.message,
          contacts: [
            { role: "professional", label: HANDOFF_TEXT.professional },
            ...((await this.o.handoffContacts?.(ctx)) ?? []),
          ],
        }
      : null;
    return { ...r, handoff, assistant: assistantName(display) };
  }

  /** The disclosure for an answer, with the brand's display name (IPB-03-53, 03-58). */
  async disclose(
    ctx: KernelContext,
    r: Pick<LlmResult, "runId" | "modelId" | "provenance">,
    reviewer?: string,
  ): Promise<Disclosure> {
    return disclosure(r, {
      displayName: await this.displayName(ctx),
      ...(reviewer ? { reviewer } : {}),
    });
  }

  /** The label for an answer (IPB-03-53). */
  async label(
    ctx: KernelContext,
    r: Pick<LlmResult, "modelId">,
    reviewer?: string,
  ): Promise<string> {
    return aiLabel({
      displayName: await this.displayName(ctx),
      date: new Date(),
      modelFamily: modelFamily(r.modelId),
      ...(reviewer ? { reviewer } : {}),
    });
  }
}
