// PL3 contracts (PL3 plan §10): RULES table format, NOTIFY catalogue rules, PUSH payload guard,
// ESIGN references, export map bump rules, Ecosystem payloads, ids, errors and events.
import { describe, expect, it } from "vitest";
import { ArchiveManifestV1, ExportMap, parseMapVersion, requiredMapBump } from "./export.js";
import { NotificationCatalogue, NotificationClass, NotificationRequest } from "./ports/notify.js";
import { PushNotification } from "./ports/push.js";
import { RuleSetBody } from "./ports/rules.js";
import { DocumentRef } from "./ports/esign.js";
import { payloadClass } from "./ports/payload-class.js";
import { MarketingConsentUpdatedData, ExportCompletedData } from "./events/pl3-events.js";
import { platformEventType } from "./events/platform-events.js";
import { ERROR_CATALOGUE } from "./error-catalogue.js";
import { ID_PREFIXES, idSchema } from "./ids.js";
import { INBOX_ITEM_TYPES } from "./kernel.js";

const table = {
  format: "ipb.decision_table.v1",
  hit_policy: "first",
  inputs: [{ name: "stage", type: "string" }],
  outputs: [{ name: "next", type: "string" }],
  rows: [
    {
      id: "fbx.los.nba.sanction_ready",
      when: 'stage == "SANCTION_READY"',
      then: { next: "issue_kfs" },
    },
  ],
};

const klass = {
  id: "approval.requested",
  category: "maker_checker",
  mandatory: true,
  urgent: true,
  bypass_quiet_hours: true,
  resend: "safe",
  default_channels: ["inapp", "email"],
  help_key: "ntf.approval.requested",
  deep_link: "/approvals/{id}",
};

describe("RULES decision table", () => {
  it("accepts the platform table and defaults row fields", () => {
    const b = RuleSetBody.parse(table);
    expect(b.rows[0]?.verify).toBe(false);
    expect(b.outputs[0]?.statutory).toBe(false);
  });
  it("refuses duplicate row ids and outputs that are not declared", () => {
    const dup = { ...table, rows: [table.rows[0], table.rows[0]] };
    expect(RuleSetBody.safeParse(dup).success).toBe(false);
    const bad = { ...table, rows: [{ ...table.rows[0], then: { approve: true } }] };
    expect(RuleSetBody.safeParse(bad).success).toBe(false);
  });
});

describe("NOTIFY catalogue (IPB-07-25)", () => {
  it("requires a resend class, a help key and a deep link", () => {
    expect(NotificationClass.safeParse(klass).success).toBe(true);
    for (const k of ["resend", "help_key", "deep_link"] as const) {
      const c: Record<string, unknown> = { ...klass };
      delete c[k];
      expect(NotificationClass.safeParse(c).success).toBe(false);
    }
  });
  it("keeps marketing classes optional, consented and on their purpose's channel", () => {
    const m = {
      ...klass,
      id: "mkt.newsletter",
      category: "marketing",
      mandatory: false,
      resend: "hold",
      default_channels: ["email"],
      marketing_purpose: "MARKETING_EMAIL",
    };
    expect(NotificationClass.safeParse(m).success).toBe(true);
    expect(NotificationClass.safeParse({ ...m, mandatory: true }).success).toBe(false);
    expect(NotificationClass.safeParse({ ...m, marketing_purpose: undefined }).success).toBe(false);
    expect(NotificationClass.safeParse({ ...m, default_channels: ["push"] }).success).toBe(false);
  });
  it("refuses a default channel that is also a never channel", () => {
    const c = { ...klass, never_channels: ["email"] };
    expect(NotificationClass.safeParse(c).success).toBe(false);
  });
  it("parses a catalogue file and a request with principal references only", () => {
    expect(
      NotificationCatalogue.parse({ catalogue: "platform", version: 1, classes: [klass] }).classes,
    ).toHaveLength(1);
    const r = {
      class: "approval.requested",
      to: [{ ref: "usr_1" }],
      vars: {},
      deepLink: "/approvals/apr_1",
      idempotencyKey: "apr_1:requested",
    };
    expect(NotificationRequest.safeParse(r).success).toBe(true);
    expect(
      NotificationRequest.safeParse({ ...r, to: [{ ref: "usr_1", email: "a@example.org" }] })
        .success,
    ).toBe(false);
  });
});

describe("PUSH payload guard (IPB-01 PUSH)", () => {
  it("allows only a title, a deep link and a small INTERNAL data map", () => {
    expect(
      PushNotification.safeParse({ title: "New approval", deepLink: "/approvals/apr_1" }).success,
    ).toBe(true);
    expect(
      PushNotification.safeParse({ title: "x", deepLink: "/a", body: "PAN ABCDE1234F" }).success,
    ).toBe(false);
    const big = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, "v"]));
    expect(PushNotification.safeParse({ title: "x", deepLink: "/a", data: big }).success).toBe(
      false,
    );
    expect(payloadClass(PushNotification).bodyHighest).toBe("INTERNAL");
    expect(payloadClass(PushNotification).complete).toBe(true);
  });
});

describe("ESIGN", () => {
  it("passes documents by reference with a SHA-256", () => {
    expect(
      DocumentRef.safeParse({ documentId: "doc_1", sha256: "a".repeat(64), storageKey: "tenant/x" })
        .success,
    ).toBe(true);
    expect(
      DocumentRef.safeParse({
        documentId: "doc_1",
        sha256: "a".repeat(64),
        storageKey: "k",
        pdf: "JVBERi0",
      }).success,
    ).toBe(false);
  });
});

describe("export map (IPB-09 §09.4.7.1)", () => {
  const base = ExportMap.parse({
    map_version: "REF-EXPORT-1.0",
    entities: {
      tenant: { source: "tenancy.tenant", id: "id", fields: ["id", "name"], views: ["path"] },
    },
    manifest: "manifest.json",
  });
  const withEntity = (e: object) =>
    ExportMap.parse({ ...base, entities: { tenant: { ...base.entities.tenant, ...e } } });
  it("parses map versions", () => {
    expect(parseMapVersion("REF-EXPORT-1.0")).toEqual({ product: "REF", major: 1, minor: 0 });
    expect(parseMapVersion("ref-export-1")).toBeNull();
  });
  it("bumps minor for an addition, major for a removal, and never for views", () => {
    expect(requiredMapBump(base, withEntity({ views: ["path", "tags"] }))).toBe("none");
    expect(requiredMapBump(base, withEntity({ fields: ["id", "name", "status"] }))).toBe("minor");
    expect(requiredMapBump(base, withEntity({ fields: ["id"] }))).toBe("major");
    expect(requiredMapBump(base, withEntity({ fields: ["id", "label"] }))).toBe("major");
    expect(requiredMapBump(base, ExportMap.parse({ ...base, entities: {} }))).toBe("major");
  });
  it("requires a signed manifest with per-file hashes", () => {
    const m = {
      archive_standard_version: "1.0",
      archive_id: "arc_01J9ZC9Q2K7M8N3P4R5S6T7V8W",
      folder_profile: "standard",
      map_version: "REF-EXPORT-1.0",
      producer: { product: "REF", release: "0.1.0" },
      tenant_id: "tnt_demo",
      scope: { type: "FULL_TENANT", ref: null },
      requester: "sha256:" + "0".repeat(64),
      approvers: [],
      as_of: "2026-10-27T00:00:00+05:30",
      control_totals: { tenant: 1 },
      predecessor_archive_id: null,
      files: [{ path: "00 Start Here/README.txt", bytes: 10, sha256: "b".repeat(64) }],
      pack_sha256: "c".repeat(64),
      signature: { file: "manifest.json.jws", alg: "ES256", kid: "alias/export-signing" },
    };
    expect(ArchiveManifestV1.safeParse(m).success).toBe(true);
    expect(ArchiveManifestV1.safeParse({ ...m, signature: undefined }).success).toBe(false);
  });
});

describe("Ecosystem payloads", () => {
  it("MarketingConsentUpdated carries a hash and no contact in clear", () => {
    const d = {
      consent_id: "cns_1",
      principal_hash: "d".repeat(64),
      purpose: "MARKETING_SMS",
      state: "WITHDRAWN",
      channel: "SMS_STOP",
      brand_pack_id: "brd_1",
      notice_version: "1",
      occurred_at: "2026-10-27T00:00:00Z",
    };
    expect(MarketingConsentUpdatedData.safeParse(d).success).toBe(true);
    expect(MarketingConsentUpdatedData.safeParse({ ...d, phone: "+919812345678" }).success).toBe(
      false,
    );
  });
  it("ExportCompleted describes the archive, not its content", () => {
    expect(
      ExportCompletedData.safeParse({
        archive_id: "arc_1",
        archive_standard_version: "1.0",
        folder_profile: "standard",
        file_count: 3,
        bytes: 100,
        manifest_hash: "e".repeat(64),
        destination_type: "DOWNLOAD",
        predecessor_archive_id: null,
      }).success,
    ).toBe(true);
  });
});

describe("ids, errors and events added in PL3", () => {
  it("registers the PL3 id prefixes", () => {
    for (const p of ["rls", "dcs", "sca", "ibx", "ntf", "dlv", "sup", "exj", "arc", "esr"])
      expect(ID_PREFIXES).toHaveProperty(p);
    expect(idSchema("ibx").safeParse("ibx_01J9ZC9Q2K7M8N3P4R5S6T7V8W").success).toBe(true);
  });
  it("registers IPB-NTF-002 to -006 and IPB-UX-012", () => {
    for (const c of [
      "IPB-NTF-002",
      "IPB-NTF-003",
      "IPB-NTF-004",
      "IPB-NTF-005",
      "IPB-NTF-006",
      "IPB-UX-012",
    ])
      expect(ERROR_CATALOGUE).toHaveProperty(c);
  });
  it("names the new events", () => {
    expect(platformEventType("fbx", "ApprovalExpired")).toBe("in.fbx.security.ApprovalExpired.v1");
    expect(platformEventType("fbx", "ItemCreated")).toBe("in.fbx.inbox.ItemCreated.v1");
    expect(platformEventType("ref", "RuleSetPublished")).toBe("in.ref.rules.RuleSetPublished.v1");
    expect(INBOX_ITEM_TYPES).toContain("approval");
  });
});
