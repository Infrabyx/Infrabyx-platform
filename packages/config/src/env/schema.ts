// Environment schema helpers (IPB-11 §11.4.1). Metadata attached here drives the loader, the
// redaction map (IPB-11-07) and the .env.example generator (IPB-11-03).
import { z } from "zod";

export type Sensitivity = "S" | "C" | "P";
/** Environments where a variable is required: all, non-production, production-group, optional. */
export type Required = "all" | "nonprod" | "prod" | "opt";

export interface EnvMeta {
  desc: string;
  example: string;
  required: Required;
  sens: Sensitivity;
  /** Owning port prefix (IPB-11-05), e.g. "DB". */
  port: string;
  /** Example shown for production-group environments (e.g. a secret:// reference). */
  prodExample?: string;
}

export const envMeta = z.registry<EnvMeta>();

export type EnvShape = Record<string, z.ZodType>;
export type EnvSchema<S extends EnvShape = EnvShape> = z.ZodObject<S>;

/**
 * Declare a variable. Values arrive as strings; use the helpers below for typed values. The
 * metadata is keyed by the schema object, so a shared schema (`ProductCode`, `AppEnv`) declared
 * a second time is cloned first; otherwise the later declaration's metadata would replace the
 * earlier one's (the seed CLI's optional gate `APP_PRODUCT` became required, PR-FBX-04 note).
 */
export function envVar<T extends z.ZodType>(schema: T, meta: EnvMeta): T {
  const s = envMeta.has(schema) ? (schema.clone() as T) : schema;
  envMeta.add(s, meta);
  return s;
}

/**
 * A secret (`sens: "S"`). A literal is accepted in local/dev/test/preview; staging, demo,
 * pre-prod, prod and dr require `secret://` (IPB-11-15). The loader resolves references.
 */
export function secretRef(meta: Omit<EnvMeta, "sens">): z.ZodString {
  return envVar(z.string().min(1), { ...meta, sens: "S" });
}

/** `true`/`false` only (IPB-11-06). */
export const envBool = () =>
  z.enum(["true", "false"], { error: "expected true or false" }).transform((v) => v === "true");

export const envInt = (opts: { min?: number; max?: number } = {}) =>
  z
    .string()
    .regex(/^-?\d+$/, { error: "expected an integer" })
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(opts.min ?? Number.MIN_SAFE_INTEGER)
        .max(opts.max ?? Number.MAX_SAFE_INTEGER),
    );

/** Comma-separated, no spaces (IPB-11-06). */
export const envList = (item: z.ZodType<string, string> = z.string().min(1)) =>
  z
    .string()
    .refine((v) => !/\s/.test(v), { error: "lists are comma-separated without spaces" })
    .transform((v) => (v === "" ? [] : v.split(",")))
    .pipe(z.array(item));

/** URL with a scheme (IPB-11-06). */
export const envUrl = () =>
  z.string().refine((v) => /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(v) && URL.canParse(v), {
    error: "expected a URL with scheme",
  });

/** Port prefixes of IPB-11-05. */
export const ENV_PREFIXES = [
  "APP",
  "DB",
  "AUTH",
  "AUTHZ",
  "STORAGE",
  "SEARCH",
  "CACHE",
  "QUEUE",
  "WORKFLOW",
  "AI",
  "PAYMENTS",
  "MSG",
  "OBS",
  "FLAGS",
  "SECRETS",
  "DOCGEN",
  "RULES",
  "SEED",
  "IPB",
  "LD",
  "LDC",
  "EQ",
  "FBX",
  "UDF",
  "OH",
] as const;
const NAME = new RegExp(
  `^(?:(?:NEXT_PUBLIC|EXPO_PUBLIC)_)?(?:${ENV_PREFIXES.join("|")})_[A-Z0-9_]+$|^NODE_ENV$`,
);

export interface EnvVarInfo {
  name: string;
  meta: EnvMeta;
  schema: z.ZodType;
}

/** Variables of a schema with their metadata; throws when a variable has none or a bad name. */
export function describeSchema(schema: EnvSchema): EnvVarInfo[] {
  return Object.entries(schema.shape).map(([name, s]) => {
    const meta = envMeta.get(s);
    if (!meta)
      throw new Error(
        `${name}: declare with envVar() or secretRef() so it carries metadata (IPB-11-03)`,
      );
    if (!NAME.test(name))
      throw new Error(`${name}: name must start with a port prefix (IPB-11-05)`);
    if (meta.sens === "P" && !/^(?:NEXT|EXPO)_PUBLIC_/.test(name))
      throw new Error(`${name}: sens P variables need NEXT_PUBLIC_ or EXPO_PUBLIC_`);
    if (/^(?:NEXT|EXPO)_PUBLIC_/.test(name) && meta.sens === "S")
      throw new Error(`${name}: a secret can never be browser-exposed`);
    return { name, meta, schema: s };
  });
}
