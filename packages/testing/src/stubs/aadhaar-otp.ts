// Aadhaar OTP e-KYC behaviour shared by the Digio and IDfy stubs (PR-UDF-041), from the shapes the
// adapters document as [VERIFY]. Test numbers only (`syntheticUid`), never a real one. The stub
// keeps, per transaction, its expiry, whether it was used and the last four digits; the e-KYC it
// answers is a stand-in XML with a masked number, not a UIDAI response.
import { verhoeffValid } from "@infrabyx/contracts";
import { syntheticUid } from "@infrabyx/fakes";

export interface AadhaarOtpStubFixtures {
  uid: string;
  vid: string;
  unlinkedUid: string;
  otp: string;
  wrongOtp: string;
}

export interface AadhaarOtpStubState {
  fixtures: AadhaarOtpStubFixtures;
  /** Expire a transaction now. */
  expire(txn: string): void;
  /** The next e-KYC answered carries this full number (to show the adapter refuses to store it). */
  embedNumberOnce(n: string): void;
  request(
    idType: string,
    idNumber: string,
    consent: string,
  ): { ok: true; txn: string; validTill: string } | { ok: false; code: string };
  verify(
    txn: string,
    otp: string,
  ): { ok: true; last4: string; ekycXml: string; ref: string } | { ok: false; code: string };
}

export function aadhaarOtpStub(prefix: string, next: () => number): AadhaarOtpStubState {
  const fixtures: AadhaarOtpStubFixtures = {
    uid: syntheticUid("99990000033"),
    vid: syntheticUid("929900000000003"),
    unlinkedUid: syntheticUid("99990000044"),
    otp: "482913",
    wrongOtp: "000111",
  };
  const txns = new Map<string, { expiresAt: number; used: boolean; last4: string }>();
  let embed: string | undefined;
  const id = (p: string) => `${p}${String(next()).padStart(10, "0")}`;
  return {
    fixtures,
    expire: (txn) => {
      const t = txns.get(txn);
      if (t) t.expiresAt = 0;
    },
    embedNumberOnce: (n) => {
      embed = n;
    },
    request(idType, idNumber, consent) {
      if (consent !== "Y") return { ok: false, code: "CONSENT_REQUIRED" };
      const ok =
        idType === "aadhaar"
          ? /^[2-9][0-9]{11}$/.test(idNumber) && verhoeffValid(idNumber)
          : idType === "vid" && /^[0-9]{16}$/.test(idNumber) && verhoeffValid(idNumber);
      if (!ok) return { ok: false, code: idType === "vid" ? "INVALID_VID" : "INVALID_AADHAAR" };
      if (idNumber === fixtures.unlinkedUid) return { ok: false, code: "MOBILE_NOT_LINKED" };
      const txn = id(prefix);
      const expiresAt = Date.now() + 10 * 60_000;
      // A VID is the fixtures' resident's: the e-KYC masks that Aadhaar number.
      const last4 = (idType === "aadhaar" ? idNumber : fixtures.uid).slice(-4);
      txns.set(txn, { expiresAt, used: false, last4 });
      return { ok: true, txn, validTill: new Date(expiresAt).toISOString() };
    },
    verify(txn, otp) {
      const t = txns.get(txn);
      if (!t) return { ok: false, code: "TRANSACTION_NOT_FOUND" };
      if (t.used || t.expiresAt <= Date.now()) return { ok: false, code: "OTP_EXPIRED" };
      if (otp !== fixtures.otp) return { ok: false, code: "INVALID_OTP" };
      t.used = true;
      const uid = embed ?? `xxxxxxxx${t.last4}`;
      embed = undefined;
      const ekycXml =
        `<?xml version="1.0"?><KycRes ret="Y" txn="${txn}"><UidData uid="${uid}">` +
        `<Poi name="Asha Rao" dob="01-01-1990" gender="F"/></UidData>` +
        `<Signature>stub-signature</Signature></KycRes>`;
      return { ok: true, last4: t.last4, ekycXml, ref: id(`${prefix}R`) };
    },
  };
}
