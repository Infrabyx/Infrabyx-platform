// AUTHZ port (IPB-01 §01.4.4.2). Deny by default: a PDP outage is IPB-AUTHZ-001, never an allow.
import type { Port } from "./common.js";

export interface AuthzPrincipal {
  id: string;
  roles: readonly string[];
  /** ABAC attributes: tenant_id, entity_id, product_scope, data_class, maker_id (IPB-02 §02.4.2). */
  attr?: Readonly<Record<string, unknown>>;
}

export interface AuthzResource {
  kind: string;
  id: string;
  attr?: Readonly<Record<string, unknown>>;
}

export interface AuthzDecision {
  allowed: boolean;
  /** Policy that decided, when the PDP reports it. */
  policy?: string;
  /** Opaque PDP reference for `explain`. */
  ref?: string;
}

/** Query plan for list filtering (`planResources`). */
export type ResourcePlan =
  | { kind: "always_allowed" }
  | { kind: "always_denied" }
  | { kind: "conditional"; condition: unknown };

export interface AuthzPort extends Port {
  check(
    principal: AuthzPrincipal,
    resource: AuthzResource,
    action: string,
    ctx?: Readonly<Record<string, unknown>>,
  ): Promise<AuthzDecision>;
  checkBatch(
    principal: AuthzPrincipal,
    items: ReadonlyArray<{ resource: AuthzResource; actions: readonly string[] }>,
  ): Promise<Array<{ resourceId: string; decisions: Record<string, AuthzDecision> }>>;
  planResources(principal: AuthzPrincipal, kind: string, action: string): Promise<ResourcePlan>;
  loadPolicies(bundle: { version: string; files: Readonly<Record<string, string>> }): Promise<void>;
  explain(decision: AuthzDecision): Promise<string>;
}

/** Actions an AGT_* principal may never perform, whatever its roles (IPB-02-10). */
export const AGENT_FORBIDDEN_ACTIONS = ["approve", "sign", "disburse", "delete", "grant"] as const;
