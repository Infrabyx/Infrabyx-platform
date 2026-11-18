// In-memory stand-in for the approvals engine's mandate verifier (owner answer #100's gap,
// R1-D-66). `ApprovalsEngine.mandateVerifier` in `@infrabyx/tenancy` is the real one; this keeps
// the same refusals so adapter tests can prove each one stops the call before the vendor.
export { MemoryMandateApprovals } from "@infrabyx/fakes";
