// Notification catalogue (PL3 plan §6.2, PL3-D-20): YAML files validated against the contracts
// schema, plus the catalogue lint that runs in CI (`infrabyx-notify-lint`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { IpbError } from "@infrabyx/contracts/errors";
import {
  NotificationCatalogue,
  type NotificationClass,
  type NotifyChannel,
} from "@infrabyx/contracts/ports";

/** The platform file shipped with this package. */
export const PLATFORM_CATALOGUE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "catalogue",
  "platform.yaml",
);

/** Regulatory classes about collections, recovery or legal or demand notices never use WhatsApp. */
const NEVER_WHATSAPP = /(^|[._])(collection|collections|recovery|legal|demand)([._]|$)/;

export interface LintFinding {
  file: string;
  classId?: string;
  message: string;
}

export interface LintOptions {
  /** `mkt.meta.enabled` (OWN-08): marketing WhatsApp classes are refused while it is false. */
  metaMarketingEnabled?: boolean;
}

/** Lint parsed catalogue documents; returns every finding (empty means clean). */
export function lintCatalogues(
  docs: ReadonlyArray<{ file: string; doc: unknown }>,
  opts: LintOptions = {},
): LintFinding[] {
  const out: LintFinding[] = [];
  const seen = new Map<string, string>();
  for (const { file, doc } of docs) {
    const p = NotificationCatalogue.safeParse(doc);
    if (!p.success) {
      for (const i of p.error.issues)
        out.push({ file, message: `${i.path.join(".")}: ${i.message}` });
      continue;
    }
    for (const c of p.data.classes) {
      const at = (message: string) => out.push({ file, classId: c.id, message });
      const prev = seen.get(c.id);
      if (prev) at(`duplicate class id (also in ${prev})`);
      seen.set(c.id, file);
      const channels = new Set<NotifyChannel>(c.default_channels);
      if (
        c.category === "regulatory" &&
        NEVER_WHATSAPP.test(c.id) &&
        !c.never_channels.includes("whatsapp")
      )
        at("collection, recovery and legal notices must list whatsapp under never_channels");
      if (c.category === "marketing" && channels.has("whatsapp") && !opts.metaMarketingEnabled)
        at("marketing WhatsApp is refused while mkt.meta.enabled is false (OWN-08)");
      if (channels.has("email") && !c.templates.email)
        at("email channel without an email template");
      if (channels.has("sms") && !c.templates.sms) at("sms channel without a DLT template");
      if (channels.has("whatsapp") && !c.templates.whatsapp)
        at("whatsapp channel without a template");
      if (c.templates.whatsapp?.category === "marketing" && c.category !== "marketing")
        at("a WhatsApp marketing template on a non-marketing class");
    }
  }
  return out;
}

export function readCatalogueFiles(
  paths: readonly string[],
): Array<{ file: string; doc: unknown }> {
  const files: string[] = [];
  for (const p of paths) {
    if (statSync(p).isDirectory())
      for (const f of readdirSync(p).sort()) {
        if (/\.ya?ml$/.test(f)) files.push(join(p, f));
      }
    else files.push(p);
  }
  return files.map((file) => ({ file, doc: parse(readFileSync(file, "utf8")) as unknown }));
}

/** The classes in force: the platform file plus the product's files; lint findings refuse to load. */
export class Catalogue {
  private readonly classes = new Map<string, NotificationClass>();

  constructor(docs: ReadonlyArray<{ file: string; doc: unknown }>, opts: LintOptions = {}) {
    const findings = lintCatalogues(docs, opts);
    if (findings.length)
      throw new Error(
        `notification catalogue invalid: ${findings.map((f) => `${f.file} ${f.classId ?? ""} ${f.message}`).join("; ")}`,
      );
    for (const { doc } of docs)
      for (const c of NotificationCatalogue.parse(doc).classes) this.classes.set(c.id, c);
  }

  static load(paths: readonly string[] = [], opts: LintOptions = {}): Catalogue {
    return new Catalogue(readCatalogueFiles([PLATFORM_CATALOGUE_PATH, ...paths]), opts);
  }

  get(id: string): NotificationClass {
    const c = this.classes.get(id);
    if (!c) throw new IpbError("IPB-NTF-002", { meta: { class: id } });
    return c;
  }

  has(id: string): boolean {
    return this.classes.has(id);
  }

  all(): NotificationClass[] {
    return [...this.classes.values()];
  }
}
