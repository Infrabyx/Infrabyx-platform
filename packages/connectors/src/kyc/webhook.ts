// V-CIP webhooks verified without a vendor call (PR-UDF-046; R1-D-199; IPB-10-21, IPB-10-27). An
// adapter whose provider signs with Standard Webhooks builds its `verifyWebhook` here: the body's
// size first (64 KiB, before anything is parsed), then `verifyStandardWebhook` of `@infrabyx/crypto`
// (C-13: HMAC-SHA-256, constant time, `v1` only, five-minute window, two secrets during rotation),
// then the delivery's replay claim, then the session id; nothing is read back. Its `handleWebhook`
// is this and then `vcipStatus`. Neither Digio nor IDfy documents a V-CIP webhook scheme the
// platform knows, so both refuse `verifyWebhook` `unsupported` [VERIFY]. RFC 9421 is not offered:
// the platform has no RFC 9421 verifier, and one is new cryptography for the owner (#150).
import {
  KYC_WEBHOOK_MAX_BODY_BYTES,
  kycWebhookRefused,
  verifyKycWebhookWith,
  type KycPort,
  type KycWebhookReceipt,
  type WebhookRequestMeta,
} from "@infrabyx/contracts/ports";
import { verifyStandardWebhook, type ReplayStore } from "@infrabyx/crypto";

export interface StandardWebhookKycVerifierOptions {
  /** The adapter's name, for its refusals. */
  adapter: string;
  /**
   * The provider's Standard Webhooks secrets (`whsec_…`) from SECRETS, read on every delivery: the
   * current one, and the previous one during a rotation.
   */
  secrets: () => Promise<readonly string[]> | readonly string[];
  /** The deliveries' replay store: durable and shared by every instance in production. */
  replay: ReplayStore;
  /** The provider's session id in a verified body (parsed JSON). */
  vcipIdOf: (body: unknown) => unknown;
  now?: () => Date;
}

/** A `KycPort.verifyWebhook` for a provider that signs with Standard Webhooks (PR-UDF-046). */
export function standardWebhookKycVerifier(
  o: StandardWebhookKycVerifierOptions,
): NonNullable<KycPort["verifyWebhook"]> {
  return async (
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    _meta?: WebhookRequestMeta,
  ): Promise<KycWebhookReceipt> => {
    // Before the secrets are read: an oversize body costs nothing.
    if (rawBody.byteLength > KYC_WEBHOOK_MAX_BODY_BYTES)
      throw kycWebhookRefused(o.adapter, "body_too_large");
    const secrets = await o.secrets();
    const now = o.now?.() ?? new Date();
    return verifyKycWebhookWith({
      adapter: o.adapter,
      rawBody,
      headers,
      verify: (h) => verifyStandardWebhook(secrets, rawBody, h, { now: now.getTime() }),
      replay: o.replay,
      vcipIdOf: o.vcipIdOf,
      now,
    });
  };
}
