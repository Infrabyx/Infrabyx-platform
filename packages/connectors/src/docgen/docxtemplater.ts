// DOCGEN reference adapter `docxtemplater` (IPB-01 DOCGEN's named reference; regulatory templates
// plan §8, item (c); owner answer 6, R1-D-301; R1-D-314): a product's tagged `.docx` templates
// filled in-process, then, for PDF and PDF/A, converted by Gotenberg's LibreOffice route.
//   * Tags: `{field}` and loops `{#items}…{/items}` only; names `[A-Za-z_][A-Za-z0-9_]*`. A raw-XML
//     tag `{@…}`, an inverted section `{^…}`, a dotted name or any other syntax is refused: no code
//     and no conditions in templates (conditions are decided in data).
//   * Data: a field is text, a number or a boolean; a loop is an array of objects (a boolean or an
//     object would make it a condition). Lookups read own properties only, innermost scope first,
//     so a tag can never reach a prototype. Every field must be bound: a missing one is refused
//     `binding_missing` with the field names, never rendered empty; extra keys are ignored.
//   * Values are XML-escaped (the library's default): a value can never add a paragraph, a field
//     or a link. Line breaks in a value become breaks.
//   * Template safety, checked by `validateTemplate` and before every render: no macros, ActiveX,
//     OLE embeddings or altChunk; no external relationship but an https hyperlink; no INCLUDETEXT,
//     INCLUDEPICTURE, DDE, DDEAUTO, LINK, IMPORT or DATABASE field; a size cap. A template is read
//     from STORAGE by reference and refused unless its bytes have the referenced SHA-256.
//   * Errors name tags, parts and reasons only, never a data value (data may be personal).
import { createRequire } from "node:module";
import { PortError } from "@infrabyx/contracts/errors";
import {
  HtmlRenderRequest,
  RenderRequest,
  type AdapterDescriptor,
  type BucketClass,
  type DocFileRef,
  type DocgenPort,
  type PortCall,
  type PortHealth,
  type RenderedDocument,
  type StoragePort,
  type TemplateInfo,
  isValidStorageKey,
} from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import { pageCount } from "./gotenberg.js";

// The libraries are CommonJS; loaded once, here only (vendor code stays in this folder).
const require = createRequire(import.meta.url);
const Docxtemplater = require("docxtemplater") as DocxtemplaterCtor;
const InspectModule = require("docxtemplater/js/inspect-module.js") as new () => Inspector;
const PizZip = require("pizzip") as new (data?: Uint8Array) => Zip;

interface Zip {
  files: Record<string, { name: string; dir: boolean; asText(): string }>;
  file(name: string): { asText(): string } | null;
}
interface Part {
  type: string;
  value: string;
  module?: string;
  inverted?: boolean;
  raw?: string;
  subparsed?: Part[];
}
interface Inspector {
  getAllStructuredTags(): Part[];
}
interface Templater {
  render(data: Record<string, unknown>): void;
  getZip(): { generate(o: { type: "nodebuffer"; compression: "DEFLATE" }): Buffer };
}
type DocxtemplaterCtor = new (zip: Zip, o: Record<string, unknown>) => Templater;

const PORT = "DOCGEN";
const ADAPTER = "docxtemplater";
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNSAFE_FIELD = /\b(INCLUDETEXT|INCLUDEPICTURE|DDEAUTO|DDE|LINK|IMPORT|DATABASE)\b/i;
const MAX_PROBLEMS = 50;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A product's template, by id, in its own store: the current version and its file. */
export interface DocgenTemplate {
  templateId: string;
  version: string;
  file: DocFileRef;
}

/** Where the product keeps its tagged templates (plan §4: each product tags its own). */
export interface DocgenTemplateStore {
  list(tenantId: string): Promise<readonly DocgenTemplate[]>;
  get(tenantId: string, templateId: string): Promise<DocgenTemplate | undefined>;
}

/** What converts a filled `.docx` to PDF or PDF/A (`GotenbergDocgen` is one). */
export interface DocxConverter {
  convertDocx(docx: Uint8Array, format: "pdf" | "pdfa"): Promise<Uint8Array>;
  renderHtml?: DocgenPort["renderHtml"];
}

export interface DocxtemplaterDocgenOptions {
  /** The tenant's STORAGE: templates are read from it and documents written to it. */
  storage: StoragePort;
  templates: DocgenTemplateStore;
  /** For `pdf` and `pdfa` (and `renderHtml`); without it only `docx` renders. */
  converter?: DocxConverter;
  /** STORAGE bucket class of rendered documents (default `CONFIDENTIAL`). */
  bucketClass?: BucketClass;
  /** Largest template accepted (default 10 MiB). */
  maxTemplateBytes?: number;
}

const refused = (reason: string, detail: string, meta: Record<string, unknown> = {}) =>
  new PortError("IPB-PORT-001", PORT, { adapter: ADAPTER, detail, meta: { reason, ...meta } });

const cap = (xs: string[]) => (xs.length > MAX_PROBLEMS ? [...xs.slice(0, MAX_PROBLEMS), "…"] : xs);

/** The problems that make a template unsafe to render (see the file header). */
export function templateSafetyProblems(zip: Zip): string[] {
  const problems: string[] = [];
  const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
  const ct = zip.file("[Content_Types].xml")?.asText() ?? "";
  if (/macroEnabled|vbaProject/i.test(ct))
    problems.push("[Content_Types].xml: macro-enabled content");
  for (const n of names) {
    if (/(^|\/)vbaProject\.bin$/i.test(n)) problems.push(`${n}: a macro project`);
    if (/^word\/activeX\//i.test(n)) problems.push(`${n}: an ActiveX control`);
    if (/^word\/embeddings\//i.test(n)) problems.push(`${n}: an embedded object`);
  }
  for (const n of names.filter((x) => x.endsWith(".rels"))) {
    for (const m of zip
      .file(n)!
      .asText()
      .matchAll(/<Relationship\b[^>]*>/g)) {
      const type = /\bType="([^"]*)"/.exec(m[0])?.[1] ?? "";
      const target = /\bTarget="([^"]*)"/.exec(m[0])?.[1] ?? "";
      const kind = type.split("/").pop() ?? "";
      if (/^(aFChunk|oleObject|package|subDocument|attachedTemplate|frame)$/.test(kind))
        problems.push(`${n}: a ${kind} relationship`);
      else if (/\bTargetMode="External"/.test(m[0])) {
        const https = (() => {
          try {
            const u = new URL(target.replace(/&amp;/g, "&"));
            return u.protocol === "https:" && u.username === "" && u.password === "";
          } catch {
            return false;
          }
        })();
        if (kind !== "hyperlink" || !https)
          problems.push(
            `${n}: an external ${kind || "relationship"} (only https hyperlinks are allowed)`,
          );
      }
    }
  }
  for (const n of names.filter((x) => /^word\/[^/]+\.xml$/.test(x))) {
    const xml = zip.file(n)!.asText();
    if (/<w:altChunk\b/.test(xml)) problems.push(`${n}: an altChunk import`);
    const instr = [
      ...[...xml.matchAll(/<w:instrText\b[^>]*>([^<]*)<\/w:instrText>/g)].map((x) => x[1]),
      ...[...xml.matchAll(/<w:fldSimple\b[^>]*\bw:instr="([^"]*)"/g)].map((x) => x[1]),
    ].join(" ");
    const f = UNSAFE_FIELD.exec(instr);
    if (f) problems.push(`${n}: a ${f[1]!.toUpperCase()} field`);
  }
  return problems;
}

/** The problems with the template's tags: only fields and loops, named plainly. */
function tagProblems(tags: readonly Part[], path = ""): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (t.type !== "placeholder") continue;
    const at = `${path}${t.value}`;
    if (t.module === "rawxml") out.push(`{@${t.value}}: raw XML tags are not allowed`);
    else if (t.module === "loop" && t.inverted)
      out.push(`{^${t.value}}: inverted sections are not allowed`);
    else if (t.module !== undefined && t.module !== "loop")
      out.push(`{${t.raw ?? t.value}}: this tag kind is not allowed`);
    if (!NAME.test(t.value))
      out.push(`{${t.raw ?? t.value}}: names are letters, digits and _ only`);
    if (t.module === "loop") out.push(...tagProblems(t.subparsed ?? [], `${at}[].`));
  }
  return out;
}

/** Look `name` up as the library will: own properties, innermost scope first. */
function lookup(scopes: readonly Record<string, unknown>[], name: string): unknown {
  for (let i = scopes.length - 1; i >= 0; i--)
    if (Object.hasOwn(scopes[i]!, name)) return scopes[i]![name];
  return undefined;
}

const plainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;

/** Missing bindings and wrongly typed values for `tags` over `scopes`. */
function dataProblems(
  tags: readonly Part[],
  scopes: readonly Record<string, unknown>[],
  path: string,
  missing: Set<string>,
  invalid: Set<string>,
): void {
  for (const t of tags) {
    if (t.type !== "placeholder") continue;
    const at = `${path}${t.value}`;
    const v = lookup(scopes, t.value);
    if (t.module === "loop") {
      if (v === undefined || v === null) {
        missing.add(at);
        continue;
      }
      if (!Array.isArray(v)) {
        invalid.add(`${at}: a loop takes an array of objects (conditions are decided in data)`);
        continue;
      }
      v.forEach((item) => {
        if (!plainObject(item)) invalid.add(`${at}: each item of a loop is an object`);
        else dataProblems(t.subparsed ?? [], [...scopes, item], `${at}[].`, missing, invalid);
      });
    } else if (v === undefined || v === null) missing.add(at);
    else if (!["string", "number", "boolean"].includes(typeof v))
      invalid.add(`${at}: a field takes text, a number or a boolean`);
    else if (typeof v === "number" && !Number.isFinite(v))
      invalid.add(`${at}: not a finite number`);
  }
}

/** The library's own syntax errors as problems (tag and reason only). */
function syntaxProblems(e: unknown): string[] {
  const errs = (e as { properties?: { errors?: unknown[] } }).properties?.errors ?? [e];
  return errs.map((x) => {
    const p =
      (x as { properties?: { id?: string; xtag?: string; file?: string } }).properties ?? {};
    return `${p.file ?? "template"}: ${p.id ?? "template_error"}${p.xtag ? ` at {${p.xtag}}` : ""}`;
  });
}

const STRICT_PARSER = (tag: string) => ({
  get(scope: unknown) {
    if (tag === ".") return scope;
    return plainObject(scope) && Object.hasOwn(scope, tag) ? scope[tag] : undefined;
  },
});

export class DocxtemplaterDocgen implements DocgenPort {
  readonly descriptor: AdapterDescriptor;

  constructor(private readonly o: DocxtemplaterDocgenOptions) {
    const caps: Record<string, "unsupported"> = { previewHtml: "unsupported" };
    if (!o.converter?.renderHtml) caps.renderHtml = "unsupported";
    this.descriptor = {
      port: PORT,
      adapter: ADAPTER,
      residency: "IN",
      maxDataClass: "CONFIDENTIAL",
      capabilities: caps,
    };
  }

  async health(): Promise<PortHealth> {
    // In-process: up whenever the library loads (it did, at import).
    return { status: "up", latency_ms: 0, checked_at: new Date().toISOString() };
  }

  /** The template's bytes, from STORAGE, refused unless they have the referenced SHA-256. */
  private async read(file: DocFileRef): Promise<Uint8Array> {
    const o = await this.o.storage.get(file.storageKey);
    const max = this.o.maxTemplateBytes ?? 10 * 1024 * 1024;
    if (o.body.length > max)
      throw refused("template_too_large", `a template is at most ${max} bytes`);
    if (sha256Hex(o.body) !== file.sha256)
      throw refused("template_changed", "the template's bytes do not have the referenced SHA-256");
    return o.body;
  }

  /** Compile and inspect: the library's syntax checks, then the safety and tag rules. */
  private compile(bytes: Uint8Array, missing?: Set<string>) {
    let zip: Zip;
    try {
      zip = new PizZip(bytes);
    } catch {
      throw refused("template_invalid", "the template is not a .docx (ZIP) file");
    }
    if (!zip.file("word/document.xml"))
      throw refused("template_invalid", "the template has no word/document.xml");
    const unsafe = templateSafetyProblems(zip);
    if (unsafe.length)
      throw refused("template_unsafe", "the template is not safe to render", {
        problems: cap(unsafe),
      });
    const inspector = new InspectModule();
    let doc: Templater;
    try {
      doc = new Docxtemplater(zip, {
        modules: [inspector],
        paragraphLoop: true,
        linebreaks: true,
        errorLogging: false,
        parser: STRICT_PARSER,
        nullGetter: (part: Part) => {
          // A backstop: every binding is checked before rendering.
          missing?.add(part.value);
          return "";
        },
      });
    } catch (e) {
      throw refused("template_invalid", "the template's tags do not parse", {
        problems: cap(syntaxProblems(e)),
      });
    }
    const tags = inspector.getAllStructuredTags();
    const bad = tagProblems(tags);
    if (bad.length)
      throw refused("template_unsafe", "the template uses tags that are not allowed", {
        problems: cap(bad),
      });
    return { doc, tags };
  }

  private async template(tenantId: string, templateId: string): Promise<DocgenTemplate> {
    const t = await this.o.templates.get(tenantId, templateId);
    if (!t) throw refused("template_not_found", `no template ${templateId}`);
    return t;
  }

  async render(raw: unknown, _call?: PortCall): Promise<RenderedDocument> {
    const req = RenderRequest.parse(raw);
    if (req.format === "html")
      throw refused("unsupported", "the docxtemplater adapter renders docx, pdf and pdfa");
    if (req.format !== "docx" && !this.o.converter)
      throw refused("unsupported", `${req.format} needs a converter (Gotenberg)`, {
        method: "render",
      });
    const tenantId =
      /^tenant\/([^/]+)\//.exec(`${req.outputPrefix.replace(/\/$/, "")}/`)?.[1] ?? "";
    const t = await this.template(tenantId, req.templateId);
    const missingAtRender = new Set<string>();
    const { doc, tags } = this.compile(await this.read(t.file), missingAtRender);
    const missing = new Set<string>();
    const invalid = new Set<string>();
    dataProblems(tags, [req.data], "", missing, invalid);
    if (missing.size)
      throw refused("binding_missing", "every field of the template must be bound", {
        fields: cap([...missing].sort()),
      });
    if (invalid.size)
      throw refused("data_invalid", "the data does not fit the template", {
        problems: cap([...invalid].sort()),
      });
    doc.render(req.data);
    if (missingAtRender.size)
      throw refused("binding_missing", "every field of the template must be bound", {
        fields: cap([...missingAtRender].sort()),
      });
    const docx = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
    const out =
      req.format === "docx" ? docx : await this.o.converter!.convertDocx(docx, req.format);
    const ext = req.format === "docx" ? "docx" : "pdf";
    const storageKey = `${req.outputPrefix.replace(/\/$/, "")}/${ulid()}.${ext}`;
    if (!isValidStorageKey(storageKey))
      throw refused(
        "output_prefix_invalid",
        "the output prefix must be tenant/<tenant id>/<module>",
      );
    const sha256 = sha256Hex(out);
    await this.o.storage.put(storageKey, out, {
      contentType: ext === "docx" ? DOCX_MIME : "application/pdf",
      bucketClass: this.o.bucketClass ?? "CONFIDENTIAL",
      sha256,
    });
    return {
      file: { storageKey, sha256 },
      format: req.format,
      pageCount: ext === "pdf" ? pageCount(out) : null,
      templateVersion: t.version,
      adapter: ADAPTER,
    };
  }

  async renderBatch(reqs: unknown[], call?: PortCall): Promise<RenderedDocument[]> {
    const out: RenderedDocument[] = [];
    for (const r of reqs) out.push(await this.render(r, call));
    return out;
  }

  async renderHtml(raw: unknown, call?: PortCall): Promise<RenderedDocument> {
    if (!this.o.converter?.renderHtml)
      throw refused("unsupported", "renderHtml needs a converter (Gotenberg)", {
        method: "renderHtml",
      });
    return this.o.converter.renderHtml(HtmlRenderRequest.parse(raw), call);
  }

  async previewHtml(): Promise<string> {
    throw refused("unsupported", "previewHtml is not offered by the docxtemplater adapter", {
      method: "previewHtml",
    });
  }

  async listTemplates(tenantId: string): Promise<TemplateInfo[]> {
    const formats: TemplateInfo["formats"] = this.o.converter ? ["docx", "pdf", "pdfa"] : ["docx"];
    return (await this.o.templates.list(tenantId)).map((t) => ({
      templateId: t.templateId,
      version: t.version,
      formats: [...formats],
    }));
  }

  async validateTemplate(file: DocFileRef): Promise<{ valid: boolean; problems: string[] }> {
    try {
      const { tags } = this.compile(await this.read(file));
      // The bindings it needs, so the product can map its data before the first render.
      const fields: string[] = [];
      const walk = (ts: readonly Part[], path: string) => {
        for (const t of ts)
          if (t.type === "placeholder") {
            if (t.module === "loop") walk(t.subparsed ?? [], `${path}${t.value}[].`);
            else fields.push(`${path}${t.value}`);
          }
      };
      walk(tags, "");
      return { valid: true, problems: [], ...{ fields: [...new Set(fields)].sort() } };
    } catch (e) {
      const meta = (e as PortError).meta as { reason?: string; problems?: string[] } | undefined;
      if (
        !meta?.reason ||
        !["template_unsafe", "template_invalid", "template_too_large", "template_changed"].includes(
          meta.reason,
        )
      )
        throw e;
      return { valid: false, problems: meta.problems ?? [(e as Error).message] };
    }
  }
}
