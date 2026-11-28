// `issueDocument` on PostgreSQL with every platform migration applied (regulatory templates plan §8,
// items 2a and 2b; R1-D-315, R1-D-318, R1-D-321). Synthetic data and the platform fakes only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { StoragePort } from "@infrabyx/contracts/ports";
import { localTenantKeyId, sha256Hex } from "@infrabyx/crypto";
import { FieldCrypto, PgOutbox, type ApprovalsEngine } from "@infrabyx/tenancy";
import {
  FakeDocgen,
  FakeEsign,
  MemoryStorage,
  agentContext,
  fakeKms,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import { createWorkflow } from "../setup.js";
import {
  DOCUMENT_ISSUE_ACTION,
  DocumentIssuer,
  type DocumentIssue,
  type IssueDocumentInput,
} from "../documents.js";

let db: TestDatabase;
let approvals: ApprovalsEngine;
let storage: MemoryStorage;
let esign: FakeEsign;
let issuer: DocumentIssuer;

const ctx = (id: string, roles: string[], tenantId = "tnt_a"): KernelContext =>
  withTenant(tenantId, roles, { principal: { id } });
const maker = ctx("usr_maker", ["ORG_ADMIN"]);
const checker = ctx("usr_checker", ["ORG_CHECKER"]);
const reviewer = ctx("usr_reviewer", ["ORG_MEMBER"]);
const agent = agentContext("tnt_a");
const otherTenant = ctx("usr_other", ["ORG_ADMIN"], "tnt_b");

const SYNTHETIC = "Synthetic Depositor 7Q4Z";
const SIGNER = {
  ref: "pty_synthetic_depositor",
  name: SYNTHETIC,
  email: "depositor@example.test",
  method: "AADHAAR_OTP_ESIGN" as const,
};
const later = () => new Date(Date.now() + 8 * 365 * 24 * 3_600_000);
const receipt = (o: Partial<IssueDocumentInput> = {}): IssueDocumentInput => ({
  templateId: "deposit_receipt",
  data: { depositor: SYNTHETIC, amount: "₹1,00,000" },
  format: "pdf",
  outputPrefix: "tenant/tnt_a/deposits",
  signers: [SIGNER],
  retainUntil: later(),
  ...o,
});
const notice = (o: Partial<IssueDocumentInput> = {}): IssueDocumentInput => ({
  templateId: "board_notice",
  data: { meeting: "Synthetic board meeting", date: "2026-12-15" },
  format: "pdf",
  outputPrefix: "tenant/tnt_a/secretarial",
  retainUntil: later(),
  ...o,
});
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { reason?: string; code?: string; name?: string }) => e.reason ?? e.code ?? e.name,
  );
const ledger = async (id: string) =>
  (
    await db.admin.query<{ action: string; after_digest: string }>(
      "select action, after_digest from audit.ledger where resource_id = $1 order by seq",
      [id],
    )
  ).rows;
const archivedObject = (s: StoragePort, key: string) => s.get(key);

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LD', 'A'), ('tnt_b', 'LD', 'B') on conflict do nothing",
  );
  ({ approvals } = createWorkflow({
    kernel: db.kernel,
    audit: db.audit,
    product: "LD",
    outbox: new PgOutbox(),
    fieldCrypto: new FieldCrypto({ kms: fakeKms(), keyIdFor: localTenantKeyId }),
  }));

  storage = new MemoryStorage();
  esign = new FakeEsign({ storage });
  const pdf = (doc: unknown) =>
    new TextEncoder().encode(`%PDF-1.4\n% synthetic\n${JSON.stringify(doc)}\n%%EOF\n`);
  const docgen = new FakeDocgen(
    [
      { templateId: "deposit_receipt", version: "2", formats: ["pdf", "pdfa", "docx"] },
      { templateId: "board_notice", version: "5", formats: ["pdf", "docx"] },
      { templateId: "unregistered", version: "1", formats: ["pdf"] },
    ],
    { storage, renderers: { pdf, docx: pdf } },
  );
  issuer = new DocumentIssuer({
    kernel: db.kernel,
    audit: db.audit,
    docgen,
    storage,
    esign,
    approvals,
  })
    .registerTemplate("deposit_receipt", { signing: "required" })
    .registerTemplate("board_notice", { signing: "none" });
  approvals.register(
    DOCUMENT_ISSUE_ACTION,
    issuer.approvalPolicy({ checkerRoles: ["ORG_CHECKER"] }),
  );
});
afterAll(async () => db?.end());

async function signedReceipt(): Promise<DocumentIssue> {
  const issued = await issuer.issue(maker, receipt({ approval: { riskClass: "R2" } }));
  await approvals.decide(checker, issued.approvalId!, "approve");
  await issuer.refreshApproval(maker, issued.id);
  const sent = await issuer.sendForSignature(maker, issued.id, { signers: [SIGNER] });
  esign.sign(sent.envelopeId!, SIGNER.ref);
  return issuer.completeSigning(maker, issued.id);
}

describe("issueDocument: render → approve → esign → archive (plan §8, 2a and 2b)", () => {
  it("the happy path: approved by a checker other than the maker, signed, archived with both copies", async () => {
    const issued = await issuer.issue(maker, receipt({ approval: { riskClass: "R2" } }));
    expect(issued).toMatchObject({
      state: "approval_pending",
      templateId: "deposit_receipt",
      templateVersion: "2",
      signing: "required",
    });
    expect(sha256Hex((await storage.get(issued.renderedKey)).body)).toBe(issued.renderedSha256);

    // The maker cannot approve their own document (PL3-D-07).
    expect(await refusal(approvals.decide(maker, issued.approvalId!, "approve"))).toBe(
      "IPB-SEC-007",
    );
    // Not yet approved: not signable.
    expect(await refusal(issuer.sendForSignature(maker, issued.id, { signers: [SIGNER] }))).toBe(
      "not_signable",
    );
    await approvals.decide(checker, issued.approvalId!, "approve");
    expect((await issuer.refreshApproval(maker, issued.id)).state).toBe("approved");

    const sent = await issuer.sendForSignature(maker, issued.id, { signers: [SIGNER] });
    expect(sent.state).toBe("signing");
    // Re-sending changes nothing (the same envelope).
    expect(
      (await issuer.sendForSignature(maker, issued.id, { signers: [SIGNER] })).envelopeId,
    ).toBe(sent.envelopeId);
    // Not yet signed: nothing moves.
    expect((await issuer.completeSigning(maker, issued.id)).state).toBe("signing");
    esign.sign(sent.envelopeId!, SIGNER.ref);
    const signed = await issuer.completeSigning(maker, issued.id);
    expect(signed.state).toBe("signed");
    expect(sha256Hex((await storage.get(signed.signedKey!)).body)).toBe(signed.signedSha256);

    const archived = await issuer.archive(maker, issued.id);
    expect(archived.state).toBe("archived");
    expect(archived.archivedSha256).toBe(signed.signedSha256);
    expect(archived.templateVersion).toBe("2");
    // R1-D-318 (2): the unsigned render is kept beside it, with the same retention.
    expect(archived.renderedArchivedSha256).toBe(archived.renderedSha256);
    for (const key of [archived.archivedKey!, archived.renderedArchivedKey!]) {
      await storage.assertImmutable(key);
      const o = await archivedObject(storage, key);
      expect(o.meta.bucketClass).toBe("REGULATED");
      expect(new Date(o.retainUntil!).getTime()).toBe(archived.retainUntil.getTime());
    }
    expect(sha256Hex((await storage.get(archived.archivedKey!)).body)).toBe(archived.signedSha256);
    expect(sha256Hex((await storage.get(archived.renderedArchivedKey!)).body)).toBe(
      archived.renderedSha256,
    );

    // Every step is on the ledger (the ledger keeps a digest of what it names, never the data).
    const entries = await ledger(issued.id);
    expect(entries.map((e) => e.action)).toEqual([
      "workflow.document_issue.issue",
      "workflow.document_issue.approval_requested",
      "workflow.document_issue.approve",
      "workflow.document_issue.send",
      "workflow.document_issue.sign",
      "workflow.document_issue.archive_keyed",
      "workflow.document_issue.archive",
    ]);
    expect(JSON.stringify(entries)).not.toContain(SYNTHETIC);
    expect(JSON.stringify(entries)).not.toContain(SIGNER.email);
    // The record keeps neither the data nor the signer's details.
    const raw = await db.admin.query("select * from workflow.document_issue where id = $1", [
      issued.id,
    ]);
    expect(JSON.stringify(raw.rows[0])).not.toContain(SYNTHETIC);
    expect(JSON.stringify(raw.rows[0])).not.toContain(SIGNER.email);

    // A retry of every step is a no-op: the same record, no new ledger entry.
    await issuer.refreshApproval(maker, issued.id);
    await issuer.sendForSignature(maker, issued.id, { signers: [SIGNER] });
    await issuer.completeSigning(maker, issued.id);
    expect(await issuer.archive(maker, issued.id)).toEqual(archived);
    expect((await ledger(issued.id)).length).toBe(entries.length);
  });

  it("R1-D-318 (1): a signing template is refused without signers, and can never be archived unsigned", async () => {
    expect(await refusal(issuer.issue(maker, receipt({ signers: [] })))).toBe("signers_required");
    const { signers: _omitted, ...noSigners } = receipt();
    expect(await refusal(issuer.issue(maker, noSigners))).toBe("signers_required");
    const issued = await issuer.issue(maker, receipt());
    expect(issued.state).toBe("rendered");
    expect(await refusal(issuer.archive(maker, issued.id))).toBe("not_archivable");
    expect(await refusal(issuer.review(reviewer, issued.id))).toBe("review_not_applicable");
    // The database holds the same rule.
    await expect(
      db.admin.query(
        "update workflow.document_issue set state = 'archived', archived_sha256 = rendered_sha256 where id = $1",
        [issued.id],
      ),
    ).rejects.toThrow(/document_issue_signing_path/);
  });

  it("an unsigned template: archived only after a person reviewed it, never with signers", async () => {
    expect(await refusal(issuer.issue(maker, notice({ signers: [SIGNER] })))).toBe(
      "signers_not_expected",
    );
    const issued = await issuer.issue(maker, notice());
    expect(issued).toMatchObject({ state: "rendered", signing: "none", templateVersion: "5" });
    expect(await refusal(issuer.archive(maker, issued.id))).toBe("not_archivable");
    expect(await refusal(issuer.sendForSignature(maker, issued.id, { signers: [SIGNER] }))).toBe(
      "not_signable",
    );
    // An agent never reviews (IPB-02-10), and nor does the person who issued it (plan §8, 2b).
    expect(await refusal(issuer.review(agent, issued.id))).toBe("IPB-SEC-004");
    expect(await refusal(issuer.review(maker, issued.id))).toBe("IPB-SEC-007");
    const reviewed = await issuer.review(reviewer, issued.id);
    expect(reviewed).toMatchObject({ state: "reviewed", reviewedBy: "usr_reviewer" });
    expect((await issuer.review(reviewer, issued.id)).reviewedAt).toEqual(reviewed.reviewedAt);
    const archived = await issuer.archive(maker, issued.id);
    expect(archived).toMatchObject({
      state: "archived",
      archivedSha256: issued.renderedSha256,
      renderedArchivedKey: null,
    });
    await storage.assertImmutable(archived.archivedKey!);
  });

  it("an unsigned template under maker-checker: the approval is the review; a rejection never archives", async () => {
    const a = await issuer.issue(maker, notice({ approval: { riskClass: "R2" } }));
    expect(await refusal(issuer.review(reviewer, a.id))).toBe("review_not_applicable");
    await approvals.decide(checker, a.approvalId!, "approve");
    expect((await issuer.refreshApproval(maker, a.id)).state).toBe("approved");
    expect((await issuer.archive(maker, a.id)).state).toBe("archived");

    const b = await issuer.issue(maker, notice({ approval: { riskClass: "R2" } }));
    await approvals.decide(checker, b.approvalId!, "reject", "synthetic: wrong date");
    expect(await issuer.refreshApproval(maker, b.id)).toMatchObject({
      state: "rejected",
      failureReason: "approval_rejected",
    });
    expect(await refusal(issuer.archive(maker, b.id))).toBe("not_archivable");
  });

  it("a rejected approval never signs", async () => {
    const issued = await issuer.issue(maker, receipt({ approval: { riskClass: "R2" } }));
    await approvals.decide(checker, issued.approvalId!, "reject", "synthetic: wrong amount");
    expect((await issuer.refreshApproval(maker, issued.id)).state).toBe("rejected");
    expect(await refusal(issuer.sendForSignature(maker, issued.id, { signers: [SIGNER] }))).toBe(
      "not_signable",
    );
  });

  it("without an approval an agent may not send for signature; the signers must be those issued", async () => {
    const issued = await issuer.issue(agent, receipt());
    expect(await refusal(issuer.sendForSignature(agent, issued.id, { signers: [SIGNER] }))).toBe(
      "IPB-SEC-004",
    );
    expect(
      await refusal(
        issuer.sendForSignature(maker, issued.id, {
          signers: [{ ...SIGNER, email: "someone.else@example.test" }],
        }),
      ),
    ).toBe("signers_changed");
    expect((await issuer.sendForSignature(maker, issued.id, { signers: [SIGNER] })).state).toBe(
      "signing",
    );
  });

  it("a signed file whose hash changes before the archive is failed, and nothing is archived", async () => {
    const signed = await signedReceipt();
    await storage.put(signed.signedKey!, new TextEncoder().encode("%PDF-1.4 tampered\n"), {
      bucketClass: "REGULATED",
      contentType: "application/pdf",
    });
    expect(await refusal(issuer.archive(maker, signed.id))).toBe("hash_mismatch");
    const after = await issuer.get(maker, signed.id);
    expect(after).toMatchObject({ state: "failed", failureReason: "hash_mismatch" });
    expect(await refusal(storage.get(after.archivedKey!))).toBe("IPB-STOR-001");
    expect(await refusal(issuer.archive(maker, signed.id))).toBe("not_archivable");
  });

  it("an archive interrupted after its write completes on retry, to the same write-once keys", async () => {
    const signed = await signedReceipt();
    const flaky = Object.create(storage) as MemoryStorage;
    let failOnce = true;
    flaky.assertImmutable = async (key: string) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("synthetic outage after the write");
      }
      return storage.assertImmutable(key);
    };
    const docgen = new FakeDocgen();
    const retrying = new DocumentIssuer({
      kernel: db.kernel,
      audit: db.audit,
      docgen,
      storage: flaky,
      esign,
      approvals,
    });
    await expect(retrying.archive(maker, signed.id)).rejects.toThrow(/synthetic outage/);
    const keyed = await issuer.get(maker, signed.id);
    expect(keyed.state).toBe("signed");
    expect(keyed.archivedKey).not.toBeNull();
    const archived = await retrying.archive(maker, signed.id);
    expect(archived).toMatchObject({
      state: "archived",
      archivedKey: keyed.archivedKey,
      renderedArchivedKey: keyed.renderedArchivedKey,
    });
  });

  it("a declined envelope is rejected and never archived", async () => {
    const issued = await issuer.issue(maker, receipt());
    const sent = await issuer.sendForSignature(maker, issued.id, { signers: [SIGNER] });
    esign.decline(sent.envelopeId!, SIGNER.ref);
    expect(await issuer.completeSigning(maker, issued.id)).toMatchObject({
      state: "rejected",
      failureReason: "signer_declined",
    });
    expect(await refusal(issuer.archive(maker, issued.id))).toBe("not_archivable");
  });

  it("refusals before anything is rendered or recorded", async () => {
    expect(await refusal(issuer.issue(maker, receipt({ templateId: "unregistered" })))).toBe(
      "template_unregistered",
    );
    expect(await refusal(issuer.issue(maker, receipt({ format: "docx" })))).toBe(
      "format_not_signable",
    );
    expect(
      await refusal(issuer.issue(maker, receipt({ retainUntil: new Date(Date.now() - 1000) }))),
    ).toBe("retention_invalid");
  });

  it("row-level security keeps a record to its tenant", async () => {
    const issued = await issuer.issue(maker, notice());
    expect(await refusal(issuer.get(otherTenant, issued.id))).toBe("NotFoundError");
  });
});
