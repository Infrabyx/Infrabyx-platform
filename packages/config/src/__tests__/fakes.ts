// In-package fakes for unit tests; the shared fakes live in @infrabyx/testing.
import type {
  ApprovalGateway,
  ApprovalRequestInput,
  AuditEntryInput,
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxEvent,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";

export function fakeTx(ctx: KernelContext): Tx {
  let audited = false;
  return {
    ctx,
    query: async () => {
      throw new Error("no database in unit tests");
    },
    markAudited: () => {
      audited = true;
    },
    get audited() {
      return audited;
    },
  };
}

export class FakeKernel implements MutationKernel {
  readonly actions: string[] = [];
  async mutate<T>(
    ctx: KernelContext,
    fn: (tx: Tx) => Promise<T>,
    opts?: { action?: string },
  ): Promise<T> {
    const tx = fakeTx(ctx);
    const r = await fn(tx);
    if (!tx.audited) throw new Error("IPB-MOD-003: mutation without audit");
    if (opts?.action) this.actions.push(opts.action);
    return r;
  }
  async read<T>(ctx: KernelContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fn(fakeTx(ctx));
  }
}

export class FakeAudit implements AuditSink {
  readonly entries: AuditEntryInput[] = [];
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    this.entries.push(e);
    tx.markAudited();
    return { id: `led_${this.entries.length}` };
  }
}

export class FakeOutbox implements OutboxWriter {
  readonly events: Array<{ schema: string } & OutboxEvent> = [];
  async publish(_tx: Tx, schema: string, e: OutboxEvent): Promise<void> {
    this.events.push({ schema, ...e });
  }
}

export class FakeApprovals implements ApprovalGateway {
  readonly requests: ApprovalRequestInput[] = [];
  async request(tx: Tx, input: ApprovalRequestInput): Promise<{ id: string }> {
    this.requests.push(input);
    tx.markAudited();
    return { id: `apr_${this.requests.length}` };
  }
}

export const ctxFor = (roles: string[], over: Partial<KernelContext> = {}): KernelContext => ({
  tenantId: "tnt_a",
  principal: { id: "usr_maker", type: "user", roles },
  ...over,
});
