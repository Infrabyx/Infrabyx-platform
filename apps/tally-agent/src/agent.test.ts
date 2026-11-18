import { mkdtemp, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentPostJob, JournalBatch } from "@infrabyx/contracts/ports";
import { MemoryStateStore, postBatch, readTrialBalance, TallyAgent } from "./agent.js";
import { checkConfig, ConfigError } from "./config.js";
import { FileStateStore } from "./state.js";
import { TallyPrimeStub } from "./stub.js";
import { reasonOf, remoteIdOf, TallyClient } from "./tally.js";

const COMPANY = "Acme Finance Pvt Ltd";
const LEDGERS = ["Loans and Advances", "Bank Current Account", "Interest Income"];

let n = 0;
function job(over: Partial<JournalBatch> = {}, attempt = 1): AgentPostJob {
  n++;
  const batch: JournalBatch = {
    journalId: `jrn-test-${n}`,
    initiatedBy: { type: "service", id: "svc_finance_posting" },
    entries: [
      {
        voucherType: "Journal",
        date: "2026-11-02",
        reference: `JV-${n}-1`,
        narration: "Disbursement of loan_0001",
        lines: [
          { ledger: "Loans and Advances", side: "debit", amountPaise: 150_000_00 },
          { ledger: "Bank Current Account", side: "credit", amountPaise: 150_000_00 },
        ],
      },
      {
        voucherType: "Receipt",
        date: "2026-11-03",
        reference: `RV-${n}-2`,
        lines: [
          { ledger: "Bank Current Account", side: "debit", amountPaise: 1_234_56 },
          { ledger: "Interest Income", side: "credit", amountPaise: 1_234_56 },
        ],
      },
    ],
    ...over,
  };
  return { kind: "post", jobId: batch.journalId, attempt, company: COMPANY, batch };
}

for (const collision of ["duplicate", "alter"] as const) {
  describe(`posting to TallyPrime (REMOTEID collisions: ${collision}; R1-D-178)`, () => {
    const setup = () => {
      const stub = new TallyPrimeStub(collision).company({ name: COMPANY, ledgers: LEDGERS });
      const tally = new TallyClient({ url: "http://127.0.0.1:9000", fetch: stub.fetch });
      return { stub, tally };
    };

    it("creates each voucher once and acknowledges it from the read-back", async () => {
      const { stub, tally } = setup();
      const j = job();
      const r = await postBatch(tally, j);
      expect(r).toMatchObject({ outcome: "acknowledged", attempt: 1 });
      expect(Object.keys((r as { ledgerRefs: object }).ledgerRefs).sort()).toEqual(
        j.batch.entries.map((e) => e.reference).sort(),
      );
      expect(stub.vouchers(COMPANY)).toHaveLength(2);
      expect(stub.vouchers(COMPANY)[0]!.lines).toEqual([
        { ledger: "Loans and Advances", paise: -150_000_00 },
        { ledger: "Bank Current Account", paise: 150_000_00 },
      ]);
      // The same job again (a replay, a restart) finds both and creates nothing.
      const again = await postBatch(tally, { ...j, attempt: 2 });
      expect(again).toEqual({ ...r, attempt: 2 });
      expect(stub.vouchers(COMPANY)).toHaveLength(2);
      expect(stub.calls.imports).toBe(2);
    });

    it("recovers a lost answer by the read-back, with no duplicate", async () => {
      const { stub, tally } = setup();
      stub.loseNextAnswers(1);
      const r = await postBatch(tally, job());
      expect(r.outcome).toBe("acknowledged");
      expect(stub.vouchers(COMPANY)).toHaveLength(2);
      expect(stub.calls.imports).toBe(2);
    });

    it("rejects a voucher whose REMOTEID another voucher carries, and alters nothing", async () => {
      const { stub, tally } = setup();
      const j = job();
      const e = j.batch.entries[0]!;
      const staged = stub.enter(COMPANY, {
        remoteId: remoteIdOf(j.batch.journalId, e.reference),
        voucherType: "Journal",
        date: e.date,
        lines: [
          { ledger: "Loans and Advances", paise: -1 },
          { ledger: "Bank Current Account", paise: 1 },
        ],
      });
      const before = structuredClone(staged);
      const r = await postBatch(tally, j);
      expect(r).toMatchObject({
        outcome: "rejected",
        reasonCode: "remote_mismatch",
        reference: e.reference,
      });
      expect(stub.vouchers(COMPANY)).toEqual([before]);
      expect(stub.calls.imports).toBe(0);
    });

    it("rejects a REMOTEID that two vouchers carry", async () => {
      const { stub, tally } = setup();
      const j = job();
      const e = j.batch.entries[0]!;
      for (let i = 0; i < 2; i++)
        stub.enter(COMPANY, {
          remoteId: remoteIdOf(j.batch.journalId, e.reference),
          voucherType: e.voucherType,
          date: e.date,
          lines: [
            { ledger: "Loans and Advances", paise: -150_000_00 },
            { ledger: "Bank Current Account", paise: 150_000_00 },
          ],
        });
      expect(await postBatch(tally, j)).toMatchObject({ reasonCode: "remote_duplicate" });
    });

    it("maps TallyPrime's refusals and stops at the refused voucher", async () => {
      const { stub, tally } = setup();
      const unknown = job();
      unknown.batch.entries[1]!.lines[1]!.ledger = "No Such Ledger";
      expect(await postBatch(tally, unknown)).toMatchObject({
        reasonCode: "ledger_unknown",
        reference: unknown.batch.entries[1]!.reference,
      });
      expect(stub.vouchers(COMPANY)).toHaveLength(1);
      // Replayed after the ledger is fixed in the batch's source: the first voucher is found.
      const typ = job();
      typ.batch.entries[0]!.voucherType = "Sales";
      expect(await postBatch(tally, typ)).toMatchObject({ reasonCode: "voucher_type_unknown" });
      const closed = job();
      closed.batch.entries[0]!.date = "2025-11-02";
      expect(await postBatch(tally, closed)).toMatchObject({ reasonCode: "period_closed" });
      expect(await postBatch(tally, { ...job(), company: "Other Co" })).toMatchObject({
        reasonCode: "company_not_open",
      });
      stub.refuseNextImport("Duplicate Voucher Number");
      expect(await postBatch(tally, job())).toMatchObject({ reasonCode: "duplicate_voucher" });
      stub.down = true;
      expect(await postBatch(tally, job())).toMatchObject({ reasonCode: "tally_unreachable" });
    });

    it("reads the trial balance as of a date, in paise", async () => {
      const { tally } = setup();
      await postBatch(tally, job());
      const r = await readTrialBalance(tally, {
        kind: "trial_balance",
        jobId: "tbr_01JAAAAAAAAAAAAAAAAAAAAAAA",
        attempt: 1,
        company: COMPANY,
        asOf: "2026-11-02",
      });
      expect(r).toEqual({
        kind: "trial_balance",
        attempt: 1,
        outcome: "done",
        lines: [
          { ledger: "Loans and Advances", debitPaise: 150_000_00, creditPaise: 0 },
          { ledger: "Bank Current Account", debitPaise: 0, creditPaise: 150_000_00 },
        ],
      });
    });
  });
}

describe("the alter behaviour is never trusted (R1-D-178)", () => {
  it("an ALTERED answer is judged by the read-back", async () => {
    const stub = new TallyPrimeStub("alter").company({ name: COMPANY, ledgers: LEDGERS });
    const tally = new TallyClient({ url: "http://127.0.0.1:9000", fetch: stub.fetch });
    const answer = await tally.create(COMPANY, "ipb:jrn-x-00001:JV-1", job().batch.entries[0]!);
    expect(answer).toEqual({ kind: "created" });
    expect(await tally.create(COMPANY, "ipb:jrn-x-00001:JV-1", job().batch.entries[0]!)).toEqual({
      kind: "lost",
    });
  });
});

describe("reason codes from TallyPrime's error text [VERIFY]", () => {
  it("maps the known shapes and falls back to tally_error", () => {
    expect(reasonOf("Ledger 'X' does not exist!")).toBe("ledger_unknown");
    expect(reasonOf("Voucher Type 'Sales' does not exist!")).toBe("voucher_type_unknown");
    expect(reasonOf("Could not set 'SVCurrentCompany' to 'X'")).toBe("company_not_open");
    expect(reasonOf("Voucher date is out of the financial period")).toBe("period_closed");
    expect(reasonOf("Duplicate Voucher Number")).toBe("duplicate_voucher");
    expect(reasonOf("Something else")).toBe("tally_error");
  });
});

describe("configuration", () => {
  it("takes https to the platform and plain http only on the tenant's own network", () => {
    expect(
      checkConfig({ platformUrl: "https://api.example.in/", tallyUrl: "http://192.168.1.20:9000" }),
    ).toEqual({
      platformUrl: "https://api.example.in",
      tallyUrl: "http://192.168.1.20:9000",
      stateDir: "/data",
      tallyTimeoutSeconds: 30,
    });
    for (const c of [
      { platformUrl: "http://api.example.in" },
      { platformUrl: "https://u:p@api.example.in" },
      { platformUrl: "https://api.example.in/?x=1" },
      { platformUrl: "https://api.example.in", tallyUrl: "http://tally.example.in:9000" },
      { platformUrl: "https://api.example.in", tallyUrl: "http://8.8.8.8:9000" },
      { platformUrl: "https://api.example.in", tallyUrl: "https://127.0.0.1:9000" },
      { platformUrl: "https://api.example.in", extra: 1 },
      { platformUrl: "not a url" },
    ])
      expect(() => checkConfig(c), JSON.stringify(c)).toThrow(ConfigError);
    for (const host of [
      "127.0.0.1",
      "10.0.0.5",
      "172.20.1.1",
      "localhost",
      "host.docker.internal",
      "[::1]",
    ])
      expect(
        checkConfig({ platformUrl: "https://a.in", tallyUrl: `http://${host}:9000` }).tallyUrl,
      ).toContain("9000");
  });
});

describe("the state file", () => {
  it("is written 0600 and refused when others can read it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tally-agent-"));
    const store = new FileStateStore(dir);
    expect(await store.load()).toBeNull();
    const mem = new MemoryStateStore();
    const platform = fakePlatform();
    const agent = new TallyAgent({
      platformUrl: "https://api.example.in",
      tally: new TallyClient({ url: "http://127.0.0.1:9000" }),
      state: store,
      fetch: platform,
    });
    await agent.enrol("tac1.tnt_acme.tga_01JAAAAAAAAAAAAAAAAAAAAAAA." + "A".repeat(43));
    expect((await stat(store.file)).mode & 0o777).toBe(0o600);
    const s = await store.load();
    expect(s).toMatchObject({ tenantId: "tnt_acme", company: COMPANY, lastSeq: 0 });
    expect(s!.privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(platform.bodies[0]).not.toContain("PRIVATE");
    await chmod(store.file, 0o644);
    await expect(store.load()).rejects.toThrow(/chmod 600/);
    await writeFile(join(dir, "enrol-code"), " tac1.x \n");
    expect(await store.enrolCode()).toBe("tac1.x");
    await store.removeEnrolCode();
    expect(await store.enrolCode()).toBeNull();
    expect(mem.state).toBeNull();
  });
});

function fakePlatform() {
  const bodies: string[] = [];
  const f = async (_url: string, init: { body?: Uint8Array }) => {
    bodies.push(new TextDecoder().decode(init.body));
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          agentId: "tga_01JAAAAAAAAAAAAAAAAAAAAAAA",
          tenantId: "tnt_acme",
          company: COMPANY,
          pollTimeoutSeconds: 25,
        }),
    };
  };
  return Object.assign(f, { bodies });
}
