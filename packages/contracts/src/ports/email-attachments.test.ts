// Attachments on the NOTIFY request and the EMAIL message (Udofin PR-UDF-055; R1-D-224).
import { describe, expect, it } from "vitest";
import {
  EMAIL_ATTACHMENT_LIMITS,
  EmailAttachment,
  EmailMessage,
  attachmentExtensionFits,
  emailAttachmentTypeOf,
} from "./email.js";
import { NotificationRequest } from "./notify.js";
import { payloadClass } from "./payload-class.js";

const KEY = "tenant/tnt_a/loan_docs/01JB0000000000000000000000.pdf";
const SHA = "a".repeat(64);
const att = (over: Record<string, unknown> = {}) => ({
  storageKey: KEY,
  sha256: SHA,
  filename: "Sanction letter (v2).pdf",
  mediaType: "application/pdf",
  ...over,
});
const req = (attachments: unknown[]) => ({
  class: "loan.document_issued",
  to: [{ ref: "cus:u1" }],
  vars: { id: "x1" },
  deepLink: "/loans/x1",
  idempotencyKey: "idem-attach-1",
  attachments,
});

describe("PR-UDF-055 attachments on a notification request", () => {
  it("takes a storage key, a SHA-256, a plain filename and an allowed media type", () => {
    expect(NotificationRequest.parse(req([att()])).attachments).toHaveLength(1);
    expect(
      NotificationRequest.safeParse(req([att({ mediaType: "image/jpeg", filename: "a.JPG" })]))
        .success,
    ).toBe(true);
  });

  it.each([
    ["a key outside the IPB-01-27 format", { storageKey: "loan_docs/x.pdf" }],
    ["an upper-case or short hash", { sha256: "A".repeat(64) }],
    ["a path in the filename", { filename: "../etc/passwd.pdf" }],
    ["a line break in the filename", { filename: "a\r\nb.pdf" }],
    ["no extension", { filename: "sanction" }],
    ["an extension that is not the type's", { filename: "letter.html" }],
    ["a type outside the list", { mediaType: "text/html", filename: "a.html" }],
    ["an unknown field", { url: "https://x.example" }],
  ])("refuses %s", (_name, over) => {
    expect(NotificationRequest.safeParse(req([att(over)])).success).toBe(false);
  });

  it("at most ten, and none is no list", () => {
    expect(
      NotificationRequest.safeParse(req(Array.from({ length: 11 }, () => att()))).success,
    ).toBe(false);
    expect(NotificationRequest.safeParse(req([])).success).toBe(false);
  });
});

describe("PR-UDF-055 attachments as bytes on the EMAIL message", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n...");
  it("the bytes travel as given and the field is INTERNAL", () => {
    const m = EmailMessage.parse({
      to: ["a@example.test"],
      template: "t",
      vars: {},
      brand: "b",
      files: [{ filename: "a.pdf", contentType: "application/pdf", sha256: SHA, body: pdf }],
    });
    expect(m.files![0]!.body).toBe(pdf);
    expect(payloadClass(EmailMessage).bodyHighest).toBe("INTERNAL");
    expect(EMAIL_ATTACHMENT_LIMITS).toEqual({ maxFiles: 10, maxBytes: 10 * 1024 * 1024 });
  });

  it("refuses a body that is not bytes and a type outside the list", () => {
    const base = { filename: "a.pdf", contentType: "application/pdf", sha256: SHA };
    expect(EmailAttachment.safeParse({ ...base, body: "JVBERi0=" }).success).toBe(false);
    expect(
      EmailAttachment.safeParse({ ...base, contentType: "text/plain", body: pdf }).success,
    ).toBe(false);
  });

  it("knows PDF, PNG and JPEG by their magic numbers and nothing else", () => {
    expect(emailAttachmentTypeOf(pdf)).toBe("application/pdf");
    expect(
      emailAttachmentTypeOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    ).toBe("image/png");
    expect(emailAttachmentTypeOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(emailAttachmentTypeOf(new TextEncoder().encode("<html>"))).toBeUndefined();
    expect(emailAttachmentTypeOf(new Uint8Array([0x25, 0x50]))).toBeUndefined();
    expect(attachmentExtensionFits("x.jpeg", "image/jpeg")).toBe(true);
    expect(attachmentExtensionFits("x.png", "application/pdf")).toBe(false);
  });
});
