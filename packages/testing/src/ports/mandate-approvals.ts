// In-memory stand-in for the approvals engine's mandate verifier (owner answer #100's gap,
// R1-D-66). `ApprovalsEngine.mandateVerifier` in `@infrabyx/tenancy` is the real one; this keeps
// the same refusals so adapter tests can prove each one stops the call before the vendor.
import { IpbError } from "@infrabyx/contracts/errors";
import { MandateApprovalSubject, type MandateApprovalVerifier } from "@infrabyx/contracts/ports";

interface Approved {
  tenantId: string;
  subject: MandateApprovalSubject;
  consumed: boolean;
}

const refuse = (reason: string, detail: string, approvalRef: string): never => {
  throw new IpbError("IPB-UX-004", {
    detail: `mandate approval refused: ${detail}`,
    meta: { reason, request_id: approvalRef },
  });
};

export class MemoryMandateApprovals implements MandateApprovalVerifier {
  private readonly approved = new Map<string, Approved>();
  /** Every consume call, accepted or not, in order. */
  readonly calls: Array<{
    tenantId: string;
    approvalRef: string;
    subject: MandateApprovalSubject;
  }> = [];

  /**
   * `acceptAny` is for the shared contract cases only, which reuse one approval reference across
   * mandates: every call is accepted and recorded, nothing is consumed. Never use it elsewhere.
   */
  constructor(private readonly opts: { acceptAny?: boolean } = {}) {}

  /** Test helper: an approved `payments.mandate.change` request in `tenantId` for `subject`. */
  approve(approvalRef: string, tenantId: string, subject: MandateApprovalSubject): this {
    this.approved.set(approvalRef, {
      tenantId,
      subject: MandateApprovalSubject.parse(subject),
      consumed: false,
    });
    return this;
  }

  isConsumed(approvalRef: string): boolean {
    return this.approved.get(approvalRef)?.consumed === true;
  }

  async consume(input: {
    tenantId: string;
    approvalRef: string;
    subject: MandateApprovalSubject;
  }): Promise<void> {
    const want = MandateApprovalSubject.parse(input.subject);
    this.calls.push({ ...input, subject: want });
    if (this.opts.acceptAny) return;
    const a = this.approved.get(input.approvalRef);
    const ref = input.approvalRef;
    if (!a || a.tenantId !== input.tenantId)
      return refuse("not_found", "no such request in this tenant", ref);
    if (a.consumed) return refuse("consumed", "the approval was already used", ref);
    if (a.subject.operation !== want.operation)
      return refuse("other_operation", "approved for another operation", ref);
    if (a.subject.mandate !== want.mandate)
      return refuse("other_mandate", "approved for another mandate", ref);
    if (a.subject.maxAmountMinor !== want.maxAmountMinor)
      return refuse("other_amount", "approved for another amount", ref);
    a.consumed = true;
  }
}
