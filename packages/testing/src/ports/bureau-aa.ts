// BUREAU and AA_FIU contract cases and in-memory fakes (IPB-01-15; Finbyx PR-FBX-28, R1-D-43).
// The first vendor adapters, `cibil` and `setu-aa` (R1-D-61), run these cases against their stubs
// until the owner's sandboxes exist; then each runs `creditBureauContractCases(itsSandboxFixtures)`
// or `accountAggregatorContractCases(…)`. The fakes let products build their loan-origination
// flows now: deterministic fixtures, files as STORAGE references, no raw PAN in any result.
// Both take the consent as a `cpr_` receipt or as a product's own artefact (`{ kind, id }`;
// PR-UDF-049, PR-UDF-050), and the AA cases check the FIU and the approval link (PR-UDF-050).
// Each fetched FI payload names an IPB-01-27 key; with `storageOf` the case reads it back from
// STORAGE: REGULATED, and bytes matching its SHA-256 (PR-UDF-065).
import { expect } from "vitest";
import { findAadhaarLike, verhoeffValid } from "@infrabyx/contracts/aadhaar";
import {
  AA_FIU_ID_REGEX,
  AA_FIU_MISMATCH,
  AaConsentRequest,
  AaFetchRequest,
  BureauPullRequest,
  isValidStorageKey,
  payloadClass,
  type AaConsent,
  type AccountAggregatorPort,
  type CreditBureauPort,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";
import { type CreditBureauFixtures, type AccountAggregatorFixtures } from "@infrabyx/fakes";
export {
  type CreditBureauFixtures,
  CREDIT_BUREAU_FAKE_FIXTURES,
  FakeCreditBureau,
  type AccountAggregatorFixtures,
  ACCOUNT_AGGREGATOR_FAKE_FIXTURES,
  FakeAccountAggregator,
  fakeFiPayload,
} from "@infrabyx/fakes";

// Word-bounded, so a PAN-shaped run inside a random ULID (e.g. a consent id) never matches.
const PAN_LIKE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;

let productRefs = 0;
/** A product's own consent artefact (PR-UDF-049): the platform checks its shape only. */
export const contractConsentArtefact = (): { kind: string; id: string } => ({
  kind: "udf.purpose_consent",
  id: `pcn-contract-${(++productRefs).toString(36)}`,
});

/** A 12-digit number that reads as an Aadhaar number, built at run time (never in the source). */
function aadhaarLikeForTest(): string {
  const head = "2" + "34567890".repeat(2).slice(0, 10);
  for (let d = 0; d < 10; d++) if (verhoeffValid(head + d)) return head + d;
  throw new Error("unreachable: one check digit always fits");
}

/** Consent artefacts every port refuses (PR-UDF-049): bad shape, reserved, or personal data. */
export function malformedConsentArtefacts(): unknown[] {
  const a = aadhaarLikeForTest();
  return [
    { kind: "udf.purpose_consent" },
    { kind: "udf.purpose_consent", id: "pcn-1", extra: true },
    { kind: "Udf.Consent", id: "pcn-1" },
    { kind: "udf..consent", id: "pcn-1" },
    { kind: "cpr", id: "pcn-1" },
    { kind: "udf.purpose_consent", id: "x" },
    { kind: "udf.purpose_consent", id: "asha@example.com" },
    { kind: "udf.purpose_consent", id: "pcn 1" },
    { kind: "udf.purpose_consent", id: "p".repeat(129) },
    { kind: "udf.purpose_consent", id: "cpr_01JA0000000000000000000000" },
    { kind: "udf.purpose_consent", id: `pcn-${a}` },
    { kind: "udf.purpose_consent", id: `pcn-${a.slice(0, 4)}-${a.slice(4, 8)}-${a.slice(8)}` },
    { kind: "udf.purpose_consent", id: "pcn-9876543210" },
    { kind: "udf.purpose_consent", id: "pcn-ABCPE1234F" },
    "pcn-1",
  ];
}

/** Every answer and refusal holds no Aadhaar-like number (letters joined, as hashes and ids are). */
function expectNoAadhaarLike(v: unknown): void {
  const text = v instanceof Error ? `${v.message} ${JSON.stringify(v)}` : JSON.stringify(v);
  expect(findAadhaarLike(text, { letters: "join" })).toEqual([]);
}

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
      name: "a pull without an artefact answers as before; a product's own artefact is kept and echoed beside `consentRef` (PR-UDF-049)",
      async run(p) {
        const plain = req(fx.known.pan, fx.known.name);
        const a = await p.pull(plain);
        expect(a.consentRef).toBe(plain.consentRef);
        expect("consentArtefact" in a).toBe(false);
        const ref = contractConsentArtefact();
        const withRef = { ...req(fx.known.pan, fx.known.name), consentArtefact: ref };
        const b = await p.pull(withRef);
        expect(b.consentRef).toBe(withRef.consentRef);
        expect(b.consentArtefact).toEqual(ref);
        const back = await p.status(b.pullId);
        expect(back.consentRef).toBe(withRef.consentRef);
        expect(back.consentArtefact).toEqual(ref);
        expect("consentArtefact" in (await p.status(a.pullId))).toBe(false);
        const none = await p.pull({ ...req(fx.noHit.pan, fx.noHit.name), consentArtefact: ref });
        expect(none).toMatchObject({ state: "no_hit", consentArtefact: ref });
        // `consentRef` stays required and a `cpr_` even when an artefact is given.
        const { consentRef: _c, ...artefactOnly } = withRef;
        await expect(p.pull(artefactOnly as never)).rejects.toThrow();
        await expect(p.pull({ ...withRef, consentRef: ref as never })).rejects.toThrow();
        for (const r of [a, b, back, none]) expectNoAadhaarLike(r);
      },
    },
    {
      name: "a malformed consent artefact is refused, with no personal data in it (PR-UDF-049)",
      async run(p) {
        for (const consentArtefact of malformedConsentArtefacts()) {
          const err = await p
            .pull({
              ...req(fx.known.pan, fx.known.name),
              consentArtefact: consentArtefact as never,
            })
            .then(
              () => undefined,
              (e: unknown) => e,
            );
          expect(err, JSON.stringify(consentArtefact)).toBeInstanceOf(Error);
          expectNoAadhaarLike(err);
        }
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

/** An approval link as every AA_FIU adapter must answer it while PENDING (PR-UDF-050). */
function expectApprovalLink(url: string | undefined): void {
  expect(url).toBeTypeOf("string");
  const u = new URL(url!);
  expect(u.protocol).toBe("https:");
  expect(u.username + u.password).toBe("");
  expect(url).not.toMatch(/(?<![0-9])[0-9]{12}(?![0-9])/);
  expect(findAadhaarLike(url!)).toEqual([]);
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
      name: "a consent asked without an artefact works as before; a product's own artefact is accepted; a malformed one is refused (PR-UDF-050)",
      async run(p) {
        const a = await p.requestConsent(ask());
        expect(a.state).toBe("PENDING");
        const b = await p.requestConsent(ask({ consentArtefact: contractConsentArtefact() }));
        expect(b.state).toBe("PENDING");
        expect((await p.consentStatus(b.consentId)).consentId).toBe(b.consentId);
        // `consentRef` stays required and a `cpr_` even when an artefact is given.
        const { consentRef: _c, ...artefactOnly } = ask({
          consentArtefact: contractConsentArtefact(),
        });
        await expect(p.requestConsent(artefactOnly as never)).rejects.toThrow();
        for (const consentArtefact of malformedConsentArtefacts()) {
          const err = await p
            .requestConsent(ask({ consentArtefact: consentArtefact as never }))
            .then(
              () => undefined,
              (e: unknown) => e,
            );
          expect(err, JSON.stringify(consentArtefact)).toBeInstanceOf(Error);
          expectNoAadhaarLike(err);
        }
        for (const c of [a, b]) expectNoAadhaarLike(c);
      },
    },
    {
      name: "the consent carries the FIU the AA reports; a request naming another FIU is refused with nothing returned (PR-UDF-050)",
      async run(p) {
        // Without `fiuId` a request works as before; the AA's FIU is reported when it gives one.
        const plain = await p.requestConsent(ask());
        if (plain.fiuId !== undefined) expect(plain.fiuId).toMatch(AA_FIU_ID_REGEX);
        if (fx.fiuId === undefined) return;
        expect(plain.fiuId).toBe(fx.fiuId);
        const ours = await p.requestConsent(ask({ fiuId: fx.fiuId }));
        expect(ours.fiuId).toBe(fx.fiuId);
        expect((await p.consentStatus(ours.consentId)).fiuId).toBe(fx.fiuId);
        const err = await p.requestConsent(ask({ fiuId: `${fx.fiuId}-other` })).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(err).toMatchObject({
          code: "IPB-PORT-001",
          meta: { reason: AA_FIU_MISMATCH, definite: true },
        });
        // Nothing of the refused consent comes back: no link, no consent.
        const text = `${(err as Error).message} ${JSON.stringify(err)}`;
        expect(text).not.toMatch(/https?:\/\//);
        expect(text).not.toContain("approvalUrl");
        expectNoAadhaarLike(err);
        await expect(p.requestConsent(ask({ fiuId: "x" }))).rejects.toThrow();
      },
    },
    {
      name: "a consent the AA reports for another FIU later is refused on every read-back and fetches nothing (PR-UDF-050)",
      async run(p) {
        if (fx.fiuId === undefined || fx.reportFiu === undefined) return;
        const c = await p.requestConsent(ask({ fiuId: fx.fiuId }));
        await fx.approve(p, c.consentId);
        await fx.reportFiu(p, c.consentId, `${fx.fiuId}-other`);
        const refused = { code: "IPB-PORT-001", meta: { reason: AA_FIU_MISMATCH } };
        await expect(p.consentStatus(c.consentId)).rejects.toMatchObject(refused);
        await expect(
          p.fetch({ consentId: c.consentId, range: range(c), dataPrefix: fx.dataPrefix }),
        ).rejects.toMatchObject(refused);
        await expect(p.revoke(c.consentId, ["TERM_DEPOSIT"])).rejects.toMatchObject(refused);
        await expect(
          p.handleWebhook(
            new TextEncoder().encode(JSON.stringify({ kind: "consent", consentId: c.consentId })),
            {},
          ),
        ).rejects.toMatchObject(refused);
        // A consent asked without a FIU is compared with nothing, as before.
        const plain = await p.requestConsent(ask());
        await fx.reportFiu(p, plain.consentId, `${fx.fiuId}-other`);
        expect((await p.consentStatus(plain.consentId)).fiuId).toBe(`${fx.fiuId}-other`);
      },
    },
    {
      name: "the approval link is on the consent only while PENDING: https, no user information, no 12-digit run (PR-UDF-050)",
      async run(p) {
        const c = await p.requestConsent(ask());
        expect(c.state).toBe("PENDING");
        expectApprovalLink(c.approvalUrl);
        const again = await p.consentStatus(c.consentId);
        expect(again.approvalUrl).toBe(c.approvalUrl);
        await fx.approve(p, c.consentId);
        const active = await p.consentStatus(c.consentId);
        expect(active.state).toBe("ACTIVE");
        expect("approvalUrl" in active).toBe(false);
        const revoked = await p.revoke(c.consentId);
        expect("approvalUrl" in revoked).toBe(false);
        const d = await p.requestConsent(ask());
        expectApprovalLink(d.approvalUrl);
        const gone = await p.revoke(d.consentId);
        expect(gone.state).toBe("REVOKED");
        expect("approvalUrl" in gone).toBe(false);
        for (const x of [c, again, active, revoked, d, gone]) expectNoAadhaarLike(x);
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
          expect(isValidStorageKey(x.storageKey), x.storageKey).toBe(true);
          expect(x.maskedAccount).not.toMatch(/^[0-9]{9,}$/);
        }
        expect(new Set(r.payloads.map((x) => x.storageKey)).size).toBe(r.payloads.length);
        if (fx.storageOf) {
          const storage = fx.storageOf(p);
          for (const x of r.payloads) {
            const obj = await storage.get(x.storageKey);
            expect(obj.meta.bucketClass).toBe("REGULATED");
            expect(sha256Hex(obj.body)).toBe(x.sha256);
          }
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
