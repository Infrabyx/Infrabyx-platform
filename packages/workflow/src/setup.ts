// One call that wires the approvals engine, the Work Inbox, timers and the approval workflow
// together, so a product cannot forget an observer.
import type { AuditSink, MutationKernel, OutboxWriter } from "@infrabyx/contracts/kernel";
import type { TimerEngine } from "@infrabyx/contracts/ports";
import type { SecretKey } from "@infrabyx/crypto";
import { ApprovalsEngine, type FieldCrypto, type ServiceReadRecord } from "@infrabyx/tenancy";
import { ApprovalWorkflow, type ApprovalNotifier } from "./approvals.js";
import { InboxService } from "./inbox.js";
import { settingsApprovalPolicy, type SettingsReader } from "./policy.js";
import { WorkflowTimers } from "./timers.js";

export interface CreateWorkflowOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  outbox?: OutboxWriter;
  fieldCrypto?: FieldCrypto;
  pseudonymKey?: SecretKey;
  /** Settings for the tenant's `mc.*` keys and `ux.bulk.confirm_threshold`. */
  settings?: SettingsReader;
  /** `workflow.timers.engine = temporal`: `TemporalTimers` from `@infrabyx/connectors/workflow`. */
  timerEngine?: TimerEngine;
  notifier?: ApprovalNotifier;
  onEngineError?: (e: unknown) => void;
  /** Operational log of the timer poller's cross-tenant reads (SVC_SCHEDULER, PL3-D-21). */
  onServiceRead?: (r: ServiceReadRecord) => void;
}

export function createWorkflow(o: CreateWorkflowOptions): {
  approvals: ApprovalsEngine;
  inbox: InboxService;
  timers: WorkflowTimers;
  workflow: ApprovalWorkflow;
} {
  const shared = {
    kernel: o.kernel,
    audit: o.audit,
    product: o.product,
    ...(o.outbox ? { outbox: o.outbox } : {}),
    ...(o.pseudonymKey ? { pseudonymKey: o.pseudonymKey } : {}),
  };
  const policy = o.settings ? settingsApprovalPolicy(o.settings) : undefined;
  const inbox = new InboxService({
    ...shared,
    ...(o.notifier?.itemEscalated ? { onEscalated: o.notifier.itemEscalated } : {}),
  });
  // The timers need the workflow's give-up handler, and the workflow needs the timers.
  const late: { wf?: ApprovalWorkflow } = {};
  const timers = new WorkflowTimers({
    kernel: o.kernel,
    audit: o.audit,
    ...(o.timerEngine ? { engine: o.timerEngine } : {}),
    ...(o.onEngineError ? { onEngineError: o.onEngineError } : {}),
    ...(o.onServiceRead ? { onServiceRead: o.onServiceRead } : {}),
    onGiveUp: (tx, t, error) => late.wf?.onTimerGiveUp(tx, t, error) ?? Promise.resolve(),
  });
  const wf = new ApprovalWorkflow({
    ...shared,
    inbox,
    timers,
    ...(o.notifier ? { notifier: o.notifier } : {}),
    ...(policy ? { reminderHours: policy.reminderHours, bulkThreshold: policy.bulkThreshold } : {}),
  });
  const approvals = new ApprovalsEngine({
    ...shared,
    ...(o.fieldCrypto ? { fieldCrypto: o.fieldCrypto } : {}),
    ...(policy ? { tenantPolicy: policy.tenantPolicy } : {}),
    observers: [wf],
  });
  wf.attach(approvals);
  inbox.useTimers(timers);
  late.wf = wf;
  return { approvals, inbox, timers, workflow: wf };
}
