// `TemporalTimers` (PL3 plan §5.1, PL3-D-19): the WORKFLOW-port timer engine for
// `@infrabyx/workflow` when `workflow.timers.engine` is `temporal`. Each timer is one `ipbTimer`
// workflow whose id is the timer id, so scheduling twice is a no-op; cancel is best effort. The
// PostgreSQL poller in `@infrabyx/workflow` still runs as the reconciler, and the receiver
// re-checks every timer, so a lost, late or duplicate Temporal timer is harmless.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TimerEngine, WorkflowPort } from "@infrabyx/contracts/ports";
import type { IpbTimerInput } from "./timer-workflow.js";

export const TIMER_WORKFLOW_TYPE = "ipbTimer";
export const TIMER_ACTIVITY = "ipbTimerFire";

/** Worker `workflowsPath` for the timer workflow (the .ts source in tests). */
export const TIMER_WORKFLOWS_PATH = ((js) => (existsSync(js) ? js : js.replace(/\.js$/, ".ts")))(
  fileURLToPath(new URL("./timer-workflow.js", import.meta.url)),
);

export interface TemporalTimersOptions {
  port: WorkflowPort;
  /** Task queue of the timer worker (inside `int.workflow.task_queue_prefix`). */
  taskQueue: string;
}

export class TemporalTimers implements TimerEngine {
  readonly name = "temporal";
  constructor(private readonly o: TemporalTimersOptions) {}

  async schedule(timerId: string, at: Date): Promise<void> {
    const input: IpbTimerInput = { timerId, fireAt: at.toISOString() };
    await this.o.port.startWorkflow(TIMER_WORKFLOW_TYPE, input, {
      id: timerId,
      taskQueue: this.o.taskQueue,
      inputClass: "INTERNAL",
    });
  }

  async cancel(timerId: string): Promise<void> {
    await this.o.port.cancel(timerId, "timer cancelled").catch(() => undefined);
  }
}

/** Worker activities for the timer workflow: `fire(timerId)` is `WorkflowTimers.fire` by id. */
export function timerActivities(fire: (timerId: string) => Promise<unknown>): {
  [TIMER_ACTIVITY]: (timerId: string) => Promise<void>;
} {
  return {
    async [TIMER_ACTIVITY](timerId: string) {
      await fire(timerId);
    },
  };
}
