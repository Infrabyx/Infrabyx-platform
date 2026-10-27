// Guardrails (IPB-03-33 to 03-39; PL4 plan §4.6). Rule-based in PL4 (A-06): a model-based
// classifier can replace either check behind the same functions once a provider is approved.
// - Input: prompt-injection and jailbreak likelihood over the caller's own messages (data blocks
//   are neutralised separately, IPB-03-34). A score at or above `ai.guard.input_threshold.<f>`
//   blocks the request before routing.
// - Output: PII the inputs did not carry (every input value was tokenised, so any detection in the
//   raw output is new), hidden context echoed back (system prompt, data instruction), citations to
//   sources outside the retrieved set, and reserved advice. Each hit is redacted or the answer is
//   withheld, per `ai.guard.output_policy.<f>`; every hit is recorded on the run.
// Toxicity has an interface (`flags` may carry it) and no detector in PL4.
import { DATA_INSTRUCTION } from "./separation.js";
import type { Scrubber } from "./scrub.js";

export interface InputVerdict {
  /** 0..1; combined as 1 − Π(1 − weight) over the distinct patterns that matched. */
  score: number;
  hits: string[];
}

const INPUT_PATTERNS: readonly { name: string; re: RegExp; weight: number }[] = [
  {
    name: "ignore_previous",
    re: /\b(ignore|disregard|forget|skip)\b[^.\n]{0,30}\b(previous|prior|above|earlier|preceding|all|your|system)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|directions|guidelines|training)\b/i,
    weight: 0.8,
  },
  {
    name: "override",
    re: /\b(override|bypass|disable|turn off|circumvent)\b[^.\n]{0,20}\b(instructions?|rules|safety|filters?|guardrails?|restrictions|policies|content policy)\b/i,
    weight: 0.75,
  },
  {
    name: "reveal_hidden",
    re: /\b(reveal|print|show|repeat|output|display|tell me|give me|leak)\b[^.\n]{0,25}\b(system prompt|initial prompt|hidden (prompt|context|instructions)|your instructions|the instructions above|developer message|tool schemas?)\b/i,
    weight: 0.75,
  },
  { name: "dan", re: /\b(do anything now|DAN mode|\bDAN\b|jailbreak(ed)?)\b/i, weight: 0.75 },
  {
    name: "developer_mode",
    re: /\b(developer|god|admin|sudo|debug) mode\b/i,
    weight: 0.5,
  },
  {
    name: "unrestricted",
    re: /\b(pretend|imagine|act as if|behave as if)\b[^.\n]{0,30}\b(no|without|free of)\b[^.\n]{0,15}\b(restrictions|rules|filters|limits|guidelines|policies)\b/i,
    weight: 0.7,
  },
  {
    name: "persona_swap",
    re: /\b(you are now|from now on you are|act as|roleplay as)\b[^.\n]{0,30}\b(unrestricted|unfiltered|evil|jailbroken|uncensored|an? AI without)\b/i,
    weight: 0.7,
  },
  { name: "you_are_now", re: /\byou are now\b/i, weight: 0.3 },
  { name: "role_header", re: /^\s*(system|assistant|developer)\s*:/im, weight: 0.5 },
  {
    name: "role_headers_forged_turns",
    re: /^\s*(system|assistant|developer|user)\s*:[\s\S]*^\s*(system|assistant|developer|user)\s*:/im,
    weight: 0.5,
  },
  { name: "role_tag", re: /<\/?(system|instructions?|developer)>/i, weight: 0.5 },
  { name: "new_instructions", re: /\bnew (system )?instructions?\s*:/i, weight: 0.75 },
  {
    name: "begin_override",
    re: /\b(BEGIN|START) (SYSTEM|ADMIN|DEVELOPER) (PROMPT|OVERRIDE|INSTRUCTIONS)\b/i,
    weight: 0.7,
  },
  // Hindi and Hinglish ("ignore the previous instructions").
  {
    name: "ignore_previous_hi",
    re: /(पिछले|पहले के|सभी)[^.\n]{0,20}(निर्देशों|निर्देश|नियमों)[^.\n]{0,10}(अनदेखा|नज़रअंदाज़|नजरअंदाज|भूल)/u,
    weight: 0.8,
  },
  {
    name: "ignore_previous_hinglish",
    re: /\b(pichhle|pichle|purane|saare|sabhi)\b[^.\n]{0,20}\b(nirdesh|instructions?|rules)\b[^.\n]{0,15}\b(ignore|bhool|bhul|anadekha)\b/i,
    weight: 0.8,
  },
];

/** Injection and jailbreak likelihood of the caller's own text. */
export function classifyInput(texts: readonly string[]): InputVerdict {
  const hits = new Set<string>();
  for (const t of texts) for (const p of INPUT_PATTERNS) if (p.re.test(t)) hits.add(p.name);
  let keep = 1;
  for (const p of INPUT_PATTERNS) if (hits.has(p.name)) keep *= 1 - p.weight;
  return { score: Math.round((1 - keep) * 1000) / 1000, hits: [...hits] };
}

/** Sentences that recommend a course of action for the user's own matter (IPB-03-57). */
const RESERVED_ADVICE: readonly RegExp[] = [
  /\byou\b[^.!?\n]{0,20}\b(should|must|ought to|need to|have to|had better)\b[^.!?\n]{0,25}\b(sign|invest|buy|sell|file|sue|plead|settle|borrow|withdraw|transfer|accept|reject|claim|deduct|default|prepay|refinance|foreclose|surrender|switch|cancel|terminate|exit|decline|opt out|close|take|stop paying|stop taking|start taking|take out|appeal)\b/i,
  /\bI\b[^.!?\n]{0,15}\b(recommend|advise|suggest|urge)\b[^.!?\n]{0,15}\byou\b[^.!?\n]{0,25}\b(sign|invest|buy|sell|file|sue|plead|settle|borrow|withdraw|accept|reject|claim|appeal|prepay|refinance|foreclose|surrender|switch|cancel|terminate|exit|decline)\b/i,
  /\bmy (legal|financial|tax|investment|medical) advice\b/i,
  /\b(best|right) (option|choice|move) for you is to\b/i,
  /\baapko\b[^.!?\n]{0,25}\b(sign|invest|case|loan|claim)\b[^.!?\n]{0,20}\b(karna|kar|lena|le)\s+(chahiye|lena chahiye)\b/i,
];

/** Neutral platform text (OWNER-QUESTIONS #33): products override it after counsel review. */
export const RESERVED_ADVICE_NOTICE =
  "[A recommendation for your own matter was withheld; a qualified professional can advise you.]";
export const REDACTED = "[redacted]";
export const WITHHELD = "[withheld]";
const CITATION = /\[source:([A-Za-z0-9_.:/-]{1,128})\]/g;

export type OutputPolicy = "redact" | "refuse";
export type GuardKind = "injection" | "leak" | "reserved_advice" | "citation" | "schema";

export interface OutputCheck {
  /** The text after redaction ("" when withheld). Tokens are not yet restored. */
  text: string;
  /** Flags recorded on the run: pii_leak, context_leak, citation_unknown, reserved_advice. */
  flags: string[];
  events: { kind: GuardKind; action: "redact" | "refuse" }[];
  /** True when the policy is refuse and something was hit (IPB-AI-042). */
  blocked: boolean;
  /** Known source ids the answer cites, in order of first citation. */
  cited: string[];
}

export interface OutputCheckOptions {
  scrubber: Scrubber;
  /** The rendered system prompt; long sentences of it must not be echoed (IPB-03-39). */
  systemPrompt: string;
  /** Source ids of the request's data blocks; null when nothing was retrieved. */
  sourceIds: ReadonlySet<string> | null;
  policy: OutputPolicy;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Check one model output (before tokens are restored). */
export function checkOutput(raw: string, o: OutputCheckOptions): OutputCheck {
  const flags = new Set<string>();
  const events: OutputCheck["events"] = [];
  let text = raw;

  // New PII: every input value was tokenised, so whatever the detectors find here is new.
  const s = o.scrubber.session();
  const scanned = s.scrub(text, { defuse: false });
  if (s.detections.length) {
    flags.add("pii_leak");
    events.push({ kind: "leak", action: o.policy });
    text = scanned.replace(/<PII:[A-Z][A-Z0-9_]*:\d+>/g, (t) => (s.has(t) ? REDACTED : t));
  }

  // Hidden context echoed back.
  const secrets = [
    DATA_INSTRUCTION,
    ...o.systemPrompt
      .split(/(?<=[.!?])\s+|\n+/)
      // A model echoes a bulleted rule without its bullet.
      .map((x) => x.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, ""))
      .filter((x) => x.length >= 40),
  ];
  for (const sentence of secrets) {
    const re = new RegExp(escapeRe(sentence), "gi");
    if (re.test(text)) {
      flags.add("context_leak");
      text = text.replace(re, WITHHELD);
    }
  }
  if (flags.has("context_leak")) events.push({ kind: "leak", action: o.policy });

  // Citations outside the retrieved set.
  const cited: string[] = [];
  text = text.replace(CITATION, (m, id: string) => {
    if (o.sourceIds?.has(id)) {
      if (!cited.includes(id)) cited.push(id);
      return m;
    }
    flags.add("citation_unknown");
    return "";
  });
  if (flags.has("citation_unknown")) events.push({ kind: "citation", action: o.policy });

  // Reserved advice, sentence by sentence.
  const parts = text.split(/(?<=[.!?])(\s+)/);
  let advised = false;
  text = parts
    .map((p) => {
      if (RESERVED_ADVICE.some((re) => re.test(p))) {
        advised = true;
        return RESERVED_ADVICE_NOTICE;
      }
      return p;
    })
    .join("");
  if (advised) {
    flags.add("reserved_advice");
    events.push({ kind: "reserved_advice", action: o.policy });
  }

  const blocked = o.policy === "refuse" && flags.size > 0;
  return { text: blocked ? "" : text, flags: [...flags], events, blocked, cited };
}
