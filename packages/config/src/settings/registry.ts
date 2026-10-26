// Runtime view of the generated registry: exact keys first, then templated patterns.
import { IpbError } from "@infrabyx/contracts/errors";
import { SETTING_DEFS, type SettingKey } from "./registry.generated.js";
import type { SettingDef } from "./types.js";

export class SettingsRegistry {
  private readonly exact = new Map<string, SettingDef>();
  private readonly patterns: Array<{ re: RegExp; def: SettingDef }> = [];

  constructor(defs: readonly SettingDef[] = SETTING_DEFS) {
    for (const d of defs) {
      if (d.pattern) this.patterns.push({ re: new RegExp(d.pattern), def: d });
      else this.exact.set(d.key, d);
    }
  }

  /** The definition for a key, or undefined when unregistered. */
  find(key: string): SettingDef | undefined {
    return this.exact.get(key) ?? this.patterns.find((p) => p.re.test(key))?.def;
  }

  /** Throws IPB-UX-007 for an unregistered key (IPB-07-36; @IPB-07-AT-05). */
  require(key: string): SettingDef {
    const d = this.find(key);
    if (!d)
      throw new IpbError("IPB-UX-007", {
        detail: `setting "${key}" is not registered in settings-tree.yaml`,
        meta: { key },
      });
    return d;
  }

  isRegistered(key: string): key is SettingKey {
    return this.find(key) !== undefined;
  }

  all(): SettingDef[] {
    return [...this.exact.values(), ...this.patterns.map((p) => p.def)];
  }
}

export const defaultRegistry = new SettingsRegistry();
