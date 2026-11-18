// Inbound email replies on PostgreSQL with every platform migration applied (PR-LDC-50; R1-D-177;
// plan `docs/phases/R1-inbound-mail-plan.md` §7; threat model §3.123).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { EmailMessage, EmailPort, InboundEmail } from "@infrabyx/contracts/ports";
import { SecretKey, sha256Hex } from "@infrabyx/crypto";
import { PgOutbox } from "@infrabyx/tenancy";
import {
  EICAR,
  FakeFileScan,
  MemoryStorage,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import { Catalogue, PLATFORM_CATALOGUE_PATH, readCatalogueFiles } from "../catalogue.js";
import { NotifyService } from "../service.js";

let db: TestDatabase;
let svc: NotifyService;
const sent: EmailMessage[] = [];
const drops: string[] = [];
// Behind the database clock: `deliver` picks rows whose `send_after <= now()`.
let now = new Date("2026-11-01T06:00:00Z");
const storage = new MemoryStorage();
const av = new FakeFileScan(storage);
const settings: Record<string, Record<string, unknown>> = {
  tnt_a: { "ntf.reply.enabled": true, "ntf.reply.domain": "reply.a.example" },
  tnt_b: { "ntf.reply.enabled": true, "ntf.reply.domain": "reply.b.example" },
};

const email: EmailPort = {
  descriptor: { port: "EMAIL", adapter: "fake-email", residency: "IN", maxDataClass: "INTERNAL" },
  health: async () => ({ status: "up", latency_ms: 0, checked_at: new Date().toISOString() }),
  async send(m: EmailMessage) {
    sent.push(m);
    return { messageId: `msg-${sent.length}` };
  },
  sendRaw: async () => ({ messageId: "raw" }),
  getStatus: async () => ({ status: "sent" }),
  verifyWebhook: async () => [],
  verifyDomain: async () => ({ verified: true, dnsRecords: [] }),
  suppress: async () => undefined,
};
const contacts: Record<string, string> = {
  usr_u: "Asha.Rao@Client.Example",
  usr_v: "vik@other.example",
};
const admin = (tenantId = "tnt_a"): KernelContext =>
  withTenant(tenantId, ["ORG_ADMIN"], { principal: { id: "usr_admin" } });

let seq = 0;
/** Send an approval request (inapp + email, sent at once) that asks for replies. */
async function invite(
  o: { tenant?: string; to?: string; thread?: string | null } = {},
): Promise<string> {
  const before = sent.length;
  await svc.send(admin(o.tenant), {
    class: "approval.requested",
    to: [{ ref: o.to ?? "usr_u" }],
    vars: { id: "x1" },
    deepLink: "/x/x1",
    idempotencyKey: `reply-invite-${++seq}`,
    ...(o.thread === null ? {} : { reply: { threadRef: o.thread ?? "mtr_42" } }),
  });
  const m = sent.slice(before).at(-1);
  return m?.replyTo ?? "";
}

const mime = (
  o: { from?: string; body?: string; headers?: string; ct?: string; raw?: string } = {},
) =>
  new TextEncoder().encode(
    o.raw ??
      [
        `From: Asha <${o.from ?? "asha.rao@client.example"}>`,
        "To: Infrabyx <reply@x.example>",
        "Subject: Re: Approval requested",
        ...(o.headers ? [o.headers] : []),
        `Content-Type: ${o.ct ?? "text/plain; charset=utf-8"}`,
        "",
        o.body ??
          "Approved, go ahead.\r\n\r\nOn Wed, 18 Nov 2026 at 11:30, Infrabyx <noreply@x.example> wrote:\r\n> Please approve",
      ].join("\r\n"),
  );

let vid = 0;
const inbound = (to: string, over: Partial<InboundEmail> = {}): InboundEmail => ({
  adapter: "ses",
  vendorMessageId: `vm-${++vid}`,
  receivedAt: now.toISOString(),
  envelopeFrom: "asha.rao@client.example",
  recipients: [to],
  auth: { spf: "pass", dkimAligned: "pass", dmarc: "pass" },
  raw: mime(),
  ...over,
});

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LD', 'A'), ('tnt_b', 'LD', 'B'), ('tnt_platform', 'LD', 'P') on conflict do nothing",
  );
  svc = new NotifyService({
    kernel: db.kernel,
    audit: db.audit,
    product: "LD",
    outbox: new PgOutbox(),
    catalogue: new Catalogue(readCatalogueFiles([PLATFORM_CATALOGUE_PATH])),
    contacts: {
      async resolve(r, ch) {
        const address = ch === "email" ? contacts[r.ref] : undefined;
        return address ? { address } : null;
      },
    },
    channels: { email: { port: email, brand: "ld" } },
    flags: { isOn: async () => false },
    consentKey: new SecretKey("consent:test", "hmac-sha-256", new Uint8Array(32).fill(3)),
    settings: { get: async (ctx, key) => settings[ctx.tenantId]?.[key] },
    replies: { storage, av, onDrop: (r) => void drops.push(r) },
    now: () => now,
  });
});
afterAll(async () => {
  await db?.end();
});
beforeEach(() => {
  now = new Date("2026-11-01T06:00:00Z");
  settings.tnt_a = { "ntf.reply.enabled": true, "ntf.reply.domain": "reply.a.example" };
});

describe("@IPB-01-15 reply addresses are minted at email delivery (PR-LDC-50)", () => {
  it("binds a stored-hash token to the thread, recipient and address hash, for 30 days", async () => {
    const to = await invite();
    const m = /^reply\+([a-z2-7]{32})@reply\.a\.example$/.exec(to);
    expect(m).not.toBeNull();
    const token = m![1]!;
    const row = (
      await db.admin.query<Record<string, unknown>>(
        "select * from notify.reply_token where token_hash = $1",
        [sha256Hex(token)],
      )
    ).rows[0]!;
    expect(row).toMatchObject({
      tenant_id: "tnt_a",
      thread_ref: "mtr_42",
      recipient_ref: "usr_u",
      uses: 0,
      max_uses: 50,
    });
    expect((row.expires_at as Date).toISOString()).toBe("2026-12-01T06:00:00.000Z");
    expect(row.address_hash).toMatch(/^[0-9a-f]{64}$/);
    // The token itself is stored nowhere and ledgered nowhere.
    const everything = JSON.stringify([
      (await db.admin.query("select * from notify.reply_token")).rows,
      (await db.admin.query("select * from audit.ledger")).rows,
      (await db.admin.query("select * from notify.notification")).rows,
    ]);
    expect(everything).not.toContain(token);
    expect(everything).not.toContain("asha.rao@client.example");
    const led = await db.admin.query(
      "select 1 from audit.ledger where action = 'notify.reply_token.create' and tenant_id = 'tnt_a'",
    );
    expect(led.rowCount).toBeGreaterThan(0);
  });

  it("sets no reply address when replies are off, the domain is unset or bad, or none is asked", async () => {
    expect(await invite({ thread: null })).toBe("");
    settings.tnt_a!["ntf.reply.enabled"] = false;
    expect(await invite()).toBe("");
    settings.tnt_a = { "ntf.reply.enabled": true, "ntf.reply.domain": "" };
    expect(await invite()).toBe("");
    settings.tnt_a = { "ntf.reply.enabled": true, "ntf.reply.domain": "not a domain" };
    expect(await invite()).toBe("");
    settings.tnt_a!["ntf.reply.domain"] = "Reply.A.Example";
    expect(await invite()).toMatch(/@reply\.a\.example$/);
  });

  it("a token past its days is refused; token_days is clamped to 1..90", async () => {
    settings.tnt_a!["ntf.reply.token_days"] = 500;
    const to = await invite();
    const t = sha256Hex(/reply\+([a-z2-7]{32})@/.exec(to)![1]!);
    const r = await db.admin.query<{ expires_at: Date }>(
      "select expires_at from notify.reply_token where token_hash = $1",
      [t],
    );
    expect(r.rows[0]!.expires_at.toISOString()).toBe("2027-01-30T06:00:00.000Z");
  });
});

describe("@IPB-01-15 an accepted reply (PR-LDC-50)", () => {
  it("is stored once with its quoted history removed, ledgered and announced without its text", async () => {
    const to = await invite();
    const m = inbound(to);
    const r = await svc.receiveReplies([m]);
    expect(r).toMatchObject({ duplicate: 0, dropped: {} });
    expect(r.accepted).toHaveLength(1);
    const reply = await svc.getReply(admin(), r.accepted[0]!);
    expect(reply).toMatchObject({
      threadRef: "mtr_42",
      recipientRef: "usr_u",
      text: "Approved, go ahead.",
      attachments: [],
    });
    const ev = await db.admin.query<{ envelope: Record<string, unknown> }>(
      "select envelope from notify.outbox where type like '%NotificationReplyReceived%' and tenant_id = 'tnt_a'",
    );
    expect(ev.rowCount).toBe(1);
    expect(JSON.stringify(ev.rows[0]!.envelope)).not.toContain("Approved");
    const led = await db.admin.query<{ after: unknown }>(
      "select 1 from audit.ledger where action = 'notify.reply.accept' and resource_id = $1",
      [r.accepted[0]],
    );
    expect(led.rowCount).toBe(1);
    // A redelivery (SNS is at least once) consumes nothing.
    const again = await svc.receiveReplies([m]);
    expect(again).toEqual({ accepted: [], duplicate: 1, dropped: {} });
    const t = sha256Hex(/reply\+([a-z2-7]{32})@/.exec(to)![1]!);
    const u = await db.admin.query<{ uses: number }>(
      "select uses from notify.reply_token where token_hash = $1",
      [t],
    );
    expect(u.rows[0]!.uses).toBe(1);
    // Another tenant never sees it (RLS); nobody may change it.
    expect(await svc.getReply(admin("tnt_b"), r.accepted[0]!)).toBeNull();
    await expect(
      db.admin.query("update notify.reply set text = 'changed' where id = $1", [r.accepted[0]]),
    ).rejects.toThrow(/immutable/);
  });

  it("accepts an HTML-only reply as text, and a sender domain without DMARC policy when DKIM and SPF align", async () => {
    const to = await invite();
    const r = await svc.receiveReplies([
      inbound(to, {
        auth: { spf: "pass", dkimAligned: "pass", dmarc: "none" },
        raw: mime({
          ct: "text/html; charset=utf-8",
          body: '<div>Noted &amp; agreed.</div><div class="gmail_quote">On Wed X wrote:<blockquote>old</blockquote></div>',
        }),
      }),
    ]);
    expect(r.accepted).toHaveLength(1);
    expect((await svc.getReply(admin(), r.accepted[0]!))?.text).toBe("Noted & agreed.");
  });

  it("quarantines attachments: a clean file is released, EICAR is rejected", async () => {
    const to = await invite();
    const b64 = (s: Uint8Array | string) => Buffer.from(s).toString("base64");
    const body = [
      "--b",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Signed copy attached.",
      "--b",
      'Content-Type: application/pdf; name="signed.pdf"',
      'Content-Disposition: attachment; filename="signed.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      b64("%PDF-1.7 clean"),
      "--b",
      'Content-Type: application/octet-stream; name="x.com"',
      'Content-Disposition: attachment; filename="x.com"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(EICAR),
      "--b--",
      "",
    ].join("\r\n");
    const r = await svc.receiveReplies([
      inbound(to, { raw: mime({ ct: "multipart/mixed; boundary=b", body }) }),
    ]);
    expect(r.accepted).toHaveLength(1);
    const reply = await svc.getReply(admin(), r.accepted[0]!);
    expect(reply?.text).toBe("Signed copy attached.");
    expect(reply?.attachments.map((a) => [a.filename, a.state])).toEqual([
      ["signed.pdf", "RELEASED"],
      ["x.com", "REJECTED"],
    ]);
    for (const a of reply!.attachments) {
      expect(a.storageKey).toMatch(/^tenant\/tnt_a\/notify\/[0-9A-HJKMNP-TV-Z]{26}\.bin$/);
      expect(sha256Hex((await storage.get(a.storageKey)).body)).toBe(a.sha256);
    }
  });
});

describe("@IPB-01-15 everything else is dropped and counted, never stored (PR-LDC-50)", () => {
  const dropped = async (m: InboundEmail) => {
    const before = (await db.admin.query("select count(*)::int as n from notify.reply")).rows[0];
    const r = await svc.receiveReplies([m]);
    const after = (await db.admin.query("select count(*)::int as n from notify.reply")).rows[0];
    expect(after).toEqual(before);
    expect(r.accepted).toEqual([]);
    return Object.keys(r.dropped);
  };

  it("token: none, two, unknown, wrong domain, replies off, expired, used up", async () => {
    const to = await invite();
    expect(await dropped(inbound("someone@reply.a.example"))).toEqual(["no_token"]);
    const other = await invite();
    expect(await dropped(inbound(to, { recipients: [to, other] }))).toEqual(["ambiguous"]);
    expect(await dropped(inbound(`reply+${"a".repeat(32)}@reply.a.example`))).toEqual([
      "unknown_token",
    ]);
    expect(await dropped(inbound(to.replace("reply.a.example", "reply.b.example")))).toEqual([
      "domain",
    ]);
    settings.tnt_a!["ntf.reply.enabled"] = false;
    expect(await dropped(inbound(to))).toEqual(["off"]);
    settings.tnt_a!["ntf.reply.enabled"] = true;
    now = new Date("2026-12-02T06:00:00Z");
    expect(await dropped(inbound(to))).toEqual(["expired"]);
    now = new Date("2026-11-01T06:00:00Z");
    await db.admin.query("update notify.reply_token set uses = max_uses where token_hash = $1", [
      sha256Hex(/reply\+([a-z2-7]{32})@/.exec(to)![1]!),
    ]);
    expect(await dropped(inbound(to))).toEqual(["used_up"]);
  });

  it("sender: another address, a second From, a forwarded reply", async () => {
    const to = await invite();
    expect(await dropped(inbound(to, { raw: mime({ from: "vik@other.example" }) }))).toEqual([
      "sender",
    ]);
    expect(
      await dropped(
        inbound(to, {
          raw: mime({
            raw: "From: asha.rao@client.example, vik@other.example\r\nSubject: s\r\n\r\nhi",
          }),
        }),
      ),
    ).toEqual(["sender"]);
  });

  it("authentication: the adapter's verdict decides; a forged Authentication-Results header changes nothing", async () => {
    const to = await invite();
    const forged = mime({
      headers: "Authentication-Results: mx.client.example; dmarc=pass; dkim=pass; spf=pass",
    });
    expect(
      await dropped(
        inbound(to, { raw: forged, auth: { spf: "pass", dkimAligned: "pass", dmarc: "fail" } }),
      ),
    ).toEqual(["auth"]);
    expect(
      await dropped(inbound(to, { auth: { spf: "pass", dkimAligned: "pass", dmarc: "error" } })),
    ).toEqual(["auth"]);
    expect(
      await dropped(
        inbound(to, {
          envelopeFrom: "bounce@mailer.client.example",
          auth: { spf: "pass", dkimAligned: "pass", dmarc: "none" },
        }),
      ),
    ).toEqual(["auth"]);
  });

  it("shape: size, line, charset, parts, depth, headers, too many attachments, empty", async () => {
    const to = await invite();
    const raw = (s: string) => new TextEncoder().encode(s);
    const H = "From: asha.rao@client.example\r\nSubject: s\r\n";
    expect(await dropped(inbound(to, { raw: new Uint8Array(10 * 1024 * 1024 + 1) }))).toEqual([
      "too_large",
    ]);
    expect(await dropped(inbound(to, { raw: raw(`${H}\r\n${"x".repeat(1200)}`) }))).toEqual([
      "line_length",
    ]);
    expect(await dropped(inbound(to, { raw: mime({ ct: "text/plain; charset=utf-7" }) }))).toEqual([
      "charset",
    ]);
    const parts = Array.from(
      { length: 250 },
      () => "--b\r\nContent-Type: text/plain\r\n\r\nx",
    ).join("\r\n");
    expect(
      await dropped(
        inbound(to, {
          raw: mime({ ct: "multipart/mixed; boundary=b", body: `${parts}\r\n--b--` }),
        }),
      ),
    ).toEqual(["parts"]);
    let deep = "x";
    for (let i = 12; i >= 1; i--)
      deep = `--d${i}\r\nContent-Type: multipart/mixed; boundary=d${i + 1}\r\n\r\n${deep}\r\n--d${i}--`;
    expect(
      await dropped(inbound(to, { raw: mime({ ct: "multipart/mixed; boundary=d1", body: deep }) })),
    ).toEqual(["depth"]);
    const flood = Array.from({ length: 1200 }, (_, i) => `X-F${i}: ${"v".repeat(60)}`).join("\r\n");
    expect(await dropped(inbound(to, { raw: mime({ headers: flood }) }))).toEqual(["headers"]);
    const atts = Array.from(
      { length: 21 },
      (_, i) =>
        `--b\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="f${i}.bin"\r\n\r\nx`,
    ).join("\r\n");
    expect(
      await dropped(
        inbound(to, { raw: mime({ ct: "multipart/mixed; boundary=b", body: `${atts}\r\n--b--` }) }),
      ),
    ).toEqual(["attachments"]);
    expect(
      await dropped(inbound(to, { raw: mime({ body: "On Wed X wrote:\r\n> only the quote" }) })),
    ).toEqual(["empty"]);
  });

  it("a drop is recorded and ledgered once a day per sender and reason, and counted every time", async () => {
    const to = await invite();
    const m = () => inbound(to, { auth: { spf: "fail", dkimAligned: "fail", dmarc: "fail" } });
    now = new Date("2026-11-10T06:00:00Z");
    await svc.receiveReplies([m(), m(), m()]);
    const c = await db.admin.query(
      "select 1 from notify.reply_drop_daily where tenant_id = 'tnt_a' and day = '2026-11-10' and reason = 'auth'",
    );
    expect(c.rowCount).toBe(1);
    const led = await db.admin.query(
      "select 1 from audit.ledger where action = 'notify.reply.drop' and resource_id = '2026-11-10:auth'",
    );
    expect(led.rowCount).toBe(1);
    expect(drops.filter((d) => d === "auth").length).toBeGreaterThanOrEqual(3);
    // No body is ever written anywhere.
    const all = JSON.stringify((await db.admin.query("select * from audit.ledger")).rows);
    expect(all).not.toContain("only the quote");
  });

  it("the use limit holds under concurrent replies", async () => {
    const to = await invite();
    await db.admin.query(
      "update notify.reply_token set uses = max_uses - 1 where token_hash = $1",
      [sha256Hex(/reply\+([a-z2-7]{32})@/.exec(to)![1]!)],
    );
    const rs = await Promise.all([
      svc.receiveReplies([inbound(to)]),
      svc.receiveReplies([inbound(to)]),
    ]);
    const accepted = rs.flatMap((r) => r.accepted);
    expect(accepted).toHaveLength(1);
    expect(rs.flatMap((r) => Object.keys(r.dropped))).toEqual(["used_up"]);
  });
});
