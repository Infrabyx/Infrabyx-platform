// Data-class annotations on port payload schemas (PL2-D-03, plan §3.1 and §3.12).
// A payload may lower a call below its port default only when every field is annotated.
import { z } from "zod";
import { DATA_CLASSES, type DataClass, highestClass, atLeast } from "../data-class.js";
import { PortError } from "../errors.js";
import { portDefaultDataClass, type PortCall } from "./common.js";

export interface FieldClass {
  dataClass: DataClass;
  /** Recipient address or number sent to a provider for delivery only (IPB-DEV-05). */
  role?: "delivery_recipient";
}

export const fieldClass = z.registry<FieldClass>();

/** Annotate a payload field with its data class. */
export function classed<T extends z.ZodType>(
  schema: T,
  dataClass: DataClass,
  role?: FieldClass["role"],
): T {
  fieldClass.add(schema, role ? { dataClass, role } : { dataClass });
  return schema;
}

/** Shorthand for a recipient field: CONFIDENTIAL contact data sent for delivery only. */
export const recipient = <T extends z.ZodType>(schema: T): T =>
  classed(schema, "CONFIDENTIAL", "delivery_recipient");

export interface PayloadClassReport {
  /** True when every leaf field carries an annotation (directly or through a parent). */
  complete: boolean;
  /** Highest class of the fields that are not delivery recipients. */
  bodyHighest: DataClass;
  /** Dotted paths of delivery-recipient fields. */
  recipientFields: string[];
  /** Dotted paths of fields without any annotation. */
  unannotated: string[];
}

type Def = {
  type: string;
  innerType?: z.ZodType;
  element?: z.ZodType;
  shape?: Record<string, z.ZodType>;
  options?: z.ZodType[];
  valueType?: z.ZodType;
  in?: z.ZodType;
};
const defOf = (s: z.ZodType): Def => (s as unknown as { _zod: { def: Def } })._zod.def;

/** Walk a payload schema and report its data classes. */
export function payloadClass(schema: z.ZodType): PayloadClassReport {
  const body: DataClass[] = [];
  const recipientFields: string[] = [];
  const unannotated: string[] = [];

  const visit = (s: z.ZodType, path: string, inherited?: FieldClass): void => {
    const own = fieldClass.get(s) ?? inherited;
    const def = defOf(s);
    if (def.innerType) return visit(def.innerType, path, own);
    if (def.type === "pipe" && def.in) return visit(def.in, path, own);
    if (def.type === "object" && def.shape) {
      const entries = Object.entries(def.shape);
      if (entries.length === 0) leaf(path, own);
      for (const [k, v] of entries) visit(v, path ? `${path}.${k}` : k, own);
      return;
    }
    if (def.type === "array" && def.element) return visit(def.element, `${path}[]`, own);
    if (def.type === "record" && def.valueType) return visit(def.valueType, `${path}{}`, own);
    if (def.type === "union" && def.options) {
      for (const [i, o] of def.options.entries()) visit(o, `${path}|${i}`, own);
      return;
    }
    leaf(path, own);
  };
  const leaf = (path: string, c?: FieldClass): void => {
    if (!c) unannotated.push(path || "(root)");
    else if (c.role === "delivery_recipient") recipientFields.push(path);
    else body.push(c.dataClass);
  };

  visit(schema, "");
  return {
    complete: unannotated.length === 0,
    bodyHighest: highestClass(body),
    recipientFields,
    unannotated,
  };
}

/**
 * Effective data class of a port call (PL2-D-03): the highest of the port default, `call.dataClass`
 * and the payload annotations. Only a fully annotated payload may go below the port default; a
 * caller-stated class below the default is refused with IPB-PORT-003 before any I/O.
 */
export function effectiveDataClass(
  port: string,
  call?: Pick<PortCall, "dataClass">,
  payload?: PayloadClassReport,
): DataClass {
  const portDefault = portDefaultDataClass(port);
  if (call?.dataClass && !atLeast(call.dataClass, portDefault)) {
    throw new PortError("IPB-PORT-003", port, {
      detail: `a caller may raise the data class, never lower it below the ${port} default ${portDefault}`,
      meta: { requested: call.dataClass, portDefault },
    });
  }
  const base =
    payload && payload.complete
      ? payload.bodyHighest
      : payload
        ? highestClass([portDefault, payload.bodyHighest])
        : portDefault;
  return highestClass([base, call?.dataClass ?? DATA_CLASSES[0]]);
}
