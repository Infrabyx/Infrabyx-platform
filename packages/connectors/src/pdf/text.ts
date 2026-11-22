// PDF adapter `pdf-text` (IPB-01 PDF; IPB-02-44; LawDocsComply PR-LDC-39, R1-D-117, R1-D-160;
// R1-plan M89; threat model §3.129): `extractText` only, in-process, with no dependency. The other
// `PdfPort` methods are the file-operation adapters' (pdf-lib, pdfcpu, Gotenberg) and are declared
// unsupported here (`IPB-PORT-001`, reason `unsupported`).
//   * AV first: the request carries the AV port's result, and nothing is read unless it is `CLEAN`
//     for the file's SHA-256 (`assertScannedClean`); the bytes read from STORAGE must hash to it too,
//     so a file swapped after its scan is refused (`IPB-SEC-015`).
//   * A STORAGE read refused because the object's named tenant key is disabled or no longer granted
//     is `IPB-KMS-001` (reason `storage_key_unavailable`, PR-UDF-067); a read STORAGE refuses for
//     integrity is `IPB-STOR-005` (reason `hash_mismatch`, PR-UDF-080, R1-D-269); any other read
//     failure is `IPB-PORT-002` (reason `unavailable`).
//   * Isolated: the parse (`parse.ts`) runs in a `worker_thread` with V8 heap and stack limits, an
//     empty environment and no inherited flags, and is terminated at its deadline, so a hostile file
//     can neither hang nor exhaust the calling process. A worker that runs out of memory or time is
//     `IPB-SEC-013` (reason `memory` or `timeout`).
//   * Bounded: limits as asked, capped by the platform maxima (`resolvePdfTextLimits`).
//   * Never fetches, executes or writes anything; the file's content is never logged or quoted.
import { fileURLToPath } from "node:url";
import { extname } from "node:path";
import { Worker } from "node:worker_threads";
import { PortError } from "@infrabyx/contracts/errors";
import {
  PdfTextRequest,
  STORAGE_HASH_MISMATCH,
  STORAGE_INTEGRITY_ERROR,
  assertScannedClean,
  isStorageIntegrityError,
  resolvePdfTextLimits,
  type AdapterDescriptor,
  type DocFileRef,
  type PdfPort,
  type PdfTextResult,
  type PortCall,
  type PortHealth,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import { PDF_TEXT_WORKER_TASK, type ParsedPdf, type WorkerReply } from "./parse.js";

const PORT = "PDF";
const ADAPTER = "pdf-text";
/** The worker's V8 old-generation heap: the default and the most an adapter may give it. */
export const PDF_TEXT_MEMORY_MB = { default: 256, max: 512 } as const;

/** `parse.ts` beside this file (`.ts` when the source runs under the tests, `.js` once built). */
const WORKER_URL = new URL(`./parse${extname(fileURLToPath(import.meta.url))}`, import.meta.url);

export interface PdfTextOptions {
  /** Where uploads are read from (the tenant's STORAGE). */
  storage: StoragePort;
  /** The worker's heap in MiB (default 256, at most 512). */
  memoryMb?: number;
}

const UNSUPPORTED = [
  "merge",
  "split",
  "stamp",
  "sign",
  "redact",
  "toPdfA",
  "extractPages",
  "watermark",
  "linearise",
  "pageCount",
] as const;

export class PdfTextExtractor implements PdfPort {
  readonly descriptor: AdapterDescriptor = {
    port: PORT,
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "REGULATED",
    capabilities: Object.fromEntries(UNSUPPORTED.map((m) => [m, "unsupported" as const])),
  };
  private readonly memoryMb: number;

  constructor(private readonly o: PdfTextOptions) {
    const m = o.memoryMb ?? PDF_TEXT_MEMORY_MB.default;
    this.memoryMb = Math.max(32, Math.min(Number.isFinite(m) ? m : 0, PDF_TEXT_MEMORY_MB.max));
  }

  async health(): Promise<PortHealth> {
    // In-process: nothing to reach. Each call starts its own worker.
    return { status: "up", latency_ms: 0, checked_at: new Date().toISOString() };
  }

  async extractText(raw: PdfTextRequest, _call?: PortCall): Promise<PdfTextResult> {
    const req = PdfTextRequest.parse(raw);
    assertScannedClean(req.scan, req.file.sha256, PORT, ADAPTER);
    const limits = resolvePdfTextLimits(req.limits);
    let body: Uint8Array;
    try {
      body = (await this.o.storage.get(req.file.storageKey)).body;
    } catch (e) {
      if (storageKeyUnavailable(e))
        throw new PortError("IPB-KMS-001", PORT, {
          adapter: ADAPTER,
          detail: "the file's storage key is disabled or no longer granted",
          meta: { reason: "storage_key_unavailable" },
        });
      // PR-UDF-080 (R1-D-269): a tampered object is not an outage either.
      if (isStorageIntegrityError(e))
        throw new PortError(STORAGE_INTEGRITY_ERROR, PORT, {
          adapter: ADAPTER,
          detail: "the file failed STORAGE's integrity check",
          meta: { reason: STORAGE_HASH_MISMATCH },
        });
      throw new PortError("IPB-PORT-002", PORT, {
        adapter: ADAPTER,
        detail: "the file could not be read from storage",
        meta: { reason: "unavailable" },
      });
    }
    if (body.length > limits.maxFileBytes)
      throw refusal("IPB-SEC-013", "limit", `the file is over ${limits.maxFileBytes} bytes`);
    if (sha256Hex(body) !== req.file.sha256)
      throw refusal("IPB-SEC-015", "hash_mismatch", "the bytes are not the ones scanned");
    const { timeoutMs, ...parse } = limits;
    const r = await this.inWorker(body, parse, timeoutMs);
    return {
      pages: r.pages.map((p) => ({ index: p.index, text: p.text, needsOcr: p.needsOcr })),
      pageCount: r.pageCount,
      ...(r.truncated ? { truncated: true } : {}),
    };
  }

  /** One worker per call: resource limits, an empty environment, terminated at the deadline. */
  private inWorker(
    body: Uint8Array,
    limits: Omit<ReturnType<typeof resolvePdfTextLimits>, "timeoutMs">,
    timeoutMs: number,
  ): Promise<ParsedPdf> {
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    return new Promise<ParsedPdf>((resolve, reject) => {
      let settled = false;
      const worker = new Worker(WORKER_URL, {
        workerData: { task: PDF_TEXT_WORKER_TASK, bytes: copy.buffer, limits },
        transferList: [copy.buffer],
        env: {},
        execArgv: [],
        stdout: true,
        stderr: true,
        resourceLimits: {
          maxOldGenerationSizeMb: this.memoryMb,
          maxYoungGenerationSizeMb: 32,
          codeRangeSizeMb: 16,
          stackSizeMb: 4,
        },
      });
      const done = (err: Error | null, value?: ParsedPdf) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        if (err) reject(err);
        else resolve(value as ParsedPdf);
      };
      const timer = setTimeout(
        () => done(refusal("IPB-SEC-013", "timeout", `the parse took over ${timeoutMs} ms`)),
        timeoutMs,
      );
      worker.once("message", (m: WorkerReply) => {
        if (m.ok) done(null, m.result);
        else done(refusal(m.code, m.reason, m.detail));
      });
      worker.once("error", (e: Error & { code?: string }) =>
        done(
          e.code === "ERR_WORKER_OUT_OF_MEMORY"
            ? refusal("IPB-SEC-013", "memory", `the parse needed over ${this.memoryMb} MiB`)
            : refusal("IPB-SEC-010", "malformed", "the file could not be parsed"),
        ),
      );
      worker.once("exit", () =>
        done(refusal("IPB-SEC-010", "malformed", "the parser stopped without an answer")),
      );
    });
  }

  async merge(): Promise<DocFileRef> {
    throw unsupported("merge");
  }
  async split(): Promise<DocFileRef[]> {
    throw unsupported("split");
  }
  async stamp(): Promise<DocFileRef> {
    throw unsupported("stamp");
  }
  async sign(): Promise<DocFileRef> {
    throw unsupported("sign");
  }
  async redact(): Promise<DocFileRef> {
    throw unsupported("redact");
  }
  async toPdfA(): Promise<DocFileRef> {
    throw unsupported("toPdfA");
  }
  async extractPages(): Promise<DocFileRef> {
    throw unsupported("extractPages");
  }
  async watermark(): Promise<DocFileRef> {
    throw unsupported("watermark");
  }
  async linearise(): Promise<DocFileRef> {
    throw unsupported("linearise");
  }
  async pageCount(): Promise<number> {
    throw unsupported("pageCount");
  }
}

/**
 * PR-UDF-067: a STORAGE read refused because the object's named tenant key is disabled or no
 * longer granted (IPB-KMS-001 `storage_key_unavailable`, PR-UDF-058) is not a storage outage. It is
 * passed on as that code and fixed label only: not the key reference, the vendor's error name or
 * its cause.
 */
function storageKeyUnavailable(e: unknown): boolean {
  const err = e as { code?: unknown; meta?: { reason?: unknown } } | null | undefined;
  return err?.code === "IPB-KMS-001" && err.meta?.reason === "storage_key_unavailable";
}

function refusal(
  code: "IPB-SEC-010" | "IPB-SEC-013" | "IPB-SEC-015",
  reason: string,
  detail: string,
): PortError {
  return new PortError(code, PORT, { adapter: ADAPTER, detail, meta: { reason } });
}

function unsupported(method: string): PortError {
  return new PortError("IPB-PORT-001", PORT, {
    adapter: ADAPTER,
    detail: `${method} is not offered by the pdf-text adapter (text extraction only)`,
    meta: { reason: "unsupported", method },
  });
}
