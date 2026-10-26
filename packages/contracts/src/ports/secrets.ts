// SECRETS port (IPB-01 §01.4.4.2). Paths: secrets/<env>/<port>/<adapter>/<key> (IPB-02 §02.4.4).
// References in configuration: secret://<adapter>/<path>#<key> (IPB-11 §11.2).
import type { Port } from "./common.js";

export interface SecretMeta {
  owner?: string;
  rotationDays?: number;
  lastRotated?: string;
  dataClass?: "SECRET";
}

export interface SecretValue {
  value: string;
  version: string;
  meta: SecretMeta;
}

export interface SecretsPort extends Port {
  get(path: string, version?: string): Promise<SecretValue>;
  put(path: string, value: string, meta?: SecretMeta): Promise<{ version: string }>;
  rotate(
    path: string,
    rotator: (current: SecretValue) => Promise<string>,
  ): Promise<{ version: string }>;
  list(prefix: string): Promise<string[]>;
  /** Dynamic credentials with a lease (Vault-style); adapters without leases return a static value. */
  lease(path: string, ttlSeconds: number): Promise<SecretValue & { expiresAt: string }>;
  audit(path: string): Promise<Array<{ at: string; actor: string; op: string }>>;
}

export interface SecretRef {
  adapter: string;
  path: string;
  key: string;
}

const SECRET_REF_REGEX = /^secret:\/\/([a-z][a-z0-9_-]*)\/([^#\s]+)#([A-Za-z0-9_.-]+)$/;

export const isSecretRef = (v: string): boolean => SECRET_REF_REGEX.test(v);

/** Parse `secret://<adapter>/<path>#<key>`; null when the string is not a reference. */
export function parseSecretRef(v: string): SecretRef | null {
  const m = SECRET_REF_REGEX.exec(v);
  if (!m) return null;
  return { adapter: m[1] as string, path: m[2] as string, key: m[3] as string };
}
