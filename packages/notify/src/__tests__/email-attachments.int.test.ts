// Borrower email with byte-identical attachments and a delivery receipt (Udofin PR-UDF-055;
// R1-D-224; plan `docs/phases/R1-udofin-borrower-email-plan.md`; threat model §3.153), on
// PostgreSQL with every platform migration applied, through the real SES adapter on its stub: what
// the vendor decoded hashes to the stored object's SHA-256.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { BucketClass, EmailPort, NotificationAttachment } from "@infrabyx/contracts/ports";
import { SesEmail } from "@infrabyx/connectors/email";
import { SecretKey, sha256Hex, ulid } from "@infrabyx/crypto";
import { PgOutbox } from "@infrabyx/tenancy";
import {
  FakeInboundEmail,
  MemoryStorage,
  startPostgres,
  startSesStub,
  withTenant,
  type SesStub,
  type TestDatabase,
} from "@infrabyx/testing";
import { Catalogue, PLATFORM_CATALOGUE_PATH, readCatalogueFiles } from "../catalogue.js";
import { NotifyService, type NotifyServiceOptions } from "../service.js";

let db: TestDatabase;
let ses: SesStub;
let base: NotifyServiceOptions;
let svc: NotifyService;
const storage = new MemoryStorage();
// Behind the database clock: `deliver` picks rows whose `send_after <= now()`.
const now = new Date("2026-11-01T06:00:00Z"); // 11:30 IST
const settings: Record<string, Record<string, unknown>> = {};

const product = {
  catalogue: "udf-test",
  version: 1,
  classes: [
    {
      id: "loan.document_issued",
      category: "transactional",
      urgent: true,
      bypass_quiet_hours: true,
      resend: "safe",
      default_channels: ["inapp", "email"],
      help_key: "ntf.loan.document_issued",
      deep_link: "/loans/{id}",
      templates: { email: { key: "loan.document", locales: ["en"] } },
    },
    {
      id: "loan.statement_ready",
      category: "transactional",
      urgent: false,
      resend: "safe",
      default_channels: ["email"],
      help_key: "ntf.loan.statement_ready",
      deep_link: "/loans/{id}",
      templates: { email: { key: "loan.statement", locales: ["en"] } },
    },
  ],
};

const admin = (tenantId = "tnt_a"): KernelContext =>
  withTenant(tenantId, ["ORG_ADMIN"], { principal: { id: "usr_admin" } });

/** A PDF of `size` bytes, stored in `cls`; returns its reference. */
async function storedPdf(
  o: { tenant?: string; cls?: BucketClass; size?: number; type?: string } = {},
): Promise<NotificationAttachment & { bytes: Uint8Array }> {
  const key = `tenant/${o.tenant ?? "tnt_a"}/loan_docs/${ulid()}.pdf`;
  const bytes = new Uint8Array(o.size ?? 2048);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
  for (let i = 9; i < bytes.length; i++) bytes[i] = (i * 7 + 3) % 256;
  await storage.put(key, bytes, {
    bucketClass: o.cls ?? "GENERAL",
    contentType: o.type ?? "application/pdf",
  });
  return {
    storageKey: key,
    sha256: sha256Hex(bytes),
    filename: "Sanction letter.pdf",
    mediaType: "application/pdf",
    bytes,
  };
}

let seq = 0;
const send = (
  attachments: NotificationAttachment[],
  o: { cls?: string; tenant?: string; svc?: NotifyService } = {},
) =>
  (o.svc ?? svc).send(admin(o.tenant), {
    class: o.cls ?? "loan.document_issued",
    to: [{ ref: "cus:borrower1" }],
    vars: { id: "ln1" },
    deepLink: "/loans/ln1",
    idempotencyKey: `attach-${++seq}`,
    attachments: attachments.map(({ storageKey, sha256, filename, mediaType }) => ({
      storageKey,
      sha256,
      filename,
      mediaType,
    })),
  });

const emailOf = async (notificationId: string, tenant = "tnt_a") =>
  (await svc.deliveryStatus(admin(tenant), notificationId)).find((d) => d.channel === "email")!;

beforeAll(async () => {
  [db, ses] = await Promise.all([startPostgres(), startSesStub()]);
  ses.templates.add("loan.document");
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'UDF', 'A'), ('tnt_b', 'UDF', 'B'), ('tnt_platform', 'UDF', 'P') on conflict do nothing",
  );
  const email: EmailPort = new SesEmail({
    region: "ap-south-1",
    brands: { udf: { from: "noreply@udf.example.test", configurationSet: "udf-events" } },
    events: { topicArn: "arn:aws:sns:ap-south-1:111122223333:ses-events-udf" },
    endpoint: ses.url,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  base = {
    kernel: db.kernel,
    audit: db.audit,
    product: "UDF",
    outbox: new PgOutbox(),
    catalogue: new Catalogue([
      ...readCatalogueFiles([PLATFORM_CATALOGUE_PATH]),
      { file: "udf-test.yaml", doc: product },
    ]),
    contacts: {
      async resolve(r, ch) {
        return ch === "email" ? { address: `${r.ref.replace(":", ".")}@example.test` } : null;
      },
    },
    channels: { email: { port: email, brand: "udf" } },
    flags: { isOn: async () => false },
    consentKey: new SecretKey("consent:test", "hmac-sha-256", new Uint8Array(32).fill(3)),
    settings: { get: async (ctx, key) => settings[ctx.tenantId]?.[key] },
    attachments: { storage },
    now: () => now,
  };
  svc = new NotifyService(base);
});
afterAll(async () => {
  await Promise.all([db?.end(), ses?.close()]);
});
beforeEach(() => {
  settings.tnt_a = { "ntf.email.attachments.enabled": true };
  settings.tnt_b = { "ntf.email.attachments.enabled": true };
});

describe("@IPB-07-25 @IPB-01-15 PR-UDF-055 borrower email with byte-identical attachments", () => {
  it("sends the stored bytes unchanged, and the receipt carries their hashes, sizes and the message id", async () => {
    const a = await storedPdf();
    const b = await storedPdf({ size: 70_000 });
    const before = ses.messages.length;
    const r = await send([a, b]);
    const got = ses.messages.slice(before);
    expect(got).toHaveLength(1);
    // Byte-identical: the SHA-256 of what the vendor decoded equals the stored objects'.
    const storedHashes = [
      (await storage.get(a.storageKey)).meta.sha256,
      (await storage.get(b.storageKey)).meta.sha256,
    ];
    expect(got[0]!.attachments.map((x) => x.sha256)).toEqual(storedHashes);
    expect(got[0]!.attachments.map((x) => [x.fileName, x.contentType, x.bytes])).toEqual([
      ["Sanction letter.pdf", "application/pdf", 2048],
      ["Sanction letter.pdf", "application/pdf", 70_000],
    ]);
    const d = await emailOf(r.notificationId);
    expect(d).toMatchObject({
      state: "sent",
      adapter: "ses",
      vendorRef: got[0]!.messageId,
      attachments: [
        { sha256: a.sha256, bytes: 2048 },
        { sha256: b.sha256, bytes: 70_000 },
      ],
    });
    // In-app carries the deep link only, as before.
    expect(
      (await svc.deliveryStatus(admin(), r.notificationId)).find((x) => x.channel === "inapp"),
    ).not.toHaveProperty("attachments");
    // Both writes are ledgered in their transactions; nothing names the file.
    const ledger = await db.admin.query<{ action: string }>(
      "select * from audit.ledger where resource_id in ($1, $2) order by seq",
      [r.notificationId, d.deliveryId],
    );
    expect(ledger.rows.map((x) => x.action)).toEqual([
      "notify.notification.create",
      "notify.delivery.sent",
    ]);
    expect(JSON.stringify(ledger.rows)).not.toContain("Sanction");
  });

  it("is off until the tenant turns it on, and never goes with a digest class", async () => {
    const a = await storedPdf();
    settings.tnt_a = {};
    await expect(send([a])).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "attachments_off" },
    });
    settings.tnt_a = { "ntf.email.attachments.enabled": true };
    await expect(send([a], { cls: "loan.statement_ready" })).rejects.toMatchObject({
      meta: { reason: "attachments_class" },
    });
    const n = await db.admin.query(
      "select 1 from notify.notification where attachments is not null and class_id = 'loan.statement_ready'",
    );
    expect(n.rows).toHaveLength(0);
  });

  it("refuses another tenant's key before anything is written", async () => {
    const other = await storedPdf({ tenant: "tnt_b" });
    await expect(send([other])).rejects.toMatchObject({
      code: "IPB-PORT-003",
      meta: { reason: "tenant" },
    });
  });

  it.each([
    ["a CONFIDENTIAL document (the deep link carries it)", { cls: "CONFIDENTIAL" as const }],
    ["a REGULATED document", { cls: "REGULATED" as const }],
    ["a stored type that is not the declared one", { type: "text/html" }],
  ])("fails the email, sending nothing, for %s", async (_n, o) => {
    const a = await storedPdf(o);
    const before = ses.messages.length;
    const r = await send([a]);
    expect(ses.messages).toHaveLength(before);
    const d = await emailOf(r.notificationId);
    expect(d).toMatchObject({ state: "failed", lastErrorCode: "IPB-PORT-003" });
    expect(d).not.toHaveProperty("attachments");
  });

  it("fails the email when the stored bytes changed after the request (SHA-256)", async () => {
    const a = await storedPdf();
    const changed = new Uint8Array(a.bytes);
    changed[500] = changed[500]! ^ 0xff;
    await storage.put(a.storageKey, changed, {
      bucketClass: "GENERAL",
      contentType: "application/pdf",
    });
    const before = ses.messages.length;
    const r = await send([a]);
    expect(ses.messages).toHaveLength(before);
    expect(await emailOf(r.notificationId)).toMatchObject({
      state: "failed",
      lastErrorCode: "IPB-PORT-003",
    });
  });

  it("fails when bytes are not a PDF although stored as one (magic number, IPB-02-44)", async () => {
    const key = `tenant/tnt_a/loan_docs/${ulid()}.pdf`;
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    await storage.put(key, html, { bucketClass: "GENERAL", contentType: "application/pdf" });
    const before = ses.messages.length;
    const r = await send([
      {
        storageKey: key,
        sha256: sha256Hex(html),
        filename: "letter.pdf",
        mediaType: "application/pdf",
      },
    ]);
    expect(ses.messages).toHaveLength(before);
    expect((await emailOf(r.notificationId)).state).toBe("failed");
  });

  it("an adapter that cannot attach refuses unsupported, and nothing is sent", async () => {
    const fake = new FakeInboundEmail();
    const s = new NotifyService({ ...base, channels: { email: { port: fake, brand: "udf" } } });
    const a = await storedPdf();
    const r = await send([a], { svc: s });
    expect(fake.sent).toHaveLength(0);
    expect(await emailOf(r.notificationId)).toMatchObject({
      state: "failed",
      lastErrorCode: "IPB-PORT-001",
    });
  });

  it("with the CONFIDENTIAL setting on, an INTERNAL-grade adapter still refuses (IPB-01 EMAIL)", async () => {
    settings.tnt_a = {
      "ntf.email.attachments.enabled": true,
      "ntf.email.attachments.confidential": true,
    };
    const a = await storedPdf({ cls: "CONFIDENTIAL" });
    const before = ses.messages.length;
    const r = await send([a]);
    expect(ses.messages).toHaveLength(before);
    expect(await emailOf(r.notificationId)).toMatchObject({
      state: "failed",
      lastErrorCode: "IPB-PORT-003",
    });
  });

  it("over 10 MiB together is refused before the vendor", async () => {
    const a = await storedPdf({ size: 6 * 1024 * 1024 });
    const b = await storedPdf({ size: 6 * 1024 * 1024 });
    const before = ses.messages.length;
    const r = await send([a, b]);
    expect(ses.messages).toHaveLength(before);
    expect((await emailOf(r.notificationId)).state).toBe("failed");
  });
});
