// Data classes, residency and the Ecosystem Spec field-class mapping.
// IPB-02 §02.4.3.1 (tiers), IPB-01 §01.2 and §01.4.5 (residency, default residency policy).
import { z } from "zod";

/** Handling tiers, lowest to highest sensitivity (IPB-02 §02.4.3.1). */
export const DATA_CLASSES = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "REGULATED", "SECRET"] as const;
export const DataClass = z.enum(DATA_CLASSES);
export type DataClass = z.infer<typeof DataClass>;

/** Numeric rank of a data class: PUBLIC 0 … SECRET 4. */
export function dataClassRank(c: DataClass): number {
  return DATA_CLASSES.indexOf(c);
}

/** True when `a` is at least as sensitive as `b`. */
export function atLeast(a: DataClass, b: DataClass): boolean {
  return dataClassRank(a) >= dataClassRank(b);
}

/** The highest of a list of classes (PUBLIC for an empty list). */
export function highestClass(classes: readonly DataClass[]): DataClass {
  return classes.reduce<DataClass>((acc, c) => (atLeast(c, acc) ? c : acc), "PUBLIC");
}

/** Ecosystem Spec §13.2 field classes (on the wire). */
export const SPEC_FIELD_CLASSES = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "PII",
  "SPI",
  "FINANCIAL",
  "LEGAL",
  "HR",
  "WELLNESS",
  "CONSUMER_HELP",
] as const;
export const SpecFieldClass = z.enum(SPEC_FIELD_CLASSES);
export type SpecFieldClass = z.infer<typeof SpecFieldClass>;

/** Context that changes the tier of a Spec class (IPB-02 §02.4.3.1 mapping table). */
export interface SpecMappingContext {
  /** PII is REGULATED in lending and KYC contexts (IPB-02 §02.4.3.3). */
  lendingOrKyc?: boolean;
  /** LEGAL is REGULATED where `x-privileged: true`. */
  privileged?: boolean;
}

/** Map an Ecosystem Spec field class to its IPB handling tier (IPB-02 §02.4.3.1). */
export function tierForSpecClass(c: SpecFieldClass, ctx: SpecMappingContext = {}): DataClass {
  switch (c) {
    case "PUBLIC":
      return "PUBLIC";
    case "INTERNAL":
      return "INTERNAL";
    case "CONFIDENTIAL":
      return "CONFIDENTIAL";
    case "PII":
      return ctx.lendingOrKyc ? "REGULATED" : "CONFIDENTIAL";
    case "LEGAL":
      return ctx.privileged ? "REGULATED" : "CONFIDENTIAL";
    case "SPI":
    case "FINANCIAL":
    case "HR":
    case "WELLNESS":
    case "CONSUMER_HELP":
      return "REGULATED";
  }
}

/** Residency tags of an adapter instance (IPB-01 §01.2). */
export const RESIDENCIES = ["IN", "IN-ZR", "GLOBAL"] as const;
export const Residency = z.enum(RESIDENCIES);
export type Residency = z.infer<typeof Residency>;

/** Default residency policy: allowed residencies per data class, in preference order (IPB-01 §01.4.5). */
export const DEFAULT_RESIDENCY_POLICY: Readonly<Record<DataClass, readonly Residency[]>> =
  Object.freeze({
    PUBLIC: ["IN", "IN-ZR", "GLOBAL"],
    INTERNAL: ["IN", "IN-ZR", "GLOBAL"],
    CONFIDENTIAL: ["IN", "IN-ZR"],
    REGULATED: ["IN-ZR", "IN"],
    SECRET: ["IN"],
  });

/** Whether an adapter of `residency` may receive a payload of class `dataClass`. Fail closed (IPB-01-16). */
export function residencyAllows(
  residency: Residency,
  dataClass: DataClass,
  policy: Readonly<Record<DataClass, readonly Residency[]>> = DEFAULT_RESIDENCY_POLICY,
): boolean {
  return policy[dataClass].includes(residency);
}
