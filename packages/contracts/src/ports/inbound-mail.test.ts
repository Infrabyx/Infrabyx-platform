// Inbound mail replies (PR-LDC-50; R1-D-177): the request field, the reply address on a message,
// the limits and the event data.
import { describe, expect, it } from "vitest";
import { NotificationReplyReceivedData } from "../events/pl3-events.js";
import { PLATFORM_EVENTS } from "../events/platform-events.js";
import { ID_PREFIXES } from "../ids.js";
import {
  EmailMessage,
  INBOUND_DROP_REASONS,
  INBOUND_MAIL_CHARSETS,
  INBOUND_MAIL_LIMITS,
  NotificationRequest,
} from "./index.js";

const base = {
  class: "matter.note_requested",
  to: [{ ref: "usr_01JAAAAAAAAAAAAAAAAAAAAAAA" }],
  vars: {},
  deepLink: "/matters/1",
  idempotencyKey: "idem-0001",
};

describe("inbound mail contracts (PR-LDC-50)", () => {
  it("takes a reply thread reference of printable ASCII, 1 to 120 characters", () => {
    expect(NotificationRequest.parse({ ...base, reply: { threadRef: "mtr_42" } }).reply).toEqual({
      threadRef: "mtr_42",
    });
    for (const threadRef of ["", "a b", "x".repeat(121), "é"])
      expect(() => NotificationRequest.parse({ ...base, reply: { threadRef } })).toThrow();
    expect(() =>
      NotificationRequest.parse({ ...base, reply: { threadRef: "t", extra: 1 } }),
    ).toThrow();
  });

  it("carries one reply address per message", () => {
    const m = {
      to: ["a@example.com"],
      template: "t",
      vars: {},
      brand: "default",
      replyTo: "reply+abc@reply.example.com",
    };
    expect(EmailMessage.parse(m).replyTo).toBe(m.replyTo);
    expect(() => EmailMessage.parse({ ...m, replyTo: "not an address" })).toThrow();
  });

  it("fixes the design's bounds and a charset allow-list without UTF-7", () => {
    expect(INBOUND_MAIL_LIMITS).toMatchObject({
      maxBytes: 10 * 1024 * 1024,
      maxParts: 200,
      maxDepth: 10,
      maxHeaderBytes: 65_536,
      maxLineOctets: 998,
      maxAttachments: 20,
      maxTextChars: 20_000,
    });
    expect(INBOUND_MAIL_CHARSETS).toContain("utf-8");
    expect(INBOUND_MAIL_CHARSETS).not.toContain("utf-7");
    expect(new Set(INBOUND_DROP_REASONS).size).toBe(INBOUND_DROP_REASONS.length);
  });

  it("registers the event and the reply id prefix; the event never carries text", () => {
    expect(PLATFORM_EVENTS.NotificationReplyReceived).toEqual({
      module: "ntf",
      name: "NotificationReplyReceived",
    });
    expect(ID_PREFIXES).toHaveProperty("rpl");
    const data = {
      reply_id: "rpl_01JAAAAAAAAAAAAAAAAAAAAAAA",
      thread_ref: "mtr_42",
      recipient_ref: "usr_01JAAAAAAAAAAAAAAAAAAAAAAA",
      attachments: 1,
      received_at: "2026-11-18T06:00:00.000Z",
    };
    expect(NotificationReplyReceivedData.parse(data)).toEqual(data);
    expect(() => NotificationReplyReceivedData.parse({ ...data, text: "hello" })).toThrow();
  });
});
