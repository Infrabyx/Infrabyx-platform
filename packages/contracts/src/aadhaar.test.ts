// The shared no-Aadhaar rule (PR-UDF-042, R1-D-195). Every number here is made at run time from a
// fixed stem and its Verhoeff check digit, so nothing that reads as a real Aadhaar number is
// committed.
import { describe, expect, it } from "vitest";
import * as index from "./index.js";
import {
  AADHAAR_CARRIER_NAME_ENDINGS,
  AADHAAR_FIELD_NAMES,
  AADHAAR_LABELLED_VALUE_MAX,
  AADHAAR_LIKE_KINDS,
  AADHAAR_LOOK_ALIKES,
  findAadhaarCarrierFields,
  findAadhaarLabelledValues,
  findAadhaarLike,
  findAadhaarNamedFields,
  holdsAadhaarCarrierValue,
  holdsAadhaarFieldValue,
  holdsAadhaarLike,
  isAadhaarCarrierName,
  isAadhaarFieldName,
  isAadhaarLastFourName,
  verhoeffValid,
  type AadhaarLikeFind,
  type AadhaarLookAlike,
} from "./aadhaar.js";
import { verhoeffValid as fromSearchRefusal } from "./search-refusal.js";

/** `stem` plus its Verhoeff check digit. */
const withCheck = (stem: string): string => {
  for (let d = 0; d < 10; d++) if (verhoeffValid(`${stem}${d}`)) return `${stem}${d}`;
  throw new RangeError("no check digit");
};
/** The same number with a wrong check digit. */
const broken = (n: string): string => `${n.slice(0, -1)}${(Number(n.at(-1)) + 1) % 10}`;
const grouped = (n: string, sep: string) => n.replace(/(\d{4})(?=\d)/g, `$1${sep}`);

const UID = withCheck("23456789012");
const VID = withCheck("912345678901234");
const one = (text: string, o?: Parameters<typeof findAadhaarLike>[1]) => {
  const f = findAadhaarLike(text, o);
  expect(f).toHaveLength(1);
  return f[0]!;
};

describe("PR-UDF-042 findAadhaarLike: the shared no-Aadhaar rule", () => {
  it("verhoeffValid: digits only, the same function as before", () => {
    expect(verhoeffValid(UID)).toBe(true);
    expect(verhoeffValid(broken(UID))).toBe(false);
    expect(verhoeffValid(VID)).toBe(true);
    expect(verhoeffValid("")).toBe(false);
    expect(verhoeffValid(grouped(UID, " "))).toBe(false);
    expect(fromSearchRefusal).toBe(verhoeffValid);
    expect(index.verhoeffValid).toBe(verhoeffValid);
    expect(index.findAadhaarLike).toBe(findAadhaarLike);
    expect(AADHAAR_LIKE_KINDS).toEqual(["AADHAAR", "VID"]);
  });

  it("finds a 12-digit Aadhaar number whose first digit is 2 to 9 and whose check digit is valid", () => {
    for (let first = 2; first <= 9; first++) {
      const n = withCheck(`${first}0011223344`);
      const text = `uid: ${n}.`;
      expect(one(text)).toEqual({
        kind: "AADHAAR",
        start: 5,
        end: 17,
        masked: `XXXX XXXX ${n.slice(-4)}`,
      });
    }
  });

  it("refuses a first digit 0 or 1, and a wrong check digit", () => {
    for (const first of ["0", "1"])
      expect(findAadhaarLike(withCheck(`${first}0011223344`))).toEqual([]);
    expect(findAadhaarLike(broken(UID))).toEqual([]);
    expect(findAadhaarLike(grouped(broken(UID), " "))).toEqual([]);
    expect(holdsAadhaarLike(`a ${broken(UID)} b`)).toBe(false);
    expect(holdsAadhaarLike(`a ${UID} b`)).toBe(true);
  });

  it("finds a 16-digit VID with a valid check digit, whatever its first digit", () => {
    for (const first of ["0", "1", "9"]) {
      const v = withCheck(`${first}12345678901234`);
      expect(one(`vid ${v}`)).toMatchObject({
        kind: "VID",
        masked: `XXXX XXXX XXXX ${v.slice(-4)}`,
      });
    }
    expect(findAadhaarLike(broken(VID))).toEqual([]);
  });

  it("reads the grouped forms: spaces, hyphens, tabs, line breaks, mixed and partial gaps", () => {
    for (const sep of [" ", "-", "\t", "\u00A0", "\n"]) {
      expect(one(`no. ${grouped(UID, sep)} on file`).kind).toBe("AADHAAR");
      expect(one(`no. ${grouped(VID, sep)} on file`).kind).toBe("VID");
    }
    expect(one(`${UID.slice(0, 4)} ${UID.slice(4, 8)}-${UID.slice(8)}`).kind).toBe("AADHAAR");
    expect(one(`${UID.slice(0, 8)} ${UID.slice(8)}`).kind).toBe("AADHAAR");
    // At most one separator character in a gap.
    expect(findAadhaarLike(`${UID.slice(0, 4)}  ${UID.slice(4)}`)).toEqual([]);
    expect(findAadhaarLike(`${UID.slice(0, 4)} - ${UID.slice(4)}`)).toEqual([]);
    expect(findAadhaarLike(grouped(UID, "\r\n"))).toEqual([]);
    expect(findAadhaarLike(grouped(UID, "."))).toEqual([]);
  });

  it("is bounded by a non-digit: letters and + are boundaries; a longer digit run is never split", () => {
    for (const [before, after] of [
      ["A", "B"],
      ["id:", "x"],
      ["+", ""],
      ["_", "_"],
      ["(", ")"],
      ["", ""],
    ] as const) {
      const f = one(`${before}${UID}${after}`);
      expect(f).toMatchObject({ kind: "AADHAAR", start: before.length });
    }
    // "+91" then the twelve digits is a run of fourteen: not a find.
    expect(findAadhaarLike(`+91${UID}`)).toEqual([]);
    // Longer runs: a valid number at the head or the tail of a longer run is not found.
    expect(findAadhaarLike(`${UID}7`)).toEqual([]);
    expect(findAadhaarLike(`7${UID}`)).toEqual([]);
    expect(findAadhaarLike(`${VID}0`)).toEqual([]);
    expect(findAadhaarLike(`0${VID}`)).toEqual([]);
    expect(findAadhaarLike(`${UID}${VID}`)).toEqual([]);
    // A 16-digit run that is not a VID is not read as an Aadhaar number in its first twelve.
    const notVid = broken(withCheck(`${UID}123`));
    expect(findAadhaarLike(notVid)).toEqual([]);
  });

  it("letters: join treats an ASCII letter as part of the run (hashes, base64)", () => {
    expect(findAadhaarLike(`ab${UID}cd`, { letters: "join" })).toEqual([]);
    expect(findAadhaarLike(`h=${UID}f`, { letters: "join" })).toEqual([]);
    expect(one(`uid="${UID}"`, { letters: "join" }).kind).toBe("AADHAAR");
    expect(one(`+${UID}/`, { letters: "join" }).kind).toBe("AADHAAR");
    expect(one(` ${VID} `, { letters: "join" }).kind).toBe("VID");
    expect(one(`ab${UID}cd`).kind).toBe("AADHAAR");
  });

  it("in a grouped run, separators are boundaries: the VID reading first, then the Aadhaar one", () => {
    // A grouped VID is one VID, not an Aadhaar number and four digits.
    expect(one(grouped(VID, " ")).kind).toBe("VID");
    // Grouped 4-4-4-4 that is not a VID: its first twelve are read as an Aadhaar number.
    const notVid = grouped(broken(withCheck(`${UID}123`)), " ");
    expect(one(notVid)).toMatchObject({ kind: "AADHAAR", start: 0, end: 14 });
    // Followed by a separator and more digits, the twelve are still bounded by the separator.
    expect(one(`${grouped(UID, " ")} 7 days`).kind).toBe("AADHAAR");
  });

  it("finds several numbers in order, without overlap, and the offsets slice the number", () => {
    const u2 = withCheck("98765432101");
    const text = `a ${UID}, b ${grouped(VID, "-")}; c ${grouped(u2, " ")} and ${broken(UID)}`;
    const f = findAadhaarLike(text);
    expect(f.map((x) => x.kind)).toEqual(["AADHAAR", "VID", "AADHAAR"]);
    expect(f.map((x) => text.slice(x.start, x.end).replace(/\D/g, ""))).toEqual([UID, VID, u2]);
    for (let i = 1; i < f.length; i++) expect(f[i]!.start).toBeGreaterThanOrEqual(f[i - 1]!.end);
  });

  it("never returns more than the last four digits of a number", () => {
    const finds: AadhaarLikeFind[] = [];
    for (let i = 0; i < 300; i++) {
      const stem = String(20_000_000_000 + i * 7_919_113);
      const n = withCheck(stem);
      const v = withCheck(`${stem}${String(i).padStart(4, "0")}`);
      for (const f of findAadhaarLike(`x ${n} y ${grouped(v, " ")} z`)) {
        finds.push(f);
        expect(Object.keys(f).sort()).toEqual(["end", "kind", "masked", "start"]);
        expect(f.masked).toMatch(/^(?:XXXX ){2,3}\d{4}$/);
        expect(f.masked.slice(-4)).toBe((f.kind === "VID" ? v : n).slice(-4));
      }
    }
    expect(finds.length).toBeGreaterThanOrEqual(600);
    // No string anywhere in the result carries five digits in a row.
    expect(JSON.stringify(finds.map((f) => f.masked))).not.toMatch(/\d{5}/);
  });
});

describe("PR-UDF-063 findAadhaarLike: look-alikes stay finds unless the product allows them", () => {
  // Twelve Verhoeff digits starting 91: an Indian E.164 number when written `+91` and ten digits.
  const PHONE = withCheck("91987654321");

  it("by default (strict) a +91 phone number and a decimal are finds", () => {
    expect(AADHAAR_LOOK_ALIKES).toEqual(["e164_in", "decimal"]);
    expect(one(`call +${PHONE}`).kind).toBe("AADHAAR");
    expect(one(`0.${UID}`).kind).toBe("AADHAAR");
    expect(one(`${UID}.50`).kind).toBe("AADHAAR");
    expect(one(`${VID}.5`).kind).toBe("VID");
    expect(one(`+${PHONE}`, { allow: [] }).kind).toBe("AADHAAR");
  });

  it("e164_in lets through +91 and ten digits, and nothing else", () => {
    const allow = ["e164_in"] as const;
    expect(findAadhaarLike(`call +${PHONE} now`, { allow })).toEqual([]);
    expect(findAadhaarLike(`tel:+${PHONE}`, { allow })).toEqual([]);
    expect(findAadhaarLike(`+${PHONE}`, { allow, letters: "join" })).toEqual([]);
    // Without the +, or a number not starting 91, or grouped, or glued to a token: still a find.
    expect(one(`call ${PHONE}`, { allow }).kind).toBe("AADHAAR");
    expect(one(`+${UID}`, { allow }).kind).toBe("AADHAAR");
    expect(one(`+${grouped(PHONE, " ")}`, { allow }).kind).toBe("AADHAAR");
    expect(one(`5+${PHONE}`, { allow }).kind).toBe("AADHAAR");
    expect(one(`a+${PHONE}`, { allow }).kind).toBe("AADHAAR");
    // e164_in does not let a decimal through.
    expect(one(`0.${UID}`, { allow }).kind).toBe("AADHAAR");
  });

  it("decimal lets through digits joined to a . with a digit beyond it, and nothing else", () => {
    const allow = ["decimal"] as const;
    for (const t of [`0.${UID}`, `${UID}.5`, `x=${UID}.00;`, `${VID}.25`, `7.${VID}`])
      expect(findAadhaarLike(t, { allow })).toEqual([]);
    // A full stop ending a sentence, a dot with no digit beyond it, a grouped form: still finds.
    expect(one(`uid ${UID}.`, { allow }).kind).toBe("AADHAAR");
    expect(one(`uid ${UID}. Next`, { allow }).kind).toBe("AADHAAR");
    expect(one(`.${UID}`, { allow }).kind).toBe("AADHAAR");
    expect(one(`a.${UID}`, { allow }).kind).toBe("AADHAAR");
    expect(one(`${grouped(UID, " ")}.5`, { allow }).kind).toBe("AADHAAR");
    expect(one(`+${PHONE}`, { allow }).kind).toBe("AADHAAR");
    // Both at once.
    expect(
      findAadhaarLike(`+${PHONE} 0.${UID} and ${UID}`, { allow: ["e164_in", "decimal"] }),
    ).toHaveLength(1);
    expect(holdsAadhaarLike(`+${PHONE}`, { allow: ["e164_in"] })).toBe(false);
  });

  it("an unknown look-alike name throws (fail closed)", () => {
    const bad = ["e164"] as unknown as readonly AadhaarLookAlike[];
    expect(() => findAadhaarLike(UID, { allow: bad })).toThrow(TypeError);
  });
});

describe("PR-UDF-063 fields named like an Aadhaar carrier", () => {
  it("isAadhaarFieldName: the listed names, any case and separators, and nothing else", () => {
    for (const n of [
      "aadhaar",
      "aadhaar_number",
      "AADHAAR_NUMBER",
      "aadhaarNumber",
      "AadhaarNo",
      "aadhaar-no",
      "aadhar_number",
      "aadhaar_vid",
      "aadhaarVirtualId",
      "aadhaar_token",
      "aadhaar_card_number",
      "uid",
      "UID",
      "uid_token",
      "uidToken",
      "uid_number",
    ])
      expect(isAadhaarFieldName(n), n).toBe(true);
    for (const n of [
      "aadhaar_last_digits",
      "aadhaarLast4",
      "uid_kind",
      "uidKind",
      "user_uid",
      "uuid",
      "guid",
      "fiu_id",
      "vid",
      "aadhaar_otp",
      "aadhaar_seeded",
    ])
      expect(isAadhaarFieldName(n), n).toBe(false);
    expect(AADHAAR_FIELD_NAMES).toContain("uid_token");
    expect(AADHAAR_FIELD_NAMES).toContain("aadhaar_number");
    expect(index.isAadhaarFieldName).toBe(isAadhaarFieldName);
  });

  it("holdsAadhaarFieldValue: strings, numbers and non-empty containers hold a value", () => {
    for (const v of ["x", " 1 ", 0, 12, ["", "a"], { a: 1 }, [[0]]])
      expect(holdsAadhaarFieldValue(v), JSON.stringify(v)).toBe(true);
    for (const v of [null, undefined, "", "  ", true, false, [], {}, [null, ""], [""], { a: null }])
      expect(holdsAadhaarFieldValue(v), JSON.stringify(v)).toBe(false);
  });

  it("findAadhaarNamedFields: every named field holding a value, by path, never the value", () => {
    const doc = {
      id: "x",
      uid: "not-a-number",
      kyc: [{ aadhaarNumber: broken(UID) }, { aadhaar_number: "" }, { uid_kind: "AADHAAR" }],
      nested: { uidToken: { a: 1 }, aadhaar: null, flag: { uid: true } },
      aadhaar_last_digits: "1234",
    };
    const f = findAadhaarNamedFields(doc);
    expect(f).toEqual([
      { path: ["uid"] },
      { path: ["kyc", 0, "aadhaarNumber"] },
      { path: ["nested", "uidToken"] },
    ]);
    expect(JSON.stringify(f)).not.toContain(UID.slice(0, 8));
    expect(findAadhaarNamedFields([{ uid: 1 }])).toEqual([{ path: [0, "uid"] }]);
    expect(findAadhaarNamedFields("uid")).toEqual([]);
    expect(findAadhaarNamedFields(null)).toEqual([]);
  });
});

describe("PR-UDF-079 carrier names inside longer names, and labelled values", () => {
  // The rule's table: the name, whether it is a carrier name, and why.
  const NAMES: [name: string, carrier: boolean, why: string][] = [
    ["aadhaar_number", true, "listed (isAadhaarFieldName)"],
    ["AADHAARNO", true, "listed, any case and separators"],
    ["borrower_aadhaar_ref", true, "an aadhaar segment, anywhere"],
    ["masked_aadhaar_no", true, "an aadhaar segment, anywhere"],
    ["borrowerAadhaarRef", true, "camelCase segments"],
    ["aadhar_card_copy", true, "the aadhar spelling"],
    ["aadhaar_otp", true, "an aadhaar segment: strict"],
    ["aadhaar_seeded", true, "an aadhaar segment: strict"],
    ["kyc_aadhaar_otp_verify", true, "an aadhaar segment: strict"],
    ["aadhaar_last_digits", true, "a last-four name: judged by its value"],
    ["aadhaarLast4", true, "a last-four name: judged by its value"],
    ["uid", true, "listed"],
    ["user_uid", true, "ends with the segment uid"],
    ["userUID", true, "ends with the segment uid"],
    ["kyc_uid_token", true, "ends with uid_token"],
    ["borrower_uid_no", true, "ends with uid_no"],
    ["KycUIDNumber", true, "ends with uid number"],
    ["uidai_token", true, "uidai_token, named in the request"],
    ["kycUidaiToken", true, "ends with uidai token"],
    ["uid_kind", false, "uid not at the end: a qualifier follows"],
    ["uid_type", false, "uid not at the end"],
    ["uid_token_hash", false, "uid_token not at the end"],
    ["uid2", false, "the last segment is 2"],
    ["uidx", false, "one segment, not uid"],
    ["uuid", false, "one segment, not uid"],
    ["UUID", false, "one segment, not uid"],
    ["guid", false, "one segment, not uid"],
    ["GUIDs", false, "segments gui, ds"],
    ["fluid", false, "one segment, not uid"],
    ["fluid_level", false, "no uid segment"],
    ["uidai_txn", false, "uidai only as uidai_token"],
    ["vid", false, "not on the list (#174)"],
    ["virtual_id", false, "not on the list (#174)"],
    ["fiu_id", false, "no carrier segment"],
    ["aadhaarx", false, "one segment, not aadhaar"],
  ];

  it("isAadhaarCarrierName: the rule's table", () => {
    for (const [name, carrier, why] of NAMES)
      expect(isAadhaarCarrierName(name), `${name}: ${why}`).toBe(carrier);
    // Every listed name is a carrier name; the exact rule is unchanged.
    for (const n of AADHAAR_FIELD_NAMES) expect(isAadhaarCarrierName(n), n).toBe(true);
    expect(isAadhaarFieldName("borrower_aadhaar_ref")).toBe(false);
    expect(isAadhaarFieldName("user_uid")).toBe(false);
    expect(AADHAAR_CARRIER_NAME_ENDINGS).toEqual([
      "uid",
      "uid_no",
      "uid_num",
      "uid_number",
      "uid_token",
      "uidai_token",
    ]);
    expect(index.isAadhaarCarrierName).toBe(isAadhaarCarrierName);
    expect(index.findAadhaarLabelledValues).toBe(findAadhaarLabelledValues);
  });

  it("isAadhaarLastFourName and holdsAadhaarCarrierValue: four digits at most", () => {
    for (const n of [
      "aadhaar_last_digits",
      "aadhaarLast4",
      "aadhaar_last_4",
      "kyc_aadhaar_last_four",
      "aadhar_last_4_digits",
    ])
      expect(isAadhaarLastFourName(n), n).toBe(true);
    for (const n of ["aadhaar", "aadhaar_last", "aadhaar_last_8", "last4_aadhaar", "uid_last4"])
      expect(isAadhaarLastFourName(n), n).toBe(false);
    expect(isAadhaarLastFourName("aadhaar_aadhaar_last4")).toBe(false);
    for (const v of ["0124", "xxxx-xxxx-0124", "XXXX XXXX 0124", 124, "", null])
      expect(holdsAadhaarCarrierValue("aadhaar_last_digits", v), String(v)).toBe(false);
    for (const v of ["01245", UID, broken(UID), 12345, ["0124", "5"]])
      expect(holdsAadhaarCarrierValue("aadhaarLast4", v), String(v)).toBe(true);
    // Any other carrier name: whatever it holds (holdsAadhaarFieldValue).
    expect(holdsAadhaarCarrierValue("borrower_aadhaar_ref", "x")).toBe(true);
    expect(holdsAadhaarCarrierValue("borrower_aadhaar_ref", " ")).toBe(false);
  });

  it("findAadhaarCarrierFields: the wider names, never the value", () => {
    const doc = {
      borrower: { aadhaar_ref: "r1", aadhaarLast4: "0124", kyc_uid_token: "tok" },
      users: [{ user_uid: 7, uid_kind: "x" }],
      aadhaar_last_digits: broken(UID),
      note: "aadhaar",
    };
    const f = findAadhaarCarrierFields(doc);
    expect(f).toEqual([
      { path: ["borrower", "aadhaar_ref"] },
      { path: ["borrower", "kyc_uid_token"] },
      { path: ["users", 0, "user_uid"] },
      { path: ["aadhaar_last_digits"] },
    ]);
    expect(JSON.stringify(f)).not.toContain(UID.slice(0, 8));
    // The exact rule is unchanged.
    expect(findAadhaarNamedFields(doc)).toEqual([]);
  });

  // Free text: whether a carrier name followed by a value is a find. Numbers fail Verhoeff on
  // purpose where marked: the label is the evidence.
  const TEXTS: [text: string, find: boolean][] = [
    [`aadhaar: ${UID}`, true],
    [`aadhaar: ${broken(UID)}`, true], // fails Verhoeff
    [`Aadhaar No. XXXX XXXX ${UID.slice(-4)}`, true], // masked
    [`Aadhaar card number - ${grouped(broken(UID), "-")}`, true],
    [`"aadhaar_number": "${grouped(broken(UID), " ")}"`, true],
    [`borrower_aadhaar_ref=${UID.slice(0, 6)}`, true],
    [`aadhaar => ****${UID.slice(-4)}`, true],
    [`aadhaar -> ${UID.slice(-4)}`, true],
    [`aadhaar#${UID.slice(-4)}`, true],
    [`aadhaar-no-${UID.slice(-4)}`, true],
    [`aadhaar :\t'XXXX-XXXX-${UID.slice(-4)}'`, true],
    [`aadhaar: xxxx`, true], // fully masked: the label and the shape are enough
    [`Aadhaar ${grouped(broken(UID), " ")}`, true], // a bare space: at least 8 characters
    [`uid=XXXX XXXX ${UID.slice(-4)}`, true],
    [`user.uid = ${UID.slice(0, 8)}`, true],
    [`kyc_uidai_token: ${UID.slice(0, 4)}`, true],
    [`aadhaar_last_digits: ${UID.slice(0, 6)}`, true], // a last-four name, six digits
    [`aadhaar: ${"9".repeat(200)}`, true], // past the value cap: still a find
    // Not finds.
    [`aadhaar: ${UID.slice(0, 3)}`, false], // three characters
    ["Aadhaar 2016 rules", false], // a bare space and four characters
    ["the Aadhaar Act, 2016", false],
    ["uid=1000(app) gid=1000", false], // a Unix user id: a uid label needs 8
    [`UID no.: ${UID.slice(-4)}`, false], // a uid label needs 8
    [`aadhaar_last_digits: "xxxx-xxxx-${UID.slice(-4)}"`, false], // four digits
    [`aadhaarLast4=${UID.slice(-4)}`, false],
    ["uid=1234abcd", false], // a letter after the digits: not a value
    ["uid: 4f3a9c1e-0000-4000-8000-000000000000", false],
    [`fluid: ${UID.slice(0, 8)}`, false],
    [`uid_kind: ${UID.slice(0, 8)}`, false],
    [`vid: ${UID.slice(0, 8)}`, false],
    [`aadhaar\n${UID}`, false], // never across a line break
    [`aadhaar${UID.slice(-4)}`, false], // no separator: one token
    ["aadhaar OTP sent", false],
  ];

  it("findAadhaarLabelledValues: the rule's table", () => {
    for (const [text, find] of TEXTS)
      expect(findAadhaarLabelledValues(text).length > 0, text).toBe(find);
  });

  it("findAadhaarLabelledValues: offsets of the label and the value, in order", () => {
    const text = `x Aadhaar No. XXXX XXXX ${UID.slice(-4)}; uid=${UID}`;
    const f = findAadhaarLabelledValues(text);
    expect(f).toEqual([
      { start: 2, valueStart: 14, end: 28 },
      { start: 30, valueStart: 34, end: 46 },
    ]);
    expect(text.slice(f[0]!.valueStart, f[0]!.end)).toBe(`XXXX XXXX ${UID.slice(-4)}`);
    const long = findAadhaarLabelledValues(`aadhaar: ${"9".repeat(200)}`);
    expect(long[0]!.end - long[0]!.valueStart).toBe(AADHAAR_LABELLED_VALUE_MAX);
  });

  it("findAadhaarLabelledValues runs in linear time on hostile input", () => {
    for (const hostile of [
      "aadhaar: ".repeat(100_000),
      `${"a_".repeat(200_000)}uid`,
      "UID".repeat(200_000),
      `uid ${"1 ".repeat(40)}`.repeat(10_000),
      `aadhaar ${"no ".repeat(50_000)}`,
    ]) {
      const t0 = performance.now();
      findAadhaarLabelledValues(hostile);
      expect(performance.now() - t0, hostile.slice(0, 20)).toBeLessThan(2000);
    }
  });
});
