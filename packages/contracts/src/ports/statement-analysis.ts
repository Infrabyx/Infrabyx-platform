// STATEMENT_ANALYSIS port (Udofin PR-UDF-048, R1-D-201, R1-D-202, ADR-0012; IPB-01 §01.4.4.0): a
// bank-statement analysis behind one interface. The statements arrive as FI data (AA_FIU's payloads,
// or a statement the borrower uploaded) already in STORAGE; the port takes and returns STORAGE
// references with their SHA-256 only, never a statement's content. Every request and result is
// REGULATED and stays `IN`: the port's default class is REGULATED, the router refuses an adapter
// that cannot carry it (`IPB-PORT-003`), and each adapter refuses an input outside the REGULATED
// bucket class or a call class other than REGULATED before any vendor call. No vendor is chosen
// (owner question #152): the reference adapter is an in-platform checksum summary and the
// alternative a vendor-neutral HTTP adapter, both off; the fake in @infrabyx/fakes and the
// contract cases in @infrabyx/testing define the behaviour.
import { z } from "zod";
import { findAadhaarLike } from "../aadhaar.js";
import { atLeast } from "../data-class.js";
import { PortError, type IpbErrorCode } from "../errors.js";
import type { Port, PortCall, WebhookRequestMeta } from "./common.js";
import { classed, effectiveDataClass, payloadClass } from "./payload-class.js";
import { FI_TYPES } from "./account-aggregator.js";
import { isValidStorageKey } from "./storage.js";

const regulated = <T extends z.ZodType>(s: T): T => classed(s, "REGULATED");

/** The states of an analysis. */
export const STATEMENT_ANALYSIS_STATES = ["COMPLETED", "PENDING", "FAILED"] as const;
export type StatementAnalysisState = (typeof STATEMENT_ANALYSIS_STATES)[number];

/** Why an analysis FAILED (a fixed label, never the analyser's own words). */
export const STATEMENT_ANALYSIS_FAILURES = [
  /** An input is in no format the analyser reads (not ReBIT JSON, not a PDF, or damaged). */
  "unreadable_input",
  /** The analyser reads the format but not this statement (a bank or layout it does not know). */
  "unsupported_input",
  /** The analyser gave up for its own reasons. */
  "vendor_failed",
] as const;
export type StatementAnalysisFailure = (typeof STATEMENT_ANALYSIS_FAILURES)[number];

/**
 * The fixed `meta.reason` labels an adapter refuses with: `adapter_disabled` and
 * `adapter_unconfigured` (`IPB-PORT-001`), `residency` (`IPB-PORT-003`: an input outside the
 * REGULATED class, or a call class other than REGULATED), `input_missing` and `hash_mismatch`
 * (`IPB-PORT-001`: an input not in STORAGE, or whose bytes do not match its SHA-256),
 * `idempotency_conflict` (`IPB-PORT-004`), `unknown_analysis` and `tenant_mismatch`
 * (`IPB-PORT-001`), `webhook_invalid` (`IPB-API-018`) and `unsupported` (`IPB-PORT-001`).
 */
export const STATEMENT_ANALYSIS_REFUSALS = [
  "adapter_disabled",
  "adapter_unconfigured",
  "residency",
  "input_missing",
  "hash_mismatch",
  "idempotency_conflict",
  "unknown_analysis",
  "tenant_mismatch",
  "webhook_invalid",
  "unsupported",
] as const;
export type StatementAnalysisRefusal = (typeof STATEMENT_ANALYSIS_REFUSALS)[number];

/** At most this many statements in one analysis. */
export const STATEMENT_ANALYSIS_MAX_INPUTS = 24;

/** `sta_<ULID>`: the platform's own analysis id (never the vendor's). */
export const STATEMENT_ANALYSIS_ID = /^sta_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);
const PREFIX = /^tenant\/[a-z]{2,6}_[A-Za-z0-9]+\/[a-z][a-z0-9_]*\/$/;
/** The tenant part of a STORAGE key or prefix (`tenant/<tenant>/…`). */
export const storageTenantOf = (keyOrPrefix: string): string | undefined =>
  keyOrPrefix.split("/")[1];

export const StatementAnalysisInput = z
  .object({
    fiType: regulated(z.enum(FI_TYPES)),
    storageKey: regulated(
      z.string().max(512).refine(isValidStorageKey, {
        message: "a STORAGE key tenant/<tenant>/<module>/<ulid>[.ext]",
      }),
    ),
    sha256: regulated(SHA256),
  })
  .strict();
export type StatementAnalysisInput = z.infer<typeof StatementAnalysisInput>;

export const StatementAnalysisRequest = z
  .object({
    /** The product's own reference for the borrower; never an identity number. */
    subjectRef: regulated(
      z
        .string()
        .min(3)
        .max(200)
        .refine((v) => findAadhaarLike(v).length === 0, {
          message: "a subject reference holds no Aadhaar number or VID",
        }),
    ),
    inputs: z.array(StatementAnalysisInput).min(1).max(STATEMENT_ANALYSIS_MAX_INPUTS),
    /** Where the adapter writes the report: a `tenant/<tenant>/<module>/` prefix. */
    reportPrefix: regulated(z.string().regex(PREFIX)),
  })
  .strict()
  .refine((r) => new Set(r.inputs.map((i) => i.storageKey)).size === r.inputs.length, {
    message: "each input once",
  })
  .refine(
    (r) => r.inputs.every((i) => storageTenantOf(i.storageKey) === storageTenantOf(r.reportPrefix)),
    { message: "the inputs and the report are in one tenant" },
  );
export type StatementAnalysisRequest = z.input<typeof StatementAnalysisRequest>;

/** The report: a STORAGE reference (REGULATED class, under the request's prefix) and its SHA-256. */
export interface StatementAnalysisReport {
  storageKey: string;
  sha256: string;
}

export interface StatementAnalysis {
  analysisId: string;
  state: StatementAnalysisState;
  /** COMPLETED only. */
  report?: StatementAnalysisReport;
  /** FAILED only. */
  failureReason?: StatementAnalysisFailure;
  adapter: string;
  /** The analyser and its version, e.g. `checksum-summary-v1`. */
  method: string;
  /** The vendor's reference for the analysis (the analysis id for an in-platform analyser). */
  vendorRef: string;
  checkedAt: string;
}

/** The answer's schema: exactly these keys, and a report or a reason only in their state. */
export const StatementAnalysisResult = z
  .object({
    analysisId: z.string().regex(STATEMENT_ANALYSIS_ID),
    state: z.enum(STATEMENT_ANALYSIS_STATES),
    report: z
      .object({
        storageKey: z.string().refine(isValidStorageKey),
        sha256: SHA256,
      })
      .strict()
      .optional(),
    failureReason: z.enum(STATEMENT_ANALYSIS_FAILURES).optional(),
    adapter: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    method: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
    vendorRef: z.string().min(1).max(200),
    checkedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((a) => (a.state === "COMPLETED") === (a.report !== undefined), {
    message: "a report when, and only when, COMPLETED",
  })
  .refine((a) => (a.state === "FAILED") === (a.failureReason !== undefined), {
    message: "a failure reason when, and only when, FAILED",
  });

/** Only the fields the port defines, so nothing else an analyser sent is ever kept or returned. */
export function statementAnalysisResultOnly(a: StatementAnalysis): StatementAnalysis {
  return {
    analysisId: a.analysisId,
    state: a.state,
    ...(a.state === "COMPLETED" && a.report
      ? { report: { storageKey: a.report.storageKey, sha256: a.report.sha256 } }
      : {}),
    ...(a.state === "FAILED" && a.failureReason ? { failureReason: a.failureReason } : {}),
    adapter: a.adapter,
    method: a.method,
    vendorRef: a.vendorRef,
    checkedAt: a.checkedAt,
  };
}

/** What a verified notification names, with the analysis read back (its own state is not trusted). */
export interface StatementAnalysisNotification {
  analysisId: string;
  analysis: StatementAnalysis;
}

export interface StatementAnalysisPort extends Port {
  /**
   * Analyse the statements. Keyed on `call.idempotencyKey`: the same key with the same request
   * answers the same analysis with one analyser call; another request is `IPB-PORT-004`.
   */
  analyse(req: StatementAnalysisRequest, call?: PortCall): Promise<StatementAnalysis>;
  /** The analysis now; a final state is answered from the record, a PENDING one asks the analyser. */
  status(analysisId: string, call?: PortCall): Promise<StatementAnalysis>;
  /** Verifies a notification of a pending analysis, then reads it back with `status`. */
  handleWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<StatementAnalysisNotification>;
}

// ---- shared by every adapter and the fake ------------------------------------------------------

const PORT = "STATEMENT_ANALYSIS";

/** A refusal with its fixed label (`meta.reason`), definite: nothing was sent to an analyser. */
export function statementAnalysisRefusal(
  code: IpbErrorCode,
  adapter: string,
  reason: StatementAnalysisRefusal,
  detail: string,
): PortError {
  return new PortError(code, PORT, { adapter, detail, meta: { reason, definite: true } });
}

/**
 * The call's class must be REGULATED: a caller may not lower it (`effectiveDataClass` refuses that
 * `IPB-PORT-003`), and a class above what the port carries (SECRET) is refused `IPB-PORT-003`
 * `residency` too. Every adapter checks this first, before its flag, its store or any read.
 */
export function assertStatementAnalysisClass(adapter: string, call?: PortCall): void {
  let cls;
  try {
    cls = effectiveDataClass(PORT, call, payloadClass(StatementAnalysisRequest));
  } catch {
    throw statementAnalysisRefusal(
      "IPB-PORT-003",
      adapter,
      "residency",
      "a statement analysis is REGULATED; a caller may not lower its class",
    );
  }
  if (!atLeast("REGULATED", cls))
    throw statementAnalysisRefusal(
      "IPB-PORT-003",
      adapter,
      "residency",
      `${adapter} takes at most REGULATED, not ${cls}`,
    );
}

/**
 * What a statement's bytes look like: `json` (a ReBIT FI payload as AA_FIU stores it: a JSON object)
 * or `pdf` (by its `%PDF-` signature); `undefined` for anything else. Reads the shape only, never
 * the content.
 */
export function statementInputFormat(body: Uint8Array): "json" | "pdf" | undefined {
  const head = new TextDecoder().decode(body.subarray(0, 5));
  if (head === "%PDF-") return "pdf";
  try {
    const v: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    return typeof v === "object" && v !== null && !Array.isArray(v) ? "json" : undefined;
  } catch {
    return undefined;
  }
}
