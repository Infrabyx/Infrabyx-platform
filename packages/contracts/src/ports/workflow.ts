// WORKFLOW port (IPB-01 §01.4.4.2). Inputs over 32 KB go to STORAGE and are passed by reference.
// Workflow IDs, workflow and signal names, search attributes and task-queue names are not encoded
// by the payload codec and may carry no personal or REGULATED data (PL2-C-04, C-16).
import type { DataClass } from "../data-class.js";
import type { Port, PortCall } from "./common.js";

/** Largest inline workflow input; larger inputs are stored and referenced (IPB-01 WORKFLOW). */
export const WORKFLOW_INLINE_INPUT_MAX_BYTES = 32 * 1024;

export interface StartWorkflowOptions extends PortCall {
  /** Workflow id; also the idempotency key (re-use returns the running execution). */
  id: string;
  taskQueue: string;
  /** Declared class of the input; CONFIDENTIAL inputs never go to an INTERNAL-only engine (PL2-D-16). */
  inputClass?: DataClass;
}

export interface WorkflowExecution {
  id: string;
  runId: string;
  type: string;
  status: "running" | "completed" | "failed" | "cancelled" | "terminated" | "timed_out";
  startedAt: string;
  closedAt?: string;
}

export interface WorkflowPort extends Port {
  startWorkflow(
    type: string,
    input: unknown,
    opts: StartWorkflowOptions,
  ): Promise<WorkflowExecution>;
  signal(id: string, name: string, payload?: unknown): Promise<void>;
  query<T = unknown>(id: string, name: string, args?: unknown): Promise<T>;
  cancel(id: string, reason: string): Promise<void>;
  listOpen(filter?: { type?: string; taskQueue?: string }): Promise<WorkflowExecution[]>;
  describe(id: string): Promise<WorkflowExecution>;
}
