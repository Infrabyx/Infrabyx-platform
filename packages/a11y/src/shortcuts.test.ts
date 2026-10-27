import { describe, expect, it, vi } from "vitest";
import {
  formatCombo,
  isEditableTarget,
  parseCombo,
  ShortcutRegistry,
  type KeyEventLike,
} from "./shortcuts.js";

const key = (k: string, o: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...o,
});
const textarea = { tagName: "TEXTAREA" };

describe("@IPB-06-AT-14 remappable shortcuts and no single-key triggers in text fields", () => {
  it("typing g in a comment field fires no navigation shortcut while single keys are off", () => {
    const go = vi.fn();
    const reg = new ShortcutRegistry({ singleKeyEnabled: false });
    reg.register("nav.go", "Go to", "g", go);
    expect(reg.handle(key("g", { target: textarea }))).toBeNull();
    expect(reg.handle(key("g", { target: { tagName: "BODY" } }))).toBeNull();
    expect(go).not.toHaveBeenCalled();
    expect(reg.list()[0]).toMatchObject({ combo: "G", active: false });
  });

  it("with single keys on, g fires outside text fields only", () => {
    const go = vi.fn();
    const reg = new ShortcutRegistry({ singleKeyEnabled: true });
    reg.register("nav.go", "Go to", "g", go);
    expect(reg.handle(key("g", { target: textarea }))).toBeNull();
    expect(
      reg.handle(key("g", { target: { tagName: "DIV", getAttribute: () => "textbox" } })),
    ).toBeNull();
    expect(reg.handle(key("g", { target: { tagName: "BODY" } }))).toBe("nav.go");
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("after rebinding Open Work Inbox from Ctrl+I to Ctrl+Shift+W, only the new combo works, including after a reload", () => {
    const open = vi.fn();
    const remaps = { "inbox.open": "Ctrl+Shift+W" };
    const reg = new ShortcutRegistry();
    reg.register("inbox.open", "Open Work Inbox", "Ctrl+I", open);
    reg.configure({ remaps });
    expect(reg.handle(key("i", { ctrlKey: true }))).toBeNull();
    expect(reg.handle(key("W", { ctrlKey: true, shiftKey: true }))).toBe("inbox.open");

    // A reload builds a fresh registry from the stored `a11y.keyboard.remaps`.
    const reloaded = new ShortcutRegistry({ remaps });
    reloaded.register("inbox.open", "Open Work Inbox", "Ctrl+I", open);
    expect(reloaded.handle(key("i", { ctrlKey: true }))).toBeNull();
    expect(reloaded.handle(key("w", { ctrlKey: true, shiftKey: true }))).toBe("inbox.open");
    expect(open).toHaveBeenCalledTimes(2);

    reloaded.configure({ remaps: {} });
    expect(reloaded.handle(key("i", { ctrlKey: true }))).toBe("inbox.open");
  });

  it("rejects a remap that collides with another action and keeps the old bindings", () => {
    const reg = new ShortcutRegistry();
    reg.register("a", "A", "Ctrl+K", () => {});
    reg.register("b", "B", "Ctrl+J", () => {});
    expect(() => reg.configure({ remaps: { b: "Ctrl+K" } })).toThrow(/bound to both/);
    expect(reg.handle(key("j", { ctrlKey: true }))).toBe("b");
    expect(() => reg.register("c", "C", "ctrl+k", () => {})).toThrow(/bound to both/);
  });
});

describe("combos and editable targets", () => {
  it("parses and formats combos", () => {
    expect(parseCombo("Ctrl+Shift+W")).toEqual({
      key: "w",
      ctrl: true,
      alt: false,
      shift: true,
      meta: false,
    });
    expect(formatCombo(parseCombo("cmd+space"))).toBe("Meta+Space");
    expect(() => parseCombo("W+Ctrl")).toThrow(/not a modifier/);
  });

  it("treats text inputs, contenteditable and textbox roles as editable, buttons and checkboxes not", () => {
    expect(isEditableTarget({ tagName: "INPUT", type: "email" })).toBe(true);
    expect(isEditableTarget({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
