// DOCGEN reference adapter `gotenberg` (IPB-01 DOCGEN; OWNER-QUESTIONS #120, R1-D-100; R1-plan
// M71): HTML to PDF or PDF/A through a Gotenberg server running in the cluster (its Chromium
// route), which shapes Indic scripts with the Noto fonts in its image (`fonts-noto-core`: Noto
// Sans Devanagari and Gurmukhi among them). `renderHtml` only: templates (`render`, `renderBatch`,
// `previewHtml`, `listTemplates`, `validateTemplate`) are the docxtemplater adapter's and are
// declared unsupported here (`IPB-PORT-001`, reason `unsupported`).
//   * The HTML goes to Gotenberg as one `index.html` and nothing else: no other file, no URL, so
//     the page can load nothing (pages from `blocksToHtml` also carry a CSP of `default-src 'none'`).
//     Chromium is told to fail on a console exception and not to wait for network.
//   * The PDF comes back in the response and is written to the tenant's STORAGE under the
//     request's output prefix, with its SHA-256; a response that is not a PDF is refused.
//   * HTTPS to the configured host only (the SSRF guard; plain HTTP to loopback in tests). Off
//     behind `int.docgen.gotenberg.enabled`. No external account: Gotenberg runs in the cluster.
import { PortError } from "@infrabyx/contracts/errors";
import {
  HtmlRenderRequest,
  type AdapterDescriptor,
  type BucketClass,
  type DocgenPort,
  type PortCall,
  type PortHealth,
  type RenderedDocument,
  type StoragePort,
  type TemplateInfo,
  isValidStorageKey,
} from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import { createEgress } from "../core/http.js";

const PORT = "DOCGEN";
const ADAPTER = "gotenberg";
/** A4 in inches, the unit Gotenberg's Chromium route takes; the page's own `@page` wins. */
const A4 = { width: "8.27", height: "11.7" };

export interface GotenbergDocgenOptions {
  /** Base URL of the in-cluster Gotenberg service (HTTPS). */
  baseUrl: string;
  /** Where rendered files are written (the tenant's STORAGE). */
  storage: StoragePort;
  /** STORAGE bucket class of rendered documents (default `CONFIDENTIAL`, as the HTML is by default). */
  bucketClass?: BucketClass;
  /** `int.docgen.gotenberg.enabled` (off by default). */
  enabled: () => Promise<boolean> | boolean;
  /** Render timeout (default 60 s). */
  timeoutMs?: number;
  /** Largest PDF accepted back (default 50 MiB). */
  maxPdfBytes?: number;
  /** Basic-auth credentials when Gotenberg runs with `--api-enable-basic-auth`. */
  basicAuth?: () => Promise<{ username: string; password: string }>;
  /** Tests only: plain HTTP to 127.0.0.1 and localhost. */
  allowLoopbackHttp?: boolean;
  fetchImpl?: typeof fetch;
}

const UNSUPPORTED = [
  "render",
  "renderBatch",
  "previewHtml",
  "listTemplates",
  "validateTemplate",
] as const;

export class GotenbergDocgen implements DocgenPort {
  readonly descriptor: AdapterDescriptor;
  private readonly base: string;
  private readonly egress: ReturnType<typeof createEgress>;

  constructor(private readonly o: GotenbergDocgenOptions) {
    const u = new URL(o.baseUrl);
    this.base = u.toString().replace(/\/$/, "");
    this.egress = createEgress({
      port: PORT,
      adapter: ADAPTER,
      allow: [u.hostname],
      timeoutMs: o.timeoutMs ?? 60_000,
      retries: 0,
      maxBytes: o.maxPdfBytes ?? 50 * 1024 * 1024,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
      ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
    });
    this.descriptor = {
      port: PORT,
      adapter: ADAPTER,
      residency: "IN",
      maxDataClass: "CONFIDENTIAL",
      capabilities: Object.fromEntries(UNSUPPORTED.map((m) => [m, "unsupported" as const])),
    };
  }

  async health(): Promise<PortHealth> {
    const started = Date.now();
    try {
      const r = await this.egress(`${this.base}/health`, await this.init({ method: "GET" }));
      return {
        status: r.status === 200 ? "up" : "degraded",
        latency_ms: Date.now() - started,
        checked_at: new Date().toISOString(),
      };
    } catch {
      return {
        status: "down",
        latency_ms: Date.now() - started,
        checked_at: new Date().toISOString(),
      };
    }
  }

  async renderHtml(raw: unknown, _call?: PortCall): Promise<RenderedDocument> {
    if (!(await this.o.enabled()))
      throw new PortError("IPB-PORT-001", PORT, {
        adapter: ADAPTER,
        detail: "int.docgen.gotenberg.enabled is off",
      });
    const req = HtmlRenderRequest.parse(raw);
    const form = new FormData();
    form.append("files", new Blob([req.html], { type: "text/html" }), "index.html");
    form.append("paperWidth", A4.width);
    form.append("paperHeight", A4.height);
    form.append("preferCssPageSize", "true");
    form.append("printBackground", "true");
    form.append("failOnConsoleExceptions", "true");
    form.append("skipNetworkIdleEvent", "true");
    if (req.format === "pdfa") {
      form.append("pdfa", "PDF/A-2b");
      form.append("pdfua", "true");
    }
    const r = await this.egress(
      `${this.base}/forms/chromium/convert/html`,
      await this.init({ method: "POST", body: form }),
    );
    if (r.status !== 200)
      throw new PortError(r.status >= 500 ? "IPB-PORT-002" : "IPB-PORT-001", PORT, {
        adapter: ADAPTER,
        detail: `Gotenberg answered ${r.status}`,
      });
    const pdf = r.body;
    if (!isPdf(pdf))
      throw new PortError("IPB-PORT-002", PORT, {
        adapter: ADAPTER,
        detail: "Gotenberg did not return a PDF",
      });
    const sha256 = sha256Hex(pdf);
    // One object per render: `tenant/<id>/<module>/<ULID>.pdf` (the STORAGE key scheme).
    const storageKey = `${req.outputPrefix.replace(/\/$/, "")}/${ulid()}.pdf`;
    if (!isValidStorageKey(storageKey))
      throw new PortError("IPB-PORT-001", PORT, {
        adapter: ADAPTER,
        detail: "the output prefix must be tenant/<tenant id>/<module>",
      });
    await this.o.storage.put(storageKey, pdf, {
      contentType: "application/pdf",
      bucketClass: this.o.bucketClass ?? "CONFIDENTIAL",
      sha256,
    });
    return {
      file: { storageKey, sha256 },
      format: req.format,
      pageCount: pageCount(pdf),
      templateVersion: null,
      adapter: ADAPTER,
    };
  }

  async render(): Promise<RenderedDocument> {
    throw unsupported("render");
  }
  async renderBatch(): Promise<RenderedDocument[]> {
    throw unsupported("renderBatch");
  }
  async previewHtml(): Promise<string> {
    throw unsupported("previewHtml");
  }
  async listTemplates(): Promise<TemplateInfo[]> {
    throw unsupported("listTemplates");
  }
  async validateTemplate(): Promise<{ valid: boolean; problems: string[] }> {
    throw unsupported("validateTemplate");
  }

  private async init(i: RequestInit): Promise<RequestInit> {
    if (!this.o.basicAuth) return i;
    const { username, password } = await this.o.basicAuth();
    const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
    return { ...i, headers: { ...(i.headers ?? {}), authorization: `Basic ${token}` } };
  }
}

function unsupported(method: string): PortError {
  return new PortError("IPB-PORT-001", PORT, {
    adapter: ADAPTER,
    detail: `${method} is not offered by the gotenberg adapter (templates are docxtemplater's)`,
    meta: { reason: "unsupported", method },
  });
}

function isPdf(b: Uint8Array): boolean {
  return b.length > 8 && Buffer.from(b.subarray(0, 5)).toString("latin1") === "%PDF-";
}

/** The page count from the page tree, or null when it cannot be read without parsing streams. */
export function pageCount(pdf: Uint8Array): number | null {
  const s = Buffer.from(pdf).toString("latin1");
  let max = 0;
  for (const m of s.matchAll(
    /\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g,
  ))
    max = Math.max(max, Number(m[1] ?? m[2]));
  return max > 0 ? max : null;
}
