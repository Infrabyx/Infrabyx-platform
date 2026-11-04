// EMAIL rendered content (LawDocsComply PR-LDC-27; R1-D-90): a tenant's own subject and parts go
// as SES simple content and as Brevo's own content fields, in place of the vendor template. Runs
// against the SES v2 and Brevo stubs only (no moto).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailMessage } from "@infrabyx/contracts/ports";
import { generateWebhookSecret } from "@infrabyx/crypto";
import {
  MemoryStorage,
  startBrevoStub,
  startSesStub,
  type BrevoStub,
  type SesStub,
} from "@infrabyx/testing";
import { BrevoEmail, textAsHtml } from "../brevo.js";
import { SesEmail } from "../ses.js";

let ses: SesStub;
let brevo: BrevoStub;
const storage = new MemoryStorage();
const message: EmailMessage = {
  to: ["client@example.test"],
  template: "case.hearing_reminder",
  vars: { name: "Asha" },
  brand: "ld",
  tags: { flow: "hearing" },
  content: {
    subject: "Hearing on 3 Dec",
    text: "Dear Asha,\nyour hearing is on 3 Dec.",
    html: "<p>Dear Asha</p>",
  },
};

beforeAll(async () => {
  [ses, brevo] = await Promise.all([startSesStub(), startBrevoStub()]);
  brevo.domains.set("ld.example.test", true);
});
afterAll(async () => {
  await Promise.all([ses?.close(), brevo?.close()]);
});

describe("@R1-M58 EMAIL content in place of a vendor template", () => {
  it("SES sends simple content, with no template to exist", async () => {
    const p = new SesEmail({
      region: "ap-south-1",
      brands: { ld: { from: "noreply@ld.example.test", configurationSet: "ld-events" } },
      events: { topicArn: "arn:aws:sns:ap-south-1:111122223333:ses-events-ld" },
      storage,
      endpoint: ses.url,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    expect(p.descriptor.capabilities?.content).toBe("native");
    const { messageId } = await p.send(message);
    expect(messageId).not.toBe("");
    const m = ses.messages.at(-1);
    expect(m?.template).toBeUndefined();
    expect(m?.simple).toEqual({
      subject: "Hearing on 3 Dec",
      text: "Dear Asha,\nyour hearing is on 3 Dec.",
      html: "<p>Dear Asha</p>",
    });
  });
  it("Brevo sends subject, text and HTML (escaped text when there is no HTML part)", async () => {
    const p = new BrevoEmail({
      apiKey: () => brevo.apiKey,
      brands: { ld: { from: "noreply@ld.example.test", templates: {} } },
      dpaRef: "VAR-DPA-BREVO-001",
      webhook: { secret: generateWebhookSecret },
      storage,
      baseUrl: `${brevo.url}/v3`,
      allowLoopbackHttp: true,
    });
    expect(p.descriptor.capabilities?.content).toBe("native");
    await p.send(message);
    expect(brevo.messages.at(-1)).toMatchObject({
      subject: "Hearing on 3 Dec",
      textContent: "Dear Asha,\nyour hearing is on 3 Dec.",
      htmlContent: "<p>Dear Asha</p>",
    });
    expect(brevo.messages.at(-1)?.templateId).toBeUndefined();
    const { html: _h, ...textOnly } = message.content!;
    await p.send({ ...message, content: { ...textOnly, text: 'a < b & "c"\nnext' } });
    expect(brevo.messages.at(-1)?.htmlContent).toBe("<p>a &lt; b &amp; &quot;c&quot;<br>next</p>");
    expect(textAsHtml("x")).toBe("<p>x</p>");
  });
  it("a subject with a line break is refused by the contract", async () => {
    const p = new SesEmail({
      region: "ap-south-1",
      brands: { ld: { from: "noreply@ld.example.test", configurationSet: "ld-events" } },
      events: { topicArn: "arn:aws:sns:ap-south-1:111122223333:ses-events-ld" },
      storage,
      endpoint: ses.url,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    await expect(
      p.send({ ...message, content: { ...message.content!, subject: "a\r\nBcc: x@example.test" } }),
    ).rejects.toThrow();
  });
});
