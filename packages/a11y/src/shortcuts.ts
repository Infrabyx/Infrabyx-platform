// Keyboard shortcuts (WCAG 2.2 SC 2.1.4; IPB-06 §06.3.5, `@IPB-06-AT-14`). Single-character
// shortcuts are off unless `a11y.keyboard.single_key_enabled` is true, and never fire while focus
// is in a text field. Every action can be remapped through `a11y.keyboard.remaps`
// (`{ "<action id>": "Ctrl+Shift+W" }`); a remapped action no longer answers its default combo.

export interface KeyCombo {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/** The fields of a KeyboardEvent the registry reads (a DOM event satisfies it). */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  target?: unknown;
  isComposing?: boolean;
  preventDefault?: () => void;
}

const MODIFIERS: Record<string, keyof Omit<KeyCombo, "key">> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
  meta: "meta",
  cmd: "meta",
  command: "meta",
};

/** "Ctrl+Shift+W" → `{ key: "w", ctrl: true, shift: true, … }`. */
export function parseCombo(text: string): KeyCombo {
  const parts = text
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error(`empty shortcut: "${text}"`);
  const combo: KeyCombo = { key: "", ctrl: false, alt: false, shift: false, meta: false };
  for (const [i, raw] of parts.entries()) {
    const p = raw.toLowerCase();
    const mod = MODIFIERS[p];
    if (mod && i < parts.length - 1) combo[mod] = true;
    else if (i === parts.length - 1) combo.key = p === "space" ? " " : p;
    else throw new Error(`"${raw}" is not a modifier in "${text}"`);
  }
  return combo;
}

export function formatCombo(c: KeyCombo): string {
  const mods = [c.ctrl && "Ctrl", c.alt && "Alt", c.shift && "Shift", c.meta && "Meta"].filter(
    Boolean,
  );
  const key = c.key === " " ? "Space" : c.key.length === 1 ? c.key.toUpperCase() : c.key;
  return [...mods, key].join("+");
}

/** A printable single key with no Ctrl, Alt or Meta (Shift alone still types a character). */
export const isSingleKey = (c: KeyCombo) => !c.ctrl && !c.alt && !c.meta && [...c.key].length === 1;

export function comboMatches(c: KeyCombo, e: KeyEventLike): boolean {
  const key = e.key.toLowerCase();
  return (
    key === c.key &&
    e.ctrlKey === c.ctrl &&
    e.altKey === c.alt &&
    e.metaKey === c.meta &&
    // For a printable key Shift is part of the character typed; compare it only for named keys.
    ([...c.key].length === 1 && !c.ctrl && !c.alt && !c.meta ? true : e.shiftKey === c.shift)
  );
}

const TEXT_INPUT_TYPES = new Set([
  "",
  "text",
  "search",
  "email",
  "tel",
  "url",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);
const TEXT_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

/** True when typing in the target produces text (inputs, textareas, selects, contenteditable). */
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const t = target as {
    tagName?: string;
    type?: string;
    isContentEditable?: boolean;
    getAttribute?: (n: string) => string | null;
  };
  const tag = (t.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return TEXT_INPUT_TYPES.has((t.type ?? "").toLowerCase());
  if (t.isContentEditable) return true;
  const role = t.getAttribute?.("role");
  return role ? TEXT_ROLES.has(role) : false;
}

export interface ShortcutOptions {
  /** `a11y.keyboard.single_key_enabled` (default false). */
  singleKeyEnabled?: boolean;
  /** `a11y.keyboard.remaps`: action ID → combo text. */
  remaps?: Readonly<Record<string, string>>;
}

interface Binding {
  id: string;
  label: string;
  defaultCombo: KeyCombo;
  combo: KeyCombo;
  handler: () => void;
}

export class ShortcutRegistry {
  private readonly bindings = new Map<string, Binding>();
  private singleKeyEnabled: boolean;
  private remaps: Readonly<Record<string, string>>;

  constructor(o: ShortcutOptions = {}) {
    this.singleKeyEnabled = o.singleKeyEnabled ?? false;
    this.remaps = o.remaps ?? {};
  }

  /** Apply new settings (after the person changes them); existing registrations rebind. */
  configure(o: ShortcutOptions): void {
    const before = {
      single: this.singleKeyEnabled,
      remaps: this.remaps,
      all: [...this.bindings.values()],
    };
    if (o.singleKeyEnabled !== undefined) this.singleKeyEnabled = o.singleKeyEnabled;
    if (o.remaps) this.remaps = o.remaps;
    try {
      this.bindings.clear();
      for (const b of before.all)
        this.bindings.set(b.id, { ...b, combo: this.resolve(b.id, b.defaultCombo) });
      this.assertNoConflict();
    } catch (e) {
      // A conflicting remap leaves the previous bindings in place.
      this.singleKeyEnabled = before.single;
      this.remaps = before.remaps;
      this.bindings.clear();
      for (const b of before.all) this.bindings.set(b.id, b);
      throw e;
    }
  }

  /** Register an action with its default combo; returns an unregister function. */
  register(id: string, label: string, defaultCombo: string, handler: () => void): () => void {
    if (this.bindings.has(id)) throw new Error(`shortcut action ${id} is already registered`);
    const parsed = parseCombo(defaultCombo);
    this.bindings.set(id, {
      id,
      label,
      defaultCombo: parsed,
      combo: this.resolve(id, parsed),
      handler,
    });
    try {
      this.assertNoConflict();
    } catch (e) {
      this.bindings.delete(id);
      throw e;
    }
    return () => this.bindings.delete(id);
  }

  /** The combo each action answers, for the shortcuts help sheet (IPB-07). */
  list(): { id: string; label: string; combo: string; active: boolean }[] {
    return [...this.bindings.values()].map((b) => ({
      id: b.id,
      label: b.label,
      combo: formatCombo(b.combo),
      active: !isSingleKey(b.combo) || this.singleKeyEnabled,
    }));
  }

  /** Handle a keydown; returns the action ID that fired, or null. */
  handle(e: KeyEventLike): string | null {
    if (e.isComposing) return null;
    for (const b of this.bindings.values()) {
      if (!comboMatches(b.combo, e)) continue;
      if (isSingleKey(b.combo) && (!this.singleKeyEnabled || isEditableTarget(e.target)))
        return null;
      e.preventDefault?.();
      b.handler();
      return b.id;
    }
    return null;
  }

  private resolve(id: string, fallback: KeyCombo): KeyCombo {
    const remap = this.remaps[id];
    return remap ? parseCombo(remap) : fallback;
  }

  private assertNoConflict(): void {
    const seen = new Map<string, string>();
    for (const b of this.bindings.values()) {
      const k = formatCombo(b.combo);
      const other = seen.get(k);
      if (other) throw new Error(`shortcut ${k} is bound to both ${other} and ${b.id}`);
      seen.set(k, b.id);
    }
  }
}
