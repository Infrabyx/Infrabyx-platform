// DOCGEN and PDF ports (IPB-01 DOCGEN, PDF; Finbyx PR-FBX-29, R1-D-52). Interfaces and fakes only;
// the in-cluster reference adapters (IPB-01: docxtemplater and Gotenberg for DOCGEN; pdf-lib,
// pdfcpu and Gotenberg for PDF) come in a later minor. Every input and output is a STORAGE object
// by key and SHA-256; the ports are pure functions over them.
import { z } from "zod";
import type { Port, PortCall } from "./common.js";
import { DocFileRef, OutputPrefix } from "./doc-file.js";
import { classed } from "./payload-class.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");
const confidential = <T extends z.ZodType>(s: T): T => classed(s, "CONFIDENTIAL");

export const RENDER_FORMATS = ["pdf", "pdfa", "docx", "html"] as const;
export type RenderFormat = (typeof RENDER_FORMATS)[number];

export const RenderRequest = z
  .object({
    templateId: internal(z.string().min(1).max(120)),
    /** Template data; CONFIDENTIAL by default (it may hold personal data). */
    data: confidential(z.record(z.string(), z.unknown())),
    format: internal(z.enum(RENDER_FORMATS)),
    outputPrefix: internal(OutputPrefix),
  })
  .strict();

export const HtmlRenderRequest = z
  .object({
    html: confidential(z.string().min(1).max(5_000_000)),
    format: internal(z.enum(["pdf", "pdfa"])),
    outputPrefix: internal(OutputPrefix),
  })
  .strict();

export interface RenderedDocument {
  file: DocFileRef;
  format: RenderFormat;
  pageCount: number | null;
  /** The template version that rendered it. */
  templateVersion: string | null;
  adapter: string;
}

export interface TemplateInfo {
  templateId: string;
  version: string;
  formats: RenderFormat[];
}

export interface DocgenPort extends Port {
  render(req: z.infer<typeof RenderRequest>, call?: PortCall): Promise<RenderedDocument>;
  renderBatch(reqs: z.infer<typeof RenderRequest>[], call?: PortCall): Promise<RenderedDocument[]>;
  /** HTML to PDF or PDF/A (Finbyx's `DocumentRenderPort`). */
  renderHtml(req: z.infer<typeof HtmlRenderRequest>, call?: PortCall): Promise<RenderedDocument>;
  previewHtml(templateId: string, data: Record<string, unknown>): Promise<string>;
  listTemplates(tenantId: string): Promise<TemplateInfo[]>;
  /** Checks a template file for syntax and unknown fields; returns the problems found. */
  validateTemplate(file: DocFileRef): Promise<{ valid: boolean; problems: string[] }>;
}

export const PageRange = z
  .object({ from: z.number().int().positive(), to: z.number().int().positive() })
  .strict()
  .refine((r) => r.from <= r.to, "from no later than to");

export interface PdfPort extends Port {
  merge(files: DocFileRef[], outputPrefix: string): Promise<DocFileRef>;
  split(
    file: DocFileRef,
    ranges: z.infer<typeof PageRange>[],
    outputPrefix: string,
  ): Promise<DocFileRef[]>;
  stamp(
    file: DocFileRef,
    mark: { text?: string; image?: DocFileRef },
    position: { page: number; x: number; y: number },
    outputPrefix: string,
  ): Promise<DocFileRef>;
  /** PAdES through the KMS port (IPB-01); the key never leaves KMS. */
  sign(
    file: DocFileRef,
    keyRef: string,
    visibleField: { page: number; x: number; y: number; width: number; height: number } | null,
    outputPrefix: string,
  ): Promise<DocFileRef>;
  redact(
    file: DocFileRef,
    regions: { page: number; x: number; y: number; width: number; height: number }[],
    outputPrefix: string,
  ): Promise<DocFileRef>;
  toPdfA(file: DocFileRef, outputPrefix: string): Promise<DocFileRef>;
  extractPages(file: DocFileRef, pages: number[], outputPrefix: string): Promise<DocFileRef>;
  watermark(file: DocFileRef, text: string, outputPrefix: string): Promise<DocFileRef>;
  linearise(file: DocFileRef, outputPrefix: string): Promise<DocFileRef>;
  pageCount(file: DocFileRef): Promise<number>;
}
