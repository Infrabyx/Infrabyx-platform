// Inbound replies, the pure parts (PR-LDC-50; R1-D-177; plan §4 and §7).
import { describe, expect, it } from "vitest";
import {
  base32,
  htmlToText,
  mintReplyToken,
  parseInbound,
  prescan,
  replyAddress,
  replyRecipient,
  replyText,
  senderAuthenticated,
  singleFrom,
  stripQuoted,
} from "./reply.js";
import { sha256Hex } from "@infrabyx/crypto";

const enc = (s: string) => new TextEncoder().encode(s);
const mail = (headers: string, body: string) => enc(`${headers.trim()}\r\n\r\n${body}`);
const H = "From: Asha <asha@client.example>\r\nTo: reply@x.example\r\nSubject: Re: note";

describe("reply tokens and addresses", () => {
  it("encodes RFC 4648 base32 in lower case (test vectors of §10)", () => {
    expect(base32(enc("f"))).toBe("my");
    expect(base32(enc("fo"))).toBe("mzxq");
    expect(base32(enc("foobar"))).toBe("mzxw6ytboi");
  });

  it("mints 32-character tokens and stores only their SHA-256", () => {
    const a = mintReplyToken();
    const b = mintReplyToken();
    expect(a.token).toMatch(/^[a-z2-7]{32}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(sha256Hex(a.token));
    const addr = replyAddress(a.token, "reply.ld.example");
    expect(addr.split("@")[0]!.length).toBeLessThanOrEqual(64);
  });

  it("finds exactly one reply recipient", () => {
    const t = "a".repeat(32);
    expect(replyRecipient([`reply+${t}@r.example`, "other@r.example"])).toEqual({
      token: t,
      domain: "r.example",
    });
    expect(replyRecipient([`REPLY+${t.toUpperCase()}@R.EXAMPLE`])).toEqual({
      token: t,
      domain: "r.example",
    });
    expect(replyRecipient(["someone@r.example"])).toEqual({ drop: "no_token" });
    expect(replyRecipient([`reply+${t.slice(1)}@r.example`])).toEqual({ drop: "no_token" });
    expect(replyRecipient([`reply+${t}@r.example`, `reply+${"b".repeat(32)}@r.example`])).toEqual({
      drop: "ambiguous",
    });
  });
});

describe("bounds before and during the parse", () => {
  it("drops a message over 10 MiB and a line over 998 octets", () => {
    expect(prescan(new Uint8Array(10 * 1024 * 1024 + 1))).toBe("too_large");
    expect(prescan(mail(H, "x".repeat(999)))).toBe("line_length");
    expect(prescan(mail(H, `${"x".repeat(998)}\r\nok`))).toBeNull();
  });

  it("drops a declared charset off the allow-list, in parameters, RFC 2231 and RFC 2047", () => {
    const ct = (v: string) => mail(`${H}\r\nContent-Type: text/plain; charset=${v}`, "hi");
    expect(prescan(ct("utf-8"))).toBeNull();
    expect(prescan(ct('"ISO-8859-1"'))).toBeNull();
    expect(prescan(ct("utf-7"))).toBe("charset");
    expect(prescan(ct("x-unknown"))).toBe("charset");
    expect(prescan(mail(`${H}\r\nSubject: =?UTF-7?Q?+AGEAYgBj-?=`, "hi"))).toBe("charset");
    expect(prescan(mail(`${H}\r\nX-Note: =?utf-8?B?aGk=?=`, "hi"))).toBeNull();
    expect(
      prescan(
        mail(
          `${H}\r\nContent-Type: multipart/mixed; boundary=b`,
          "--b\r\nContent-Type: text/plain\r\nContent-Disposition: attachment;\r\n filename*=koi8-r''%E1\r\n\r\nx\r\n--b--\r\n",
        ),
      ),
    ).toBe("charset");
  });

  const multipart = (parts: number) => {
    let body = "";
    for (let i = 0; i < parts; i++) body += `--b\r\nContent-Type: text/plain\r\n\r\npart ${i}\r\n`;
    return mail(`${H}\r\nContent-Type: multipart/mixed; boundary=b`, `${body}--b--\r\n`);
  };

  it("parses a normal multipart message and drops one with more than 200 parts", async () => {
    expect("email" in (await parseInbound(multipart(3)))).toBe(true);
    expect(await parseInbound(multipart(250))).toEqual({ drop: "parts" });
  });

  it("drops nesting deeper than 10 and headers over 64 KiB", async () => {
    let body = "deep";
    for (let i = 11; i >= 0; i--)
      body = `--b${i}\r\nContent-Type: multipart/mixed; boundary=b${i + 1}\r\n\r\n${body}\r\n--b${i}--\r\n`;
    const deep = mail(`${H}\r\nContent-Type: multipart/mixed; boundary=b0`, body);
    expect(await parseInbound(deep)).toEqual({ drop: "depth" });
    const flood = Array.from({ length: 1200 }, (_, i) => `X-F${i}: ${"v".repeat(60)}`).join("\r\n");
    expect(await parseInbound(mail(`${H}\r\n${flood}`, "hi"))).toEqual({ drop: "headers" });
  });

  it("keeps a forwarded message as an attachment, never parsed inline", async () => {
    const inner = "From: x@y.example\r\nSubject: inner\r\n\r\nInner body";
    const r = await parseInbound(
      mail(
        `${H}\r\nContent-Type: multipart/mixed; boundary=b`,
        `--b\r\nContent-Type: text/plain\r\n\r\nSee below\r\n--b\r\nContent-Type: message/rfc822\r\n\r\n${inner}\r\n--b--\r\n`,
      ),
    );
    if (!("email" in r)) throw new Error("expected a parse");
    expect(r.email.text).not.toContain("Inner body");
    expect(r.email.attachments).toHaveLength(1);
  });
});

describe("sender", () => {
  it("takes the single From mailbox only", async () => {
    const one = await parseInbound(mail(H, "hi"));
    if (!("email" in one)) throw new Error("parse");
    expect(singleFrom(one.email)).toBe("asha@client.example");
    for (const from of [
      "From: a@x.example, b@y.example",
      "From: Team: a@x.example, b@y.example;",
      "From: a@x.example\r\nFrom: b@y.example",
    ]) {
      const r = await parseInbound(mail(`${from}\r\nSubject: s`, "hi"));
      if (!("email" in r)) throw new Error("parse");
      expect(singleFrom(r.email), from).toBeNull();
    }
  });

  it("accepts DMARC pass, or no policy with aligned DKIM and strictly aligned SPF", () => {
    const m = (dmarc: string, dkim: string, spf: string, env = "asha@client.example") =>
      senderAuthenticated(
        { auth: { dmarc, dkimAligned: dkim, spf } as never, envelopeFrom: env },
        "asha@client.example",
      );
    expect(m("pass", "fail", "fail")).toBe(true);
    expect(m("fail", "pass", "pass")).toBe(false);
    expect(m("error", "pass", "pass")).toBe(false);
    expect(m("none", "pass", "pass")).toBe(true);
    expect(m("none", "pass", "pass", "bounce@mail.client.example")).toBe(false);
    expect(m("none", "pass", "pass", "")).toBe(false);
    expect(m("none", "none", "pass")).toBe(false);
    expect(m("none", "pass", "none")).toBe(false);
  });
});

describe("reply text: quoted history removed", () => {
  it("Gmail (one line and wrapped)", () => {
    expect(
      stripQuoted(
        "Approved, go ahead.\n\nOn Tue, 17 Nov 2026 at 10:02, Infrabyx <noreply@x.example> wrote:\n> Please confirm\n",
      ),
    ).toBe("Approved, go ahead.");
    expect(
      stripQuoted(
        "Done.\n\nOn Tue, 17 Nov 2026 at 10:02, Infrabyx Notifications\n<noreply@x.example> wrote:\n> x",
      ),
    ).toBe("Done.");
  });

  it("Outlook (rule, header block and Original Message)", () => {
    expect(
      stripQuoted(
        "Noted with thanks.\n\n________________________________\nFrom: Infrabyx <noreply@x.example>\nSent: Tuesday\nTo: Asha\nSubject: Note",
      ),
    ).toBe("Noted with thanks.");
    expect(
      stripQuoted(
        "Fine.\n\nFrom: Infrabyx <noreply@x.example>\nSent: 17 November 2026 10:02\nTo: a",
      ),
    ).toBe("Fine.");
    expect(stripQuoted("Yes.\n-----Original Message-----\nFrom: x")).toBe("Yes.");
  });

  it("Apple Mail, Thunderbird, signatures and inline quotes", () => {
    expect(stripQuoted("OK\n\n> On 17-Nov-2026, at 10:02, X wrote:\n> y")).toBe("OK");
    expect(stripQuoted("Agreed\n\nOn 17/11/2026 10:02, X wrote:\n> y")).toBe("Agreed");
    expect(stripQuoted("Thanks\n-- \nAsha Rao\nPartner")).toBe("Thanks");
    expect(stripQuoted("Sure\n\nSent from my iPhone")).toBe("Sure");
    expect(stripQuoted("> quoted\nmine\n> quoted again\nalso mine")).toBe("mine\nalso mine");
  });

  it("keeps text that only mentions the words", () => {
    expect(stripQuoted("On reflection, I agree.\nFrom: the file it is clear.")).toBe(
      "On reflection, I agree.\nFrom: the file it is clear.",
    );
  });
});

describe("HTML replies are converted to text, never rendered", () => {
  it("drops scripts, styles and quoted blocks, and decodes entities", () => {
    const html =
      '<html><head><title>t</title><style>p{}</style></head><body><p>Approved &amp; signed&nbsp;&#8377;5</p><script>alert(1)</script><div>Line two<br>Line three</div><div class="gmail_quote">On Tue X wrote:<blockquote>old</blockquote></div></body></html>';
    expect(htmlToText(html).trim()).toBe("Approved & signed ₹5\nLine two\nLine three");
  });

  it("cuts Outlook and Thunderbird quote starts and any blockquote", () => {
    expect(htmlToText('<p>Yes</p><div id="divRplyFwdMsg">From: x</div>').trim()).toBe("Yes");
    expect(htmlToText('<p>Yes</p><div class="moz-cite-prefix">On x wrote:</div>').trim()).toBe(
      "Yes",
    );
    expect(htmlToText("<p>Mine</p><blockquote>theirs</blockquote>").trim()).toBe("Mine");
  });

  it("prefers text/plain, falls back to HTML, caps at 20 000 characters, drops controls", () => {
    expect(replyText({ text: "plain", html: "<p>html</p>" })).toBe("plain");
    expect(replyText({ text: "  ", html: "<p>html</p>" })).toBe("html");
    expect(replyText({ text: "a\u0000b\u0007c\td" })).toBe("abc\td");
    expect([...replyText({ text: "é".repeat(30_000) })]).toHaveLength(20_000);
    expect(replyText({})).toBe("");
  });
});
