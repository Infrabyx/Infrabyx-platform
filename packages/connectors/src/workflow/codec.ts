// C-16 Temporal payload codec: every payload is sealed with the field envelope (AES-256-GCM, a
// KMS data key wrapped under the C-14 context `{ tenant_id: platform, purpose: workflow }`, the
// PL1 C-04 path), bound by AAD to the namespace. It is on for both engines (PL2-C-04), so moving
// between `temporal` and `temporal-cloud` needs no re-encryption. Decoding refuses a payload that
// is not encrypted (fail closed). Failure messages and stack traces are encrypted too, through
// `failureConverter` (`encodeCommonAttributes: true`). Workflow ids, names, search attributes
// and task queues are not payloads and may carry no personal or REGULATED data.
import { PLATFORM_KMS_TENANT, type KmsEncryptionContext } from "@infrabyx/contracts/ports";
import { PortError } from "@infrabyx/contracts/errors";
import { FIELD_ALG, type FieldEnvelope } from "@infrabyx/crypto";
import { type Payload, type PayloadCodec } from "@temporalio/common";
import { temporal } from "@temporalio/proto";

export const ENCRYPTED_ENCODING = "binary/encrypted";
const KEY_ID = "encryption-key-id";
const CONTEXT: KmsEncryptionContext = { tenant_id: PLATFORM_KMS_TENANT, purpose: "workflow" };

const utf8 = (s: string) => new TextEncoder().encode(s);
const str = (b?: Uint8Array | null) => (b ? new TextDecoder().decode(b) : undefined);

export interface CodecOptions {
  envelope: FieldEnvelope;
  /** KMS key of the namespace (`int.workflow.namespace`). */
  keyId: string;
  namespace: string;
}

export class EncryptionCodec implements PayloadCodec {
  private readonly aad: Uint8Array;

  constructor(private readonly o: CodecOptions) {
    this.aad = utf8(`ipb/temporal/${o.namespace}`);
  }

  async encode(payloads: Payload[]): Promise<Payload[]> {
    return Promise.all(
      payloads.map(async (p) => {
        const plain = temporal.api.common.v1.Payload.encode(p).finish();
        const sealed = await this.o.envelope.seal(this.o.keyId, plain, this.aad, CONTEXT);
        return {
          metadata: { encoding: utf8(ENCRYPTED_ENCODING), [KEY_ID]: utf8(sealed.keyId) },
          data: sealed.enc,
        };
      }),
    );
  }

  async decode(payloads: Payload[]): Promise<Payload[]> {
    return Promise.all(
      payloads.map(async (p) => {
        if (str(p.metadata?.encoding) !== ENCRYPTED_ENCODING || !p.data)
          throw new PortError("IPB-KMS-001", "WORKFLOW", {
            adapter: "temporal",
            detail: "refused an unencrypted workflow payload (C-16)",
            meta: { reason: "integrity" },
          });
        const plain = await this.o.envelope.open(
          { enc: p.data, keyId: str(p.metadata?.[KEY_ID]) ?? this.o.keyId, alg: FIELD_ALG },
          this.aad,
          CONTEXT,
        );
        return temporal.api.common.v1.Payload.decode(plain) as Payload;
      }),
    );
  }
}
