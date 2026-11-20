// Staff notification checks (Udofin PR-UDF-052; R1-D-222): variables carry no personal data, the
// subject only references, and staff titles and tenant subjects only subject variables.
import { describe, expect, it } from "vitest";
import { NotificationClass } from "@infrabyx/contracts/ports";
import { syntheticAadhaar } from "@infrabyx/testing";
import {
  assertStaffVars,
  isStaffClass,
  lintStaffTitles,
  personalDataIn,
  staffSubjectVariables,
  staffVarFindings,
} from "./staff.js";
import { lintEmailTemplate, lintOptionsFor, renderEmailTemplate } from "./template-lint.js";

const cls = NotificationClass.parse({
  id: "ops.re_admin.alert",
  category: "transactional",
  audience: "staff",
  resend: "safe",
  default_channels: ["inapp", "email"],
  help_key: "hlp.notify.ops.re_admin.alert",
  deep_link: "/ops/alerts/{id}",
  variables: ["id", "count", "note"],
  subject_variables: ["id"],
  templates: {
    email: { key: "ops.re_admin.alert", locales: ["en"] },
    inapp: { title_key: "ntf.ops.re_admin.alert.title" },
  },
});
const plain = NotificationClass.parse({
  id: "export.ready",
  category: "transactional",
  resend: "safe",
  default_channels: ["inapp"],
  help_key: "hlp.notify.export.ready",
  deep_link: "/exports/{id}",
  variables: ["id", "note"],
});

describe("personal data in a value (R1-D-222)", () => {
  it("finds e-mail addresses, phone numbers, PANs and Aadhaar numbers", () => {
    expect(personalDataIn("write to asha@example.test")).toBe("email");
    expect(personalDataIn("call 98765 43210")).toBe("phone");
    expect(personalDataIn("+91-9876543210")).toBe("phone");
    expect(personalDataIn("+44 20 7946 0958")).toBe("phone");
    expect(personalDataIn("pan ABCPE1234F")).toBe("pan");
    // A synthetic Verhoeff-valid number, built at run time (never a real one).
    expect(personalDataIn(`uid ${syntheticAadhaar("23456789012")}`)).toBe("aadhaar");
  });
  it("passes references, codes and counts", () => {
    for (const v of ["app_01JD8X", "LN-2026-000123", "3 applications", "UDF/RE/42", "1500000"])
      expect(personalDataIn(v)).toBeNull();
  });
});

describe("staff variables (R1-D-222)", () => {
  it("refuses an unknown variable", () => {
    expect(staffVarFindings(cls, { id: "x1", name: "Asha" })).toEqual([
      { variable: "name", reason: "unknown_variable" },
    ]);
  });
  it("refuses personal data in any variable, never echoing it", () => {
    expect(staffVarFindings(cls, { note: "borrower asha@example.test" })).toEqual([
      { variable: "note", reason: "personal_data", kind: "email" },
    ]);
    try {
      assertStaffVars(cls, { note: "ring 9876543210" });
      expect.unreachable();
    } catch (e) {
      const err = e as { code: string; meta: Record<string, unknown>; message: string };
      expect(err.code).toBe("IPB-NTF-007");
      expect(err.meta).toMatchObject({ reason: "personal_data", variables: "note" });
      expect(err.message).not.toContain("9876543210");
    }
  });
  it("takes only references and codes in a subject variable", () => {
    expect(staffVarFindings(cls, { id: "Asha Rao" })).toEqual([
      { variable: "id", reason: "not_a_reference" },
    ]);
    expect(staffVarFindings(cls, { id: "AC12345678901" })).toEqual([
      { variable: "id", reason: "not_a_reference" },
    ]);
    expect(staffVarFindings(cls, { id: "alr_01JD8X", count: 3, note: "3 waiting" })).toEqual([]);
    expect(() => assertStaffVars(cls, { id: "alr_01JD8X", count: 3 })).not.toThrow();
  });
});

describe("staff subjects and titles (R1-D-222)", () => {
  it("marks staff classes and their subject variables", () => {
    expect(isStaffClass(cls)).toBe(true);
    expect(isStaffClass(plain)).toBe(false);
    expect(staffSubjectVariables(cls)).toEqual(["id"]);
    expect(staffSubjectVariables(plain)).toBeUndefined();
  });
  it("refuses a staff title that uses a body variable", () => {
    const messages = {
      "ntf.ops.re_admin.alert.title": { en: "Alert {id}", hi: "सूचना {note}" },
    };
    expect(lintStaffTitles([cls, plain], messages)).toEqual([
      "ops.re_admin.alert title ntf.ops.re_admin.alert.title (hi) uses {note}, which is not a subject variable",
    ]);
    expect(
      lintStaffTitles([cls], { "ntf.ops.re_admin.alert.title": { en: "Alert {id}" } }),
    ).toEqual([]);
  });
  it("refuses a tenant email subject with a body variable, at save and at delivery", () => {
    const content = { subject: "Alert {{id}}: {{note}}", text: "{{note}}" };
    const findings = lintEmailTemplate(content, cls.variables ?? [], lintOptionsFor(cls));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ field: "subject" });
    expect(findings[0]?.message).toMatch(/\{\{note\}\} is not a subject variable/);
    expect(() => renderEmailTemplate(cls, content, { id: "a1", note: "n" })).toThrow(
      /no longer passes the lint/,
    );
    const ok = renderEmailTemplate(
      cls,
      { subject: "Alert {{id}}", text: "{{note}}" },
      {
        id: "a1",
        note: "3 waiting",
      },
    );
    expect(ok.subject).toBe("Alert a1");
  });
  it("leaves other classes' subjects as they were", () => {
    const content = { subject: "Ready: {{note}}", text: "{{id}}" };
    expect(lintEmailTemplate(content, plain.variables ?? [], lintOptionsFor(plain))).toEqual([]);
  });
});
