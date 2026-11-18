import { describe, expect, it } from "vitest";
import { ID_PREFIXES } from "../ids.js";
import {
  AgentEnrolRequest,
  AgentJob,
  AgentJobResult,
  AgentPublicJwk,
  parseEnrolCode,
  TALLY_REASON_CODES,
} from "./index.js";

const ULID = "01JAAAAAAAAAAAAAAAAAAAAAAA";
const secret = "A".repeat(43);
const jwk = { kty: "EC", crv: "P-256", x: "x".repeat(43), y: "y".repeat(43) };
const batch = {
  journalId: "jrn-0001-abc",
  initiatedBy: { type: "service", id: "svc_finance" },
  entries: [
    {
      voucherType: "Journal",
      date: "2026-11-02",
      reference: "JV-1",
      lines: [
        { ledger: "Loans", side: "debit", amountPaise: 100 },
        { ledger: "Bank", side: "credit", amountPaise: 100 },
      ],
    },
  ],
};

describe("TallyPrime agent wire contract (PR-FBX-46, R1-D-178)", () => {
  it("registers its id prefixes", () => {
    expect(ID_PREFIXES).toHaveProperty("tga");
    expect(ID_PREFIXES).toHaveProperty("tbr");
  });

  it("splits an enrolment code and refuses anything else", () => {
    expect(parseEnrolCode(`tac1.tnt_acme.tga_${ULID}.${secret}`)).toEqual({
      tenantId: "tnt_acme",
      agentId: `tga_${ULID}`,
      secret,
    });
    expect(parseEnrolCode(`tac1.tnt_${ULID}.tga_${ULID}.${secret}`)?.tenantId).toBe(`tnt_${ULID}`);
    for (const bad of [
      `tac2.tnt_acme.tga_${ULID}.${secret}`,
      `tac1.tnt_ACME.tga_${ULID}.${secret}`,
      `tac1.tnt_acme.tga_${ULID}.${secret}x`,
      `tac1.tnt_acme.tga_${ULID}.${secret.slice(1)}`,
      `tac1.tnt_acme.agt_${ULID}.${secret}`,
      ` tac1.tnt_acme.tga_${ULID}.${secret}`,
    ])
      expect(parseEnrolCode(bad)).toBeNull();
  });

  it("takes the public half of a P-256 key only", () => {
    expect(AgentPublicJwk.safeParse(jwk).success).toBe(true);
    expect(AgentPublicJwk.safeParse({ ...jwk, d: "z".repeat(43) }).success).toBe(false);
    expect(AgentPublicJwk.safeParse({ ...jwk, crv: "P-384" }).success).toBe(false);
    expect(
      AgentEnrolRequest.safeParse({
        code: `tac1.tnt_acme.tga_${ULID}.${secret}`,
        jwk,
        agentVersion: "1.0.0",
      }).success,
    ).toBe(true);
  });

  it("carries a balanced batch or a dated read, and nothing else", () => {
    expect(
      AgentJob.safeParse({
        kind: "post",
        jobId: batch.journalId,
        attempt: 1,
        company: "Acme",
        batch,
      }).success,
    ).toBe(true);
    expect(
      AgentJob.safeParse({
        kind: "trial_balance",
        jobId: `tbr_${ULID}`,
        attempt: 1,
        company: "Acme",
        asOf: "2026-11-30",
      }).success,
    ).toBe(true);
    expect(
      AgentJob.safeParse({ kind: "post", jobId: "x", attempt: 1, company: "Acme", batch }).success,
    ).toBe(false);
    expect(
      AgentJob.safeParse({
        kind: "post",
        jobId: batch.journalId,
        attempt: 1,
        company: "A\nB",
        batch,
      }).success,
    ).toBe(false);
  });

  it("accepts results with a known reason only", () => {
    expect(
      AgentJobResult.safeParse({
        kind: "post",
        attempt: 1,
        outcome: "acknowledged",
        ledgerRefs: { "JV-1": "guid-1/42" },
      }).success,
    ).toBe(true);
    for (const reasonCode of TALLY_REASON_CODES)
      expect(
        AgentJobResult.safeParse({
          kind: "post",
          attempt: 2,
          outcome: "rejected",
          reasonCode,
          reason: "refused",
        }).success,
      ).toBe(true);
    expect(
      AgentJobResult.safeParse({
        kind: "post",
        attempt: 1,
        outcome: "rejected",
        reasonCode: "something_else",
        reason: "x",
      }).success,
    ).toBe(false);
    expect(
      AgentJobResult.safeParse({
        kind: "trial_balance",
        attempt: 1,
        outcome: "done",
        lines: [{ ledger: "Bank", debitPaise: 1.5, creditPaise: 0 }],
      }).success,
    ).toBe(false);
  });
});
