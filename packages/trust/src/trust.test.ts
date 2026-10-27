// Unit tests: the Trust Centre rules (`@IPB-08-AT-04`, `-17`), security.txt (RFC 9116) and the
// publication digest matching OH's.
import { describe, expect, it } from "vitest";
import { FakeTrustFeed, fixtureTrustDocuments } from "@infrabyx/testing";
import {
  publicationDigest,
  securityTxt,
  trustCentre,
  type MirrorRow,
  type TrustMirror,
} from "./index.js";

const row = (o: Partial<MirrorRow> & Pick<MirrorRow, "vad_id" | "title">): MirrorRow => ({
  version: 1,
  category: "STATEMENT",
  type_key: null,
  cadence: "EVENT",
  valid_from: "2026-01-01",
  valid_until: null,
  storage_ref: "x",
  sha256: "a".repeat(64),
  visibility: "PUBLIC",
  publication_targets: ["OH"],
  nda_required: false,
  summary: "",
  supersedes_vad_id: null,
  issuer_name: null,
  oh_state: "PUBLISHED",
  mirror_state: "VISIBLE",
  digest_mismatch_at: null,
  ended_at: null,
  verified_at: new Date(),
  synced_at: new Date(),
  ...o,
});

const mirrorOf = (rows: MirrorRow[], stale = false) =>
  ({
    rows: async () => rows,
    staleness: async () => ({ asOf: "2026-10-20T00:00:00.000Z", stale, label: stale }),
  }) as unknown as TrustMirror;

describe("@IPB-08-AT-17 Trust Centre shows only held certifications", () => {
  it("lists planned items with a quarter and no badge, and never links reports or gated files", async () => {
    const tc = await trustCentre(
      mirrorOf([
        row({ vad_id: "vad_01JB00000000000000000SUBP1", title: "Sub-processor list" }),
        row({
          vad_id: "vad_01JB00000000000000000VAPT1",
          title: "VAPT report",
          category: "AUDIT_REPORT",
        }),
        row({
          vad_id: "vad_01JB00000000000000000SOC21",
          title: "SOC 2 Type II report",
          category: "AUDIT_REPORT",
          visibility: "GATED_NDA",
          nda_required: true,
        }),
      ]),
      {
        planned: [
          { name: "ISO/IEC 42001", status: "planned", targetQuarter: "2027-Q2" },
          { name: "Undated plan", status: "planned", targetQuarter: "soon" },
        ],
        now: new Date("2026-10-27T00:00:00Z"),
      },
    );
    expect(tc.certifications).toEqual([]);
    expect(tc.planned).toEqual([
      { name: "ISO/IEC 42001", status: "planned", targetQuarter: "2027-Q2", badge: false },
    ]);
    expect(tc.documents.map((d) => d.title)).toEqual(["Sub-processor list"]);
    expect(tc.gatedAvailable).toBe(1);
  });
});

describe("@IPB-08-AT-04 expired certification never shown as current", () => {
  it("shows the claim's fallback wording without a badge once valid_until passes", async () => {
    const iso = row({
      vad_id: "vad_01JB00000000000000000ISO01",
      title: "ISO/IEC 27001 certificate",
      category: "CERTIFICATE",
      type_key: "cert_iso27001",
      valid_until: "2026-10-24",
    });
    const claims = [
      {
        typeKey: "cert_iso27001",
        clmId: "clm_01JB0000000000000000000001",
        fallbackText: "ISO/IEC 27001 — recertification in progress",
      },
    ];
    const before = await trustCentre(mirrorOf([iso]), {
      claims,
      now: new Date("2026-10-24T12:00:00Z"),
    });
    expect(before.certifications).toMatchObject([
      { title: "ISO/IEC 27001 certificate", badge: true },
    ]);
    expect(before.fallbacks).toEqual([]);
    const after = await trustCentre(mirrorOf([iso]), {
      claims,
      now: new Date("2026-10-25T00:00:00Z"),
    });
    expect(after.certifications).toEqual([]);
    expect(after.fallbacks).toEqual([
      {
        clmId: "clm_01JB0000000000000000000001",
        text: "ISO/IEC 27001 — recertification in progress",
      },
    ]);
  });

  it("says 'as of' when the mirror is stale", async () => {
    expect((await trustCentre(mirrorOf([], true))).stale).toBe(true);
  });
});

describe("security.txt (RFC 9116)", () => {
  const now = new Date("2026-10-27T00:00:00Z");
  it("writes Contact, Expires within a year, Policy, languages and Canonical", () => {
    const txt = securityTxt({
      contacts: ["security@example.org"],
      canonical: "https://example.org/.well-known/security.txt",
      policy: "https://example.org/security/vdp",
      now,
    });
    expect(txt).toBe(
      [
        "Contact: mailto:security@example.org",
        "Expires: 2027-04-25T00:00:00Z",
        "Policy: https://example.org/security/vdp",
        "Preferred-Languages: en, hi",
        "Canonical: https://example.org/.well-known/security.txt",
        "",
      ].join("\n"),
    );
  });

  it("refuses an expiry beyond a year and plain-http URIs", () => {
    const base = {
      contacts: ["security@example.org"],
      canonical: "https://example.org/.well-known/security.txt",
      policy: "https://example.org/vdp",
      now,
    };
    expect(() => securityTxt({ ...base, expires: new Date("2027-11-01T00:00:00Z") })).toThrow(
      /one year/,
    );
    expect(() => securityTxt({ ...base, policy: "http://example.org/vdp" })).toThrow(/https/);
  });
});

describe("IPB-08-29 publication digest", () => {
  it("matches the digest OH computes over the same publication set", async () => {
    const feed = new FakeTrustFeed();
    const rows = fixtureTrustDocuments().map((d) =>
      row({
        vad_id: d.vad_id,
        title: d.title,
        version: d.version,
        sha256: d.sha256,
        oh_state: d.state,
      }),
    );
    expect(publicationDigest(rows)).toBe(await feed.publicationDigest());
  });
});
