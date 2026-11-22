// Package-internal (not in the package's exports): the kernel's scoped branch read (Finbyx
// PR-FBX-54; R1-D-273), keyed by the kernel instance, so only the approvals engine of this package
// reaches it for an approval executor. Nothing a request supplies can reach it.
import type { Tx } from "@infrabyx/contracts/kernel";

/** Who opens a scoped branch read: an approval executor, or a capability named at construction. */
export type ScopedBranchReadSource =
  { kind: "approval"; requestId: string; action: string } | { kind: "capability"; name: string };

/** What the caller asks for (validated by the kernel). */
export interface ScopedBranchReadRequest {
  branchIds: readonly string[];
  reason: string;
}

export type ScopedBranchReadImpl = <T>(
  tx: Tx,
  source: ScopedBranchReadSource,
  req: ScopedBranchReadRequest,
  fn: (tx: Tx) => Promise<T>,
) => Promise<T>;

const impls = new WeakMap<object, ScopedBranchReadImpl>();

export function bindScopedBranchRead(kernel: object, impl: ScopedBranchReadImpl): void {
  impls.set(kernel, impl);
}

export const scopedBranchReadOf = (kernel: object): ScopedBranchReadImpl | undefined =>
  impls.get(kernel);
