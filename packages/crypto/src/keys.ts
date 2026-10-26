// Opaque key material that cannot be logged or serialised by accident.
const MATERIAL = new WeakMap<SecretKey, Uint8Array>();

export class SecretKey {
  readonly id: string;
  readonly alg: string;

  constructor(id: string, alg: string, material: Uint8Array) {
    if (material.byteLength < 32) throw new Error(`key ${id}: at least 32 bytes required`);
    this.id = id;
    this.alg = alg;
    MATERIAL.set(this, new Uint8Array(material));
    Object.freeze(this);
  }

  toJSON(): string {
    return `[SecretKey ${this.id}]`;
  }

  toString(): string {
    return `[SecretKey ${this.id}]`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `[SecretKey ${this.id}]`;
  }
}

/** Internal: raw bytes of a key. Not exported from the package index. */
export function keyMaterial(k: SecretKey): Uint8Array {
  const m = MATERIAL.get(k);
  if (!m) throw new Error("unknown key");
  return m;
}
