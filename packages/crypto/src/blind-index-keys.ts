// Blind-index keys outside test environments (Finbyx PR-FBX-25; PL1-C-05, R1-D-37).
//
// One root key per product and environment, held in the SECRETS port (the C-23 pattern: an
// HMAC-SHA-256 key read through SECRETS and used only inside @infrabyx/crypto). Each tenant and
// scope gets its own sub-key by HKDF-SHA-256 (`deriveSubKey`), so indexes of two tenants, or of
// two scopes of one tenant, cannot be joined. The sub-key label is `<product>/<scope>/v<n>/<tenant>`
// where `n` is the root key's version, so a rotation changes every index and old and new values
// never collide. Below staging the root is `LocalKms`'s public `local:hmac:blind-index` key.
import type { SecretsPort } from "@infrabyx/contracts/ports";
import { blindIndex, normaliseForIndex } from "./blind-index.js";
import { fromBase64Url, fromHex } from "./encoding.js";
import { deriveSubKey } from "./hmac.js";
import { SecretKey } from "./keys.js";
import { LOCAL_KMS_KEYS, localDevKey, matchesDevKey } from "./local-kms.js";

const SEGMENT = /^[a-z][a-z0-9_-]{0,31}$/;
const TENANT = /^[A-Za-z0-9_]{1,64}$/;
const VERSION = /^[1-9][0-9]{0,5}$/;

/** A root blind-index key and the version that goes into every sub-key label and stored index. */
export interface BlindIndexRoot {
  key: SecretKey;
  /** Positive integer as a string ("1", "2", …); store it next to each index value. */
  version: string;
}

/** The SECRETS path of a product's root blind-index key: `secrets/<env>/kms/blind-index/<product>`. */
export function blindIndexSecretPath(appEnv: string, product: string): string {
  const env = appEnv.toLowerCase();
  const p = product.toLowerCase();
  if (!SEGMENT.test(env)) throw new Error("blind index: invalid environment name");
  if (!SEGMENT.test(p)) throw new Error("blind index: invalid product code");
  return `secrets/${env}/kms/blind-index/${p}`;
}

function decodeRoot(value: string): Uint8Array {
  const v = value.trim();
  if (/^[0-9a-f]{64,}$/i.test(v) && v.length % 2 === 0) return fromHex(v);
  if (/^[A-Za-z0-9_-]{43,}$/.test(v)) return fromBase64Url(v);
  throw new Error("blind index: the root key must be hex or base64url of at least 32 bytes");
}

/**
 * Read the root key from SECRETS. The value is at least 32 random bytes, hex or base64url
 * (`generateWebhookSecret()` makes one). A dev-key value is refused in every environment: a
 * secrets store never holds the public local key. `version` reads an older version during a
 * rotation; the returned version is the store's own when it is a positive integer.
 */
export async function loadBlindIndexRoot(
  secrets: SecretsPort,
  opts: { appEnv: string; product: string; version?: string },
): Promise<BlindIndexRoot> {
  const path = blindIndexSecretPath(opts.appEnv, opts.product);
  const s = await secrets.get(path, opts.version);
  if (matchesDevKey(s.value)) throw new Error("blind index: the root key is a public dev key");
  const material = decodeRoot(s.value);
  if (material.byteLength < 32)
    throw new Error("blind index: the root key is shorter than 32 bytes");
  const version = opts.version ?? s.version;
  if (!VERSION.test(version)) {
    throw new Error("blind index: the secret version must be a positive integer; pass `version`");
  }
  return { key: new SecretKey(`${path}@${version}`, "hmac-sha-256", material), version };
}

/** The public local root (`local:hmac:blind-index`), for local, dev and test only (PL1-C-10). */
export function localBlindIndexRoot(version = "1"): BlindIndexRoot {
  if (!VERSION.test(version)) throw new Error("blind index: invalid version");
  return { key: localDevKey(LOCAL_KMS_KEYS.blindIndex), version };
}

/** The tenant- and scope-specific index key: HKDF-SHA-256 with `<product>/<scope>/v<n>/<tenant>`. */
export function tenantBlindIndexKey(
  root: BlindIndexRoot,
  opts: { product: string; scope: string; tenantId: string },
): SecretKey {
  const product = opts.product.toLowerCase();
  if (!SEGMENT.test(product)) throw new Error("blind index: invalid product code");
  if (!SEGMENT.test(opts.scope)) throw new Error("blind index: invalid scope");
  if (!TENANT.test(opts.tenantId)) throw new Error("blind index: invalid tenant id");
  if (!VERSION.test(root.version)) throw new Error("blind index: invalid version");
  return deriveSubKey(root.key, `${product}/${opts.scope}/v${root.version}/${opts.tenantId}`);
}

/** An index value with the root version it was made under (store both; look up by both). */
export interface VersionedIndex {
  value: string;
  version: string;
}

/**
 * Blind indexes for one product and scope across tenants, with rotation. Writes use `current`;
 * lookups try `current` and then `previous` while a re-index runs, and `needsReindex` tells the
 * re-index job which rows to rewrite. Sub-keys are cached per tenant and version.
 */
export class BlindIndexer {
  private readonly cache = new Map<string, SecretKey>();

  constructor(
    private readonly o: {
      product: string;
      scope: string;
      current: BlindIndexRoot;
      previous?: BlindIndexRoot;
      normalise?: (v: string) => string;
      /** Most tenant sub-keys kept in memory (default 10,000). */
      maxCachedKeys?: number;
    },
  ) {
    if (o.previous && o.previous.version === o.current.version) {
      throw new Error("blind index: previous and current roots have the same version");
    }
  }

  private key(root: BlindIndexRoot, tenantId: string): SecretKey {
    const id = `${root.version}:${tenantId}`;
    const hit = this.cache.get(id);
    if (hit) return hit;
    const k = tenantBlindIndexKey(root, {
      product: this.o.product,
      scope: this.o.scope,
      tenantId,
    });
    if (this.cache.size >= (this.o.maxCachedKeys ?? 10_000)) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(id, k);
    return k;
  }

  private make(root: BlindIndexRoot, tenantId: string, value: string): VersionedIndex {
    return {
      value: blindIndex(this.key(root, tenantId), value, this.o.normalise ?? normaliseForIndex),
      version: root.version,
    };
  }

  /** The index to store for a new or changed value. */
  index(tenantId: string, value: string): VersionedIndex {
    return this.make(this.o.current, tenantId, value);
  }

  /** The values to search for: current first, then previous during a rotation. */
  candidates(tenantId: string, value: string): VersionedIndex[] {
    const out = [this.make(this.o.current, tenantId, value)];
    if (this.o.previous) out.push(this.make(this.o.previous, tenantId, value));
    return out;
  }

  /** True when a stored index was made under another root version than `current`. */
  needsReindex(stored: Pick<VersionedIndex, "version">): boolean {
    return stored.version !== this.o.current.version;
  }
}
