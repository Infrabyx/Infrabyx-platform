// Package-internal (not in the package's exports): the callbacks `SupportAccess` and `SupportReads`
// hand the kernel for a support principal (R1-D-76), and the live grant the kernel resolved for a
// support read. `manage` (its own requests and their listing) and `record` (the ledger entry of a
// read already made) need no live grant; `read` runs under the live grant and its module guard.
// Anything else a support principal runs needs a live grant, and a read-write one to write.
export type SupportGate = "manage" | "read" | "record";

const gates = new WeakMap<object, SupportGate>();

export function supportGate<F extends object>(fn: F, kind: SupportGate): F {
  gates.set(fn, kind);
  return fn;
}

export const supportGateOf = (fn: object): SupportGate | undefined => gates.get(fn);

/** The live grant a support transaction runs under. */
export interface LiveSupportGrant {
  id: string;
  modules: readonly string[];
  access: "read" | "read_write";
}

const live = new WeakMap<object, LiveSupportGrant>();

export function bindSupportGrant(tx: object, g: LiveSupportGrant): void {
  live.set(tx, g);
}

export const supportGrantOf = (tx: object): LiveSupportGrant | undefined => live.get(tx);
