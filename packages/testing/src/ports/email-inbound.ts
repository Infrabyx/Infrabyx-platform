// EMAIL inbound routes (LawDocsComply PR-LDC-50; R1-D-177; plan
// `docs/phases/R1-inbound-mail-plan.md` §7): `FakeInboundEmail`, an EMAIL fake that records what it
// sends (the reply address included) and has an inbound route, and `defineEmailInboundContract`,
// the cases every adapter with `verifyInbound` must pass. The fake's route is "signed" with a test
// secret in a header, compared by digest; it is a test double, not a vendor protocol.
// EMAIL inbound routes (LawDocsComply PR-LDC-50; R1-D-177; plan
// `docs/phases/R1-inbound-mail-plan.md` §7): `FakeInboundEmail`, an EMAIL fake that records what it
// sends (the reply address included) and has an inbound route, and `defineEmailInboundContract`,
// the cases every adapter with `verifyInbound` must pass. The fake's route is "signed" with a test
// secret in a header, compared by digest; it is a test double, not a vendor protocol.
import { describe, expect, it } from "vitest";
import { INBOUND_MAIL_LIMITS, type EmailPort } from "@infrabyx/contracts/ports";
import { type InboundFixture } from "@infrabyx/fakes";
export { type InboundFixture, FakeInboundEmail } from "@infrabyx/fakes";

/** What an adapter's contract run needs: the port and how its vendor would post to it. */
export interface EmailInboundHarness {
  port: EmailPort;
  /** A post the adapter accepts (signed as the vendor signs). */
  post(m: InboundFixture): { body: Uint8Array; headers: Record<string, string> };
  /** The same post with its signature broken (refused as `IPB-API-018`). */
  forge(m: InboundFixture): { body: Uint8Array; headers: Record<string, string> };
}

const fixture = (over: Partial<InboundFixture> = {}): InboundFixture => ({
  vendorMessageId: "contract-msg-1",
  envelopeFrom: "Asha@Client.Example",
  recipients: ["Reply+ABCDEFGHIJKLMNOPQRSTUVWXYZ234567@reply.example"],
  auth: { spf: "pass", dkimAligned: "pass", dmarc: "pass" },
  raw: new TextEncoder().encode(
    "From: asha@client.example\r\nAuthentication-Results: x; dmarc=pass\r\nSubject: Re\r\n\r\nok\r\n",
  ),
  ...over,
});

/**
 * The contract every EMAIL adapter with an inbound route passes (PR-LDC-50): one verified message
 * per post with lower-cased addresses and the bytes unchanged; verdicts from the vendor's own
 * record, never the message's headers; an unverified post and a message over 10 MiB refused.
 */
export function defineEmailInboundContract(
  name: string,
  make: () => Promise<EmailInboundHarness> | EmailInboundHarness,
): void {
  describe(`@IPB-01-15 EMAIL inbound contract: ${name} (PR-LDC-50)`, () => {
    it("declares the inbound capability", async () => {
      const h = await make();
      expect(h.port.descriptor.capabilities?.inbound).toBe("native");
      expect(typeof h.port.verifyInbound).toBe("function");
    });

    it("returns the verified message with its bytes unchanged and addresses lower-cased", async () => {
      const h = await make();
      const f = fixture();
      const p = h.post(f);
      const [m, ...rest] = await h.port.verifyInbound!(p.body, p.headers);
      expect(rest).toEqual([]);
      expect(m?.vendorMessageId).toBe(f.vendorMessageId);
      expect(m?.envelopeFrom).toBe("asha@client.example");
      expect(m?.recipients).toEqual(["reply+abcdefghijklmnopqrstuvwxyz234567@reply.example"]);
      expect(Buffer.from(m!.raw).equals(Buffer.from(f.raw))).toBe(true);
      expect(Number.isNaN(Date.parse(m!.receivedAt))).toBe(false);
    });

    it("takes the verdicts from the vendor's record, not the message's headers", async () => {
      const h = await make();
      const p = h.post(fixture({ auth: { spf: "none", dkimAligned: "fail", dmarc: "fail" } }));
      const [m] = await h.port.verifyInbound!(p.body, p.headers);
      expect(m?.auth).toEqual({ spf: "none", dkimAligned: "fail", dmarc: "fail" });
    });

    it("refuses an unverified post", async () => {
      const h = await make();
      const p = h.forge(fixture());
      await expect(h.port.verifyInbound!(p.body, p.headers)).rejects.toMatchObject({
        code: "IPB-API-018",
      });
    });

    it("refuses a message over 10 MiB", async () => {
      const h = await make();
      const p = h.post(fixture({ raw: new Uint8Array(INBOUND_MAIL_LIMITS.maxBytes + 1) }));
      await expect(h.port.verifyInbound!(p.body, p.headers)).rejects.toMatchObject({
        code: "IPB-SEC-013",
      });
    });
  });
}
