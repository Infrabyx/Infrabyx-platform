// EMAIL inbound routes (LawDocsComply PR-LDC-50; R1-D-177; plan
// `docs/phases/R1-inbound-mail-plan.md` §7): `FakeInboundEmail`, an EMAIL fake that records what it
// sends (the reply address included) and has an inbound route, and `defineEmailInboundContract`,
// the cases every adapter with `verifyInbound` must pass. The fake's route is "signed" with a test
// secret in a header, compared by digest; it is a test double, not a vendor protocol.
import { PortError } from "@infrabyx/contracts/errors";
import {
  INBOUND_MAIL_LIMITS,
  type AdapterDescriptor,
  type EmailEvent,
  type EmailMessage,
  type EmailPort,
  type InboundAuthResult,
  type InboundEmail,
  type PortHealth,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";

/** What a test wants delivered to an inbound route. */
export interface InboundFixture {
  vendorMessageId: string;
  envelopeFrom: string;
  recipients: string[];
  auth: { spf: InboundAuthResult; dkimAligned: InboundAuthResult; dmarc: InboundAuthResult };
  raw: Uint8Array;
}

const SECRET_HEADER = "x-fake-inbound-secret";

export class FakeInboundEmail implements EmailPort {
  readonly descriptor: AdapterDescriptor = {
    port: "EMAIL",
    adapter: "fake-email",
    residency: "IN",
    maxDataClass: "INTERNAL",
    capabilities: { getStatus: "unsupported", content: "native", inbound: "native" },
  };
  /** Every message sent, as given (the reply address included). */
  readonly sent: EmailMessage[] = [];
  constructor(private readonly secret = "fake-inbound-secret") {}

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: new Date().toISOString() };
  }
  async send(message: EmailMessage): Promise<{ messageId: string }> {
    this.sent.push(message);
    return { messageId: `fake-${this.sent.length}` };
  }
  async sendRaw(): Promise<{ messageId: string }> {
    return { messageId: `fake-raw-${this.sent.length}` };
  }
  async getStatus(): Promise<{ status: string }> {
    return { status: "sent" };
  }
  async verifyWebhook(): Promise<EmailEvent[]> {
    return [];
  }
  async verifyDomain() {
    return { verified: true, dnsRecords: [] };
  }
  async suppress(): Promise<void> {}

  /** The body and headers a vendor would POST for these messages. */
  post(messages: readonly InboundFixture[]): {
    body: Uint8Array;
    headers: Record<string, string>;
  } {
    return {
      body: new TextEncoder().encode(
        JSON.stringify(messages.map((m) => ({ ...m, raw: Buffer.from(m.raw).toString("base64") }))),
      ),
      headers: { [SECRET_HEADER]: this.secret },
    };
  }

  async verifyInbound(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<InboundEmail[]> {
    // Digests of equal length are compared, so the comparison does not leak the secret's length.
    if (sha256Hex(headers[SECRET_HEADER] ?? "") !== sha256Hex(this.secret))
      throw new PortError("IPB-API-018", "EMAIL", {
        adapter: "fake-email",
        detail: "inbound post not verified",
      });
    let list: Array<Omit<InboundFixture, "raw"> & { raw: string }>;
    try {
      list = JSON.parse(new TextDecoder().decode(rawBody)) as typeof list;
    } catch {
      throw new PortError("IPB-API-018", "EMAIL", { adapter: "fake-email", detail: "not JSON" });
    }
    return list.map((m) => {
      const raw = new Uint8Array(Buffer.from(m.raw, "base64"));
      if (raw.byteLength > INBOUND_MAIL_LIMITS.maxBytes)
        throw new PortError("IPB-SEC-013", "EMAIL", {
          adapter: "fake-email",
          detail: "the received message is over 10 MiB",
          meta: { reason: "too_large" },
        });
      return {
        adapter: "fake-email",
        vendorMessageId: m.vendorMessageId,
        receivedAt: new Date().toISOString(),
        envelopeFrom: m.envelopeFrom.toLowerCase(),
        recipients: m.recipients.map((r) => r.toLowerCase()),
        auth: m.auth,
        raw,
      };
    });
  }
}
