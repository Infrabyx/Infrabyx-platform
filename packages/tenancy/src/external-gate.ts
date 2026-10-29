// Package-internal (not in the package's exports): the callbacks `ExternalReads` hands the kernel.
// The kernel runs an `external` principal's transaction only for one of these, so no external read
// goes unledgered and the principal makes no other write (R1-D-29).
const gated = new WeakSet<object>();

export function externalGate<F extends object>(fn: F): F {
  gated.add(fn);
  return fn;
}

export const isExternalGated = (fn: object): boolean => gated.has(fn);
