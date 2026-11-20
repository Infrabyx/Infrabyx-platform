// The shared no-Aadhaar rule (PR-UDF-042, R1-D-195). Every number here is made at run time from a
// fixed stem and its Verhoeff check digit, so nothing that reads as a real Aadhaar number is
// committed.
import { describe, expect, it } from "vitest";
import * as index from "./index.js";
import {
  AADHAAR_FIELD_NAMES,
  AADHAAR_LIKE_KINDS,
  AADHAAR_LOOK_ALIKES,
  findAadhaarLike,
  findAadhaarNamedFields,
  holdsAadhaarFieldValue,
  holdsAadhaarLike,
  isAadhaarFieldName,
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
