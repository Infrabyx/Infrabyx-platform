// The Temporal timer workflow behind `TemporalTimers` (PL3 plan §5.1, PL3-D-19). Deterministic:
// it sleeps until `fireAt` and runs one activity, `ipbTimerFire`, which the worker implements by
// calling `WorkflowTimers.fire` in `@infrabyx/workflow`. A cancellation ends the sleep quietly.
// Register it on a worker with `workflowsPath: TIMER_WORKFLOWS_PATH`, or re-export `ipbTimer`
// from the product's own workflows module.
import { CancelledFailure, isCancellation, proxyActivities, sleep } from "@temporalio/workflow";

export interface IpbTimerInput {
  timerId: string;
  /** ISO 8601 instant. */
  fireAt: string;
}

const { ipbTimerFire } = proxyActivities<{ ipbTimerFire(timerId: string): Promise<void> }>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 5, initialInterval: "10 seconds", backoffCoefficient: 2 },
});

export async function ipbTimer(input: IpbTimerInput): Promise<void> {
  const ms = Date.parse(input.fireAt) - Date.now();
  try {
    if (ms > 0) await sleep(ms);
  } catch (e) {
    if (isCancellation(e) || e instanceof CancelledFailure) return;
    throw e;
  }
  await ipbTimerFire(input.timerId);
}
