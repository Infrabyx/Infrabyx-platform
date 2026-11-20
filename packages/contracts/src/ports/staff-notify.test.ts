// Staff classes and the staff notification request (Udofin PR-UDF-052; R1-D-222; IPB-07-25,
// IPB-02-10).
import { describe, expect, it } from "vitest";
import { ERROR_CATALOGUE } from "../error-catalogue.js";
import {
  NotificationClass,
  STAFF_CHANNELS,
  StaffNotificationRequest,
  StaffRole,
} from "./notify.js";

const staff = {
  id: "ops.re_admin.alert",
  category: "transactional",
  audience: "staff",
  resend: "safe",
  default_channels: ["inapp", "email"],
  help_key: "hlp.notify.ops.re_admin.alert",
  deep_link: "/ops/alerts/{id}",
  variables: ["id", "count", "product"],
  subject_variables: ["id"],
  templates: {
    email: { key: "ops.re_admin.alert", locales: ["en"] },
    inapp: { title_key: "ntf.ops.re_admin.alert.title" },
  },
};
const issues = (c: unknown) => {
  const r = NotificationClass.safeParse(c);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("staff classes (IPB-07-25; R1-D-222)", () => {
  it("accepts a staff class on in-app and email with declared variables", () => {
    expect(issues(staff)).toEqual([]);
    expect(STAFF_CHANNELS).toEqual(["inapp", "email"]);
  });
  it("refuses SMS, WhatsApp and push on a staff class", () => {
    for (const ch of ["sms", "whatsapp", "push"])
      expect(issues({ ...staff, default_channels: ["inapp", ch] }).join()).toMatch(
        new RegExp(`not ${ch}`),
      );
  });
  it("refuses a staff class without variables, as marketing, or with a stray subject variable", () => {
    const { variables: _v, subject_variables: _s, ...bare } = staff;
    expect(issues(bare).join()).toMatch(/declares its variables/);
    expect(
      issues({
        ...staff,
        category: "marketing",
        marketing_purpose: "MARKETING_EMAIL",
        default_channels: ["email"],
      }).join(),
    ).toMatch(/never a marketing class/);
    expect(issues({ ...staff, subject_variables: ["name"] }).join()).toMatch(
      /subject variable name is not in variables/,
    );
  });
  it("keeps subject_variables to staff classes", () => {
    const { audience: _a, ...plain } = staff;
    expect(issues(plain).join()).toMatch(/belongs to a staff class/);
  });
  it("registers IPB-NTF-007", () => {
    expect(ERROR_CATALOGUE["IPB-NTF-007"].status).toBe(422);
  });
});

describe("staff notification request (IPB-02-10; R1-D-222)", () => {
  const req = {
    class: "ops.re_admin.alert",
    roles: ["ORG_ADMIN"],
    vars: { id: "alr_1" },
    deepLink: "/ops/alerts/alr_1",
    idempotencyKey: "ops.alert:alr_1",
  };
  it("takes tenant, operations, product and function roles", () => {
    for (const r of ["ORG_ADMIN", "OPS_SUPPORT", "UDF_CREDIT_HEAD", "FN:CCO"])
      expect(StaffRole.safeParse(r).success).toBe(true);
    expect(StaffNotificationRequest.safeParse(req).success).toBe(true);
  });
  it("refuses platform, service and agent roles and malformed ones", () => {
    for (const r of ["PLT_SUPPORT", "PLT_SUPER_ADMIN", "SVC_NOTIFY", "AGT_VIDHI", "admins", ""])
      expect(StaffRole.safeParse(r).success).toBe(false);
  });
  it("needs one to ten roles and refuses a tenant or address field", () => {
    expect(StaffNotificationRequest.safeParse({ ...req, roles: [] }).success).toBe(false);
    expect(
      StaffNotificationRequest.safeParse({ ...req, roles: Array(11).fill("ORG_ADMIN") }).success,
    ).toBe(false);
    expect(StaffNotificationRequest.safeParse({ ...req, tenant: "tnt_b" }).success).toBe(false);
    expect(StaffNotificationRequest.safeParse({ ...req, to: [{ ref: "usr_x" }] }).success).toBe(
      false,
    );
  });
});
