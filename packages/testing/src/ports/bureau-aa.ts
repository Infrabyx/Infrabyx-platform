// BUREAU and AA_FIU contract cases and in-memory fakes (IPB-01-15; Finbyx PR-FBX-28, R1-D-43).
// The first vendor adapters, `cibil` and `setu-aa` (R1-D-61), run these cases against their stubs
// until the owner's sandboxes exist; then each runs `creditBureauContractCases(itsSandboxFixtures)`
// or `accountAggregatorContractCases(…)`. The fakes let products build their loan-origination
// flows now: deterministic fixtures, files as STORAGE references, no raw PAN in any result.
// BUREAU and AA_FIU contract cases and in-memory fakes (IPB-01-15; Finbyx PR-FBX-28, R1-D-43).
// The first vendor adapters, `cibil` and `setu-aa` (R1-D-61), run these cases against their stubs
// until the owner's sandboxes exist; then each runs `creditBureauContractCases(itsSandboxFixtures)`
// or `accountAggregatorContractCases(…)`. The fakes let products build their loan-origination
// flows now: deterministic fixtures, files as STORAGE references, no raw PAN in any result.
import { expect } from "vitest";
import {
  AaConsentRequest,
  AaFetchRequest,
  BureauPullRequest,
  payloadClass,
  type AaConsent,
  type AccountAggregatorPort,
  type CreditBureauPort,
} from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";
import { type CreditBureauFixtures, type AccountAggregatorFixtures } from "@infrabyx/fakes";
export {
  type CreditBureauFixtures,
  CREDIT_BUREAU_FAKE_FIXTURES,
  FakeCreditBureau,
  type AccountAggregatorFixtures,
  ACCOUNT_AGGREGATOR_FAKE_FIXTURES,
  FakeAccountAggregator,
} from "@infrabyx/fakes";

// Word-bounded, so a PAN-shaped run inside a random ULID (e.g. a consent id) never matches.
const PAN_LIKE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;

export function creditBureauContractCases(
  fx: CreditBureauFixtures,
): Array<ContractCase<CreditBureauPort>> {
  const req = (pan: string, name: string, enquiry: "soft" | "hard" = "soft") => ({
    bureau: "cibil" as const,
    enquiry,
    purpose: "new_credit" as const,
    consentRef: fx.consentRef(),
    subject: { subjectRef: "cus:contract", kind: "individual" as const, name, pan },
    reportPrefix: fx.reportPrefix,
  });
  return [
    {
      name: "the pull request classes identity fields REGULATED; the adapter stays IN",
      async run(p) {
        expect(payloadClass(BureauPullRequest).bodyHighest).toBe("REGULATED");
        expect(p.descriptor.residency).toBe("IN");
        expect(p.descriptor.maxDataClass).toBe("REGULATED");
      },
    },
    {
      name: "a pull needs a consent receipt and a well-formed subject; neither reaches the CIC otherwise",
      async run(p) {
        const { consentRef: _c, ...noConsent } = req(fx.known.pan, fx.known.name);
        await expect(p.pull(noConsent as never)).rejects.toThrow();
        await expect(
          p.pull({ ...req(fx.known.pan, fx.known.name), consentRef: "consent-1" }),
        ).rejects.toThrow();
        await expect(p.pull(req("abc", fx.known.name))).rejects.toThrow();
      },
    },
    {
      name: "a known subject returns the raw report by STORAGE reference with its hash, a normalised summary in paise and the evidence",
      async run(p) {
        const r = await p.pull(req(fx.known.pan, fx.known.name));
        if (r.state === "pending") return; // completed through status or the webhook
        expect(r.state).toBe("ready");
        expect(r.report?.storageKey.startsWith(fx.reportPrefix)).toBe(true);
        expect(r.report?.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(r.vendorRef && r.adapter && r.formatVersion && r.checkedAt).toBeTruthy();
        expect(r.summary?.scoreVersion).toBeTruthy();
        for (const t of r.summary?.tradelines ?? [])
          for (const v of [t.sanctionedPaise, t.currentPaise, t.overduePaise])
            expect(Number.isInteger(v) && v >= 0).toBe(true);
        expect(JSON.stringify(r)).not.toMatch(PAN_LIKE);
        expect((await p.status(r.pullId)).pullId).toBe(r.pullId);
      },
    },
    {
      name: "each tradeline carries its EMI in integer paise, or null when the CIC reports none (the known subject has both)",
      async run(p) {
        const r = await p.pull(req(fx.known.pan, fx.known.name));
        const ready = r.state === "pending" ? await p.status(r.pullId) : r;
        if (ready.state === "pending") return; // completed through status or the webhook
        const emis = (ready.summary?.tradelines ?? []).map((t) => t.emiPaise);
        for (const e of emis) {
          expect(e).not.toBeUndefined();
          if (e !== null) expect(Number.isSafeInteger(e) && e > 0).toBe(true);
        }
        expect(emis.some((e) => e === null)).toBe(true);
        expect(emis.some((e) => e !== null)).toBe(true);
      },
    },
    {
      name: "an unknown subject is a no-hit, and a hard enquiry shows on the next report",
      async run(p) {
        expect((await p.pull(req(fx.noHit.pan, fx.noHit.name))).state).toBe("no_hit");
        const before = await p.pull(req(fx.known.pan, fx.known.name));
        await p.pull(req(fx.known.pan, fx.known.name, "hard"));
        const after = await p.pull(req(fx.known.pan, fx.known.name));
        if (before.summary && after.summary)
          expect(after.summary.enquiries.last30d).toBeGreaterThan(before.summary.enquiries.last30d);
      },
    },
    {
      name: "a webhook is read back from the CIC; an event naming no pull is refused",
      async run(p) {
        const r = await p.pull(req(fx.known.pan, fx.known.name));
        const back = await p.handleWebhook(
          new TextEncoder().encode(JSON.stringify({ pullId: r.pullId, state: "no_hit" })),
          {},
        );
        expect(back.pullId).toBe(r.pullId);
        expect(back.state).not.toBe("no_hit");
        await expect(p.handleWebhook(new TextEncoder().encode("{}"), {})).rejects.toMatchObject({
          code: "IPB-PORT-001",
        });
      },
    },
  ];
}

export function accountAggregatorContractCases(
  fx: AccountAggregatorFixtures,
): Array<ContractCase<AccountAggregatorPort>> {
  const year = 365 * 86_400_000;
  const ask = (over: Partial<AaConsentRequest> = {}): AaConsentRequest => {
    const now = Date.now();
    return {
      customerHandle: fx.customerHandle,
      subjectRef: "cus:contract",
      consentRef: fx.consentRef(),
      purposeCode: "101",
      fiTypes: ["DEPOSIT", "TERM_DEPOSIT"],
      fetchType: "ONETIME",
      dataRange: {
        from: new Date(now - year).toISOString(),
        to: new Date(now).toISOString(),
      },
      dataLife: { unit: "MONTH", value: 3 },
      consentStart: new Date(now).toISOString(),
      consentExpiry: new Date(now + 30 * 86_400_000).toISOString(),
      ...over,
    };
  };
  const range = (c: AaConsent) => ({ from: c.dataRange.from, to: c.dataRange.to });
  return [
    {
      name: "the consent request classes the customer's handle REGULATED; the adapter stays IN",
      async run(p) {
        expect(payloadClass(AaConsentRequest).bodyHighest).toBe("REGULATED");
        expect(p.descriptor.residency).toBe("IN");
        expect(p.descriptor.maxDataClass).toBe("REGULATED");
      },
    },
    {
      name: "a consent request needs the product's receipt and a valid template; a PERIODIC one needs a frequency",
      async run(p) {
        const { consentRef: _c, ...noReceipt } = ask();
        await expect(p.requestConsent(noReceipt as never)).rejects.toThrow();
        await expect(p.requestConsent(ask({ fetchType: "PERIODIC" }))).rejects.toThrow();
        const c = await p.requestConsent(ask());
        expect(c.state).toBe("PENDING");
        expect((await p.consentStatus(c.consentId)).consentId).toBe(c.consentId);
      },
    },
    {
      name: "fetch works only under an ACTIVE consent, within its range and FI types; each payload names its ReBIT schema version and hash",
      async run(p) {
        const c = await p.requestConsent(ask());
        const fetch = (over: Partial<AaFetchRequest> = {}) =>
          p.fetch({ consentId: c.consentId, range: range(c), dataPrefix: fx.dataPrefix, ...over });
        await expect(fetch()).rejects.toMatchObject({ code: "IPB-PORT-001" });
        await fx.approve(p, c.consentId);
        const r = await fetch();
        expect(r.payloads.map((x) => x.fiType).sort()).toEqual(["DEPOSIT", "TERM_DEPOSIT"]);
        for (const x of r.payloads) {
          expect(x.schemaVersion).toMatch(/^\d+\.\d+(\.\d+)?$/);
          expect(x.sha256).toMatch(/^[0-9a-f]{64}$/);
          expect(x.storageKey.startsWith(fx.dataPrefix)).toBe(true);
          expect(x.maskedAccount).not.toMatch(/^[0-9]{9,}$/);
        }
        await expect(
          fetch({
            range: { from: new Date(Date.now() - 3 * year).toISOString(), to: c.dataRange.to },
          }),
        ).rejects.toMatchObject({ code: "IPB-PORT-001" });
        await expect(fetch({ fiTypes: ["EQUITIES"] })).rejects.toMatchObject({
          code: "IPB-PORT-001",
        });
      },
    },
    {
      name: "revoking one FI type narrows the consent; revoking in full stops every fetch",
      async run(p) {
        const c = await p.requestConsent(ask());
        await fx.approve(p, c.consentId);
        const part = await p.revoke(c.consentId, ["TERM_DEPOSIT"]);
        expect(part.state).toBe("ACTIVE");
        expect(part.revokedFiTypes).toEqual(["TERM_DEPOSIT"]);
        const r = await p.fetch({
          consentId: c.consentId,
          range: range(c),
          dataPrefix: fx.dataPrefix,
        });
        expect(r.payloads.map((x) => x.fiType)).toEqual(["DEPOSIT"]);
        expect((await p.revoke(c.consentId)).state).toBe("REVOKED");
        await expect(
          p.fetch({ consentId: c.consentId, range: range(c), dataPrefix: fx.dataPrefix }),
        ).rejects.toMatchObject({ code: "IPB-PORT-001" });
      },
    },
    {
      name: "a notification is read back from the AA; its own state is never trusted",
      async run(p) {
        const c = await p.requestConsent(ask());
        const n = await p.handleWebhook(
          new TextEncoder().encode(
            JSON.stringify({ kind: "consent", consentId: c.consentId, state: "ACTIVE" }),
          ),
          {},
        );
        expect(n.consent?.state).toBe("PENDING");
        await expect(p.handleWebhook(new TextEncoder().encode("{}"), {})).rejects.toMatchObject({
          code: "IPB-PORT-001",
        });
      },
    },
  ];
}
