// Connector marketplace manifest (IPB-10 §10.4.6.1). CI lints every
// packages/connectors/marketplace/*.manifest.json against this schema (@IPB-10-29).
import { z } from "zod";
import { DataClass, Residency } from "./data-class.js";

const url = z.url({ protocol: /^https$/ });

export const ConnectorManifest = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  category: z.string().min(1),
  vendor: z.object({ name: z.string().min(1), privacy_url: url, support_url: url }),
  auth: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("oauth2"),
      authorize_url: url,
      token_url: url,
      scopes: z.array(z.string()),
      pkce: z.boolean(),
    }),
    z.object({ type: z.literal("api_key"), secrets: z.array(z.string().min(1)).min(1) }),
    z.object({ type: z.literal("embedded_signup"), secrets: z.array(z.string().min(1)).min(1) }),
  ]),
  scopes_required: z.array(
    z.string().regex(/^[a-z_]+\.[a-z_]+:(read|write|delete|approve|export|admin|\*)$/),
  ),
  events_consumed: z.array(z.string()),
  events_produced: z.array(z.string()),
  actions: z.array(z.object({ id: z.string(), input_schema: z.string(), write: z.boolean() })),
  settings_schema: z.record(z.string(), z.unknown()),
  data_class_max: DataClass,
  residency: Residency,
  health: z.object({ type: z.string(), interval_seconds: z.number().int().positive() }),
  ports: z.array(z.string()).min(1),
  tiers: z.array(z.string()),
  help_key: z.string().regex(/^hlp\./),
  /**
   * PAYMENTS connectors installed by a tenant settle only into that tenant's own account; no
   * Infrabyx or Udofin account sits in a borrower's repayment or disbursal flow (PL2-D-10, P-18).
   */
  settlement: z.enum(["tenant_own_account"]).optional(),
});
export type ConnectorManifest = z.infer<typeof ConnectorManifest>;

/** Manifest checks beyond the schema (IPB-10-29/31, P-18). Returns problems; empty when valid. */
export function lintConnectorManifest(m: ConnectorManifest): string[] {
  const problems: string[] = [];
  if (m.ports.includes("PAYMENTS") && m.settlement !== "tenant_own_account")
    problems.push(
      `${m.id}: PAYMENTS connectors must declare settlement "tenant_own_account" (P-18)`,
    );
  if (
    m.residency === "GLOBAL" &&
    (m.data_class_max === "REGULATED" || m.data_class_max === "SECRET")
  )
    problems.push(`${m.id}: a GLOBAL connector cannot take ${m.data_class_max} data (IPB-10-31)`);
  return problems;
}
