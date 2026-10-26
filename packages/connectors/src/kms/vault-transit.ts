// KMS alternative `vault-transit` (PL2 plan §6.2, C-14): the Vault or OpenBao Transit engine over
// HTTPS through the egress client. `aes256-gcm96` keys with the port's AAD as `associated_data`;
// `ecdsa-p256` keys for signing (ASN.1 DER, verified against every key version's public key).
// Transit can only delete a key at once, never on a schedule, so `scheduleKeyDeletion` is
// unsupported here (C-15: deletion is scheduled, never immediate).
import { PortError } from "@infrabyx/contracts/errors";
import type { AdapterDescriptor, DataKey, KmsPort, PortHealth } from "@infrabyx/contracts/ports";
import { toBase64Url, verifyRecord } from "@infrabyx/crypto";
import { createEgress, type EgressResponse } from "../core/http.js";
import type { VaultAuth } from "../secrets/vault.js";
import {
  HEALTH_CONTEXT,
  KMS_ALGORITHMS,
  checkSignAlg,
  decryptRefused,
  pemToDer,
  requireDataKeyContext,
} from "./common.js";

export interface VaultTransitOptions {
  address: string;
  /** Token auth only in dev and CI; clusters use the Kubernetes login of the SECRETS adapter. */
  auth:
    | Extract<VaultAuth, { kind: "token" }>
    | { kind: "token-provider"; token: () => Promise<string> };
  mount?: string;
  namespace?: string;
  platformKeyId?: string;
  allowLoopbackHttp?: boolean;
}

const TENANT = /^[A-Za-z0-9_]{1,64}$/;
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

export class VaultTransit implements KmsPort {
  readonly descriptor: AdapterDescriptor = {
    port: "KMS",
    adapter: "vault-transit",
    residency: "IN",
    maxDataClass: "SECRET",
    capabilities: { scheduleKeyDeletion: "unsupported" },
  };
  private readonly egress: ReturnType<typeof createEgress>;

  constructor(private readonly o: VaultTransitOptions) {
    this.egress = createEgress({
      port: "KMS",
      adapter: "vault-transit",
      allow: [new URL(o.address).hostname],
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private get mount(): string {
    return this.o.mount ?? "transit";
  }

  private async token(): Promise<string> {
    return this.o.auth.kind === "token" ? this.o.auth.token : this.o.auth.token();
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T; raw: EgressResponse }> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "X-Vault-Token": await this.token(),
    };
    if (this.o.namespace) headers["X-Vault-Namespace"] = this.o.namespace;
    const raw = await this.egress(`${this.o.address.replace(/\/$/, "")}/v1/${this.mount}/${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const parsed = raw.body.byteLength ? raw.json<{ data: T }>() : ({ data: null } as { data: T });
    return { status: raw.status, data: parsed.data, raw };
  }

  private fail(status: number, what: string): never {
    throw new PortError(status === 403 ? "IPB-PORT-001" : "IPB-PORT-002", "KMS", {
      adapter: "vault-transit",
      detail: `${what} answered ${status}`,
    });
  }

  private key(keyId: string): string {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(keyId))
      throw new PortError("IPB-PORT-003", "KMS", {
        adapter: "vault-transit",
        detail: "invalid key id",
      });
    return encodeURIComponent(keyId);
  }

  async encrypt(keyId: string, plaintext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
    const r = await this.call<{ ciphertext: string }>("POST", `encrypt/${this.key(keyId)}`, {
      plaintext: b64(plaintext),
      ...(aad?.byteLength ? { associated_data: b64(aad) } : {}),
    });
    if (r.status !== 200) this.fail(r.status, "encrypt");
    return new TextEncoder().encode(r.data.ciphertext);
  }

  async decrypt(keyId: string, ciphertext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
    let r: { status: number; data: { plaintext: string } };
    try {
      r = await this.call<{ plaintext: string }>("POST", `decrypt/${this.key(keyId)}`, {
        ciphertext: new TextDecoder().decode(ciphertext),
        ...(aad?.byteLength ? { associated_data: b64(aad) } : {}),
      });
    } catch {
      throw decryptRefused("vault-transit", "unavailable");
    }
    if (r.status === 400) throw decryptRefused("vault-transit", "integrity");
    if (r.status !== 200) throw decryptRefused("vault-transit", "unavailable");
    return unb64(r.data.plaintext);
  }

  async generateDataKey(keyId: string, aad?: Uint8Array): Promise<DataKey> {
    requireDataKeyContext("vault-transit", aad);
    const r = await this.call<{ plaintext: string; ciphertext: string }>(
      "POST",
      `datakey/plaintext/${this.key(keyId)}`,
      {
        bits: 256,
        ...(aad?.byteLength ? { associated_data: b64(aad) } : {}),
      },
    );
    if (r.status !== 200) this.fail(r.status, "datakey");
    return {
      plaintext: unb64(r.data.plaintext),
      ciphertext: new TextEncoder().encode(r.data.ciphertext),
      keyId,
    };
  }

  async sign(keyId: string, message: Uint8Array, alg: string): Promise<Uint8Array> {
    checkSignAlg("vault-transit", alg);
    const r = await this.call<{ signature: string }>("POST", `sign/${this.key(keyId)}/sha2-256`, {
      input: b64(message),
      marshaling_algorithm: "asn1",
    });
    if (r.status !== 200) this.fail(r.status, "sign");
    return unb64(r.data.signature.replace(/^vault:v\d+:/, ""));
  }

  private async publicKeys(keyId: string): Promise<Array<{ version: number; spki: Uint8Array }>> {
    const r = await this.call<{
      latest_version: number;
      keys: Record<string, { public_key?: string }>;
    }>("GET", `keys/${this.key(keyId)}`);
    if (r.status !== 200) this.fail(r.status, "read key");
    return Object.entries(r.data.keys)
      .filter(([, k]) => typeof k.public_key === "string" && k.public_key.length > 0)
      .map(([v, k]) => ({ version: Number(v), spki: pemToDer(k.public_key as string) }))
      .sort((a, b) => b.version - a.version);
  }

  /** Verified locally against each key version's public key, so rotated versions still verify. */
  async verify(
    keyId: string,
    message: Uint8Array,
    signature: Uint8Array,
    alg: string,
  ): Promise<boolean> {
    if (alg !== "ecdsa-p256-sha256") return false;
    const record = {
      alg,
      digest_alg: "sha-256" as const,
      key_id: keyId,
      created_at: new Date(0).toISOString(),
      cert_chain_ref: null,
      value: toBase64Url(signature),
    };
    for (const k of await this.publicKeys(keyId)) {
      try {
        if (verifyRecord(record, message, k.spki)) return true;
      } catch {
        // malformed signature for this key version
      }
    }
    return false;
  }

  async getPublicKey(keyId: string): Promise<Uint8Array> {
    const [latest] = await this.publicKeys(keyId);
    if (!latest)
      throw new PortError("IPB-PORT-001", "KMS", {
        adapter: "vault-transit",
        detail: "not an asymmetric key",
        meta: { reason: "unsupported" },
      });
    return latest.spki;
  }

  /** One aes256-gcm96 key per tenant, rotated yearly (C-15); creating an existing key is a no-op. */
  async createTenantKey(tenantId: string): Promise<{ keyId: string }> {
    if (!TENANT.test(tenantId))
      throw new PortError("IPB-PORT-003", "KMS", {
        adapter: "vault-transit",
        detail: "invalid tenant id",
      });
    const keyId = `tenant-${tenantId}`;
    const c = await this.call("POST", `keys/${this.key(keyId)}`, { type: "aes256-gcm96" });
    if (c.status !== 200 && c.status !== 204) this.fail(c.status, "create key");
    const r = await this.call("POST", `keys/${this.key(keyId)}/config`, {
      auto_rotate_period: "8760h",
    });
    if (r.status !== 200 && r.status !== 204) this.fail(r.status, "configure key");
    return { keyId };
  }

  async scheduleKeyDeletion(): Promise<{ deletionDate: string }> {
    throw new PortError("IPB-PORT-001", "KMS", {
      adapter: "vault-transit",
      detail: "Transit cannot schedule a deletion; keys are never deleted immediately (C-15)",
      meta: { reason: "unsupported" },
    });
  }

  async listAlgorithms(): Promise<string[]> {
    return [...KMS_ALGORITHMS];
  }

  async health(): Promise<PortHealth> {
    const t = Date.now();
    try {
      if (this.o.platformKeyId) {
        const aad = HEALTH_CONTEXT();
        const ct = await this.encrypt(
          this.o.platformKeyId,
          new TextEncoder().encode("ipb-kms-canary"),
          aad,
        );
        await this.decrypt(this.o.platformKeyId, ct, aad);
      } else {
        const r = await this.egress(`${this.o.address.replace(/\/$/, "")}/v1/sys/health`);
        if (r.status !== 200 && r.status !== 429) throw new Error(String(r.status));
      }
      return { status: "up", latency_ms: Date.now() - t, checked_at: new Date().toISOString() };
    } catch {
      return { status: "down", latency_ms: Date.now() - t, checked_at: new Date().toISOString() };
    }
  }
}
