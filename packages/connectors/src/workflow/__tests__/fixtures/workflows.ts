// Sample workflows for the WORKFLOW contract leg (deterministic: no I/O, no clock reads).
import {
  condition,
  defineQuery,
  defineSignal,
  setHandler,
  sleep,
  ApplicationFailure,
} from "@temporalio/workflow";

export const approve = defineSignal<[string]>("approve");
export const state = defineQuery<{ approvedBy?: string; input: unknown }>("state");

/** Waits for an `approve` signal, then completes with who approved. */
export async function approval(input: unknown): Promise<string> {
  let approvedBy: string | undefined;
  setHandler(approve, (who) => void (approvedBy = who));
  setHandler(state, () => ({ ...(approvedBy ? { approvedBy } : {}), input }));
  await condition(() => approvedBy !== undefined);
  await sleep(10);
  return approvedBy!;
}

/** Fails with a message that must never reach Temporal in clear text (C-16). */
export async function failing(secret: string): Promise<void> {
  throw ApplicationFailure.nonRetryable(`failure carrying ${secret}`);
}
