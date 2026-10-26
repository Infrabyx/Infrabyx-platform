// CloudEvents 1.0.2 envelopes (PL1-D-02 / D-13).
//  - Internal: IPB-10-37, IPB-10 §10.4.9.1 — `in.<product>.<module>.<Event>.v<n>`, ULID id.
//  - Ecosystem: Ecosystem Spec v1.2 §3.2 — `in.infrabyx.<domain>.<Event>.v<major>`, UUIDv7 id.
// The Ecosystem envelope is mandatory for anything crossing a product boundary; the internal
// schema rejects `in.infrabyx.*` types so a cross-product event cannot be sent as internal.
import { z } from "zod";
import { DataClass, SpecFieldClass } from "../data-class.js";
import { ULID_REGEX } from "../ids.js";

/** `in.<product>.<module>.<EventName>.v<n>` (IPB-01 §01.4.3.3). `infrabyx` is not a product. */
export const INTERNAL_TYPE_REGEX =
  /^in\.(?!infrabyx\.)[a-z][a-z0-9]*\.[a-z][a-z0-9_]*\.[A-Z][A-Za-z0-9]*\.v[1-9][0-9]*$/;
/** `in.infrabyx.<domain>.<EventName>.v<major>` (Ecosystem Spec §3.2). */
export const ECOSYSTEM_TYPE_REGEX =
  /^in\.infrabyx\.[a-z][a-z0-9_]*\.[A-Z][A-Za-z0-9]*\.v[1-9][0-9]*$/;
/** RFC 9562 UUIDv7. */
export const UUIDV7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const isEcosystemType = (type: string): boolean => ECOSYSTEM_TYPE_REGEX.test(type);
export const isInternalType = (type: string): boolean => INTERNAL_TYPE_REGEX.test(type);

/** Build an internal event type name. */
export function internalType(product: string, module: string, event: string, version = 1): string {
  const t = `in.${product.toLowerCase()}.${module}.${event}.v${version}`;
  if (!isInternalType(t)) throw new Error(`invalid internal event type "${t}"`);
  return t;
}

const ISO_TIME = z.iso.datetime({ offset: true });

/** Internal envelope (IPB-10-37). */
export const InternalEnvelope = z
  .object({
    specversion: z.literal("1.0"),
    id: z.string().regex(ULID_REGEX, "id must be a ULID"),
    source: z
      .string()
      .regex(
        /^\/infrabyx\/[a-z][a-z0-9]*\/[a-z][a-z0-9_]*$/,
        "source must be /infrabyx/<product>/<module>",
      ),
    type: z
      .string()
      .regex(
        INTERNAL_TYPE_REGEX,
        "type must be in.<product>.<module>.<Event>.v<n> (not in.infrabyx.*)",
      ),
    time: ISO_TIME,
    datacontenttype: z.literal("application/json"),
    dataschema: z.url(),
    subject: z.string().optional(),
    tenantid: z.string().min(1),
    traceid: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    actorid: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/, "actorid is a hashed id")
      .optional(),
    dataclass: DataClass,
    sequence: z.string().regex(/^\d+$/).optional(),
    environment: z.enum(["live", "test"]).optional(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export type InternalEnvelope = z.infer<typeof InternalEnvelope>;

export const LEGAL_BASES = [
  "STATUTORY_REPORTING",
  "LEGAL_CLAIM",
  "CONTRACT_PERFORMANCE_RE",
  "REGULATOR_REQUEST",
  "CONTRACT_PERFORMANCE_VENDOR",
  "CONTRACT_PERFORMANCE_CUSTOMER",
] as const;

/** Ecosystem Spec §3.2 product source labels. */
export const ECOSYSTEM_PRODUCT_LABELS = [
  "finbyx",
  "udofin",
  "oh",
  "equator",
  "ldc",
  "udolex",
  "fiapp",
  "lawdocs",
] as const;

/** Spec field classes that carry personal data and therefore need `consentref` or `legalbasis`. */
const PERSONAL_SPEC_CLASSES: readonly string[] = [
  "PII",
  "SPI",
  "FINANCIAL",
  "HR",
  "WELLNESS",
  "CONSUMER_HELP",
];

/** Ecosystem envelope (Ecosystem Spec v1.2 §3.2). */
export const EcosystemEnvelope = z
  .object({
    specversion: z.literal("1.0"),
    id: z.string().regex(UUIDV7_REGEX, "id must be a UUIDv7 (Spec §3.2)"),
    source: z
      .string()
      .regex(
        new RegExp(
          `^(urn:infrabyx:(${ECOSYSTEM_PRODUCT_LABELS.join("|")}):[A-Za-z0-9_-]+|urn:ext:[a-z0-9-]+:[A-Za-z0-9_-]+)$`,
        ),
        "source must be urn:infrabyx:<product>:<tenantid> or urn:ext:<connector>:<tenantid>",
      ),
    type: z
      .string()
      .regex(ECOSYSTEM_TYPE_REGEX, "type must be in.infrabyx.<domain>.<Event>.v<major>"),
    subject: z.string().min(1),
    time: ISO_TIME,
    datacontenttype: z.literal("application/json"),
    dataschema: z.url(),
    tenantid: z.string().min(1),
    reid: z.string().min(1),
    productfamily: z.string().min(2),
    correlationid: z.string().optional(),
    causationid: z.string().optional(),
    consentref: z.string().optional(),
    legalbasis: z.enum(LEGAL_BASES).optional(),
    dataclass: SpecFieldClass,
    schemaver: z.string().regex(/^\d+\.\d+\.\d+$/),
    seq: z.number().int().nonnegative(),
    traceparent: z
      .string()
      .regex(/^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)
      .optional(),
    brandid: z.string().optional(),
    environment: z.enum(["live", "test"]).optional(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (PERSONAL_SPEC_CLASSES.includes(e.dataclass) && !e.consentref && !e.legalbasis) {
      ctx.addIssue({
        code: "custom",
        path: ["consentref"],
        message: "personal data requires consentref or legalbasis (Spec §3.2)",
      });
    }
  });
export type EcosystemEnvelope = z.infer<typeof EcosystemEnvelope>;

/**
 * Validate an envelope by its type: `in.infrabyx.*` must be an Ecosystem envelope, everything else
 * an internal one. Use this at every outbox write that may cross a product boundary (D-13).
 */
export function parseEnvelope(
  e: unknown,
):
  | { kind: "internal"; envelope: InternalEnvelope }
  | { kind: "ecosystem"; envelope: EcosystemEnvelope } {
  const type = typeof e === "object" && e !== null ? (e as { type?: unknown }).type : undefined;
  if (typeof type === "string" && isEcosystemType(type)) {
    return { kind: "ecosystem", envelope: EcosystemEnvelope.parse(e) };
  }
  return { kind: "internal", envelope: InternalEnvelope.parse(e) };
}
