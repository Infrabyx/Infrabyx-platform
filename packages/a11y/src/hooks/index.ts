"use client";
// Client hooks for accessibility preferences (IPB-06 §06.4.1). Each has a server snapshot, so a
// server-rendered page shows the defaults and hydrates without a mismatch. The settings values
// (`a11y.motion.reduced`, `a11y.text.scale`, `a11y.keyboard.*`) arrive as props or attributes on
// the root element; the OS preference applies until the person chooses.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { ShortcutRegistry, type ShortcutOptions } from "../shortcuts.js";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeRoot(cb: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", cb);
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-motion", "data-text-scale", "style", "class"],
  });
  return () => {
    mq.removeEventListener("change", cb);
    mo.disconnect();
  };
}

/** True when motion should stop: `data-motion` on the root wins, then the OS (IPB-06-34). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeRoot,
    () => {
      const attr = document.documentElement.dataset["motion"];
      if (attr === "reduced") return true;
      if (attr === "full") return false;
      return window.matchMedia(REDUCED_MOTION).matches;
    },
    () => false,
  );
}

/** The text scale in per cent (100 to 200; `a11y.text.scale`), from the root font size. */
export function useTextScale(): number {
  return useSyncExternalStore(
    subscribeRoot,
    () => {
      const attr = Number(document.documentElement.dataset["textScale"]);
      if (Number.isFinite(attr) && attr >= 100) return attr;
      const px = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return Number.isFinite(px) ? Math.round((px / 16) * 100) : 100;
    },
    () => 100,
  );
}

/**
 * `announce(message, politeness)` writes to the page's live region (the `LiveRegion` component
 * from `@infrabyx/ui`, found by ID), clearing it first so a repeated message is read again.
 */
export function useAnnounce(ids: { polite?: string; assertive?: string } = {}) {
  const politeId = ids.polite ?? "ibx-live-polite";
  const assertiveId = ids.assertive ?? "ibx-live-assertive";
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(
    (message: string, politeness: "polite" | "assertive" = "polite") => {
      const el = document.getElementById(politeness === "assertive" ? assertiveId : politeId);
      if (!el) return;
      el.textContent = "";
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        el.textContent = message;
      }, 50);
    },
    [politeId, assertiveId],
  );
}

let shared: ShortcutRegistry | undefined;
let listening = false;

/** The page's one shortcut registry, listening on `keydown` at the document. */
export function shortcutRegistry(o?: ShortcutOptions): ShortcutRegistry {
  shared ??= new ShortcutRegistry(o);
  if (o) shared.configure(o);
  if (!listening && typeof document !== "undefined") {
    document.addEventListener("keydown", (e) => shared?.handle(e));
    listening = true;
  }
  return shared;
}

/**
 * Bind an action to a shortcut for the component's lifetime. Single-key combos only fire when the
 * person has turned them on and focus is not in a text field (`@IPB-06-AT-14`).
 */
export function useShortcut(
  id: string,
  label: string,
  defaultCombo: string,
  handler: () => void,
  options?: ShortcutOptions,
): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const remapKey = JSON.stringify(options?.remaps ?? {});
  const single = options?.singleKeyEnabled;
  useEffect(() => {
    const reg = shortcutRegistry(
      single === undefined
        ? { remaps: JSON.parse(remapKey) as Record<string, string> }
        : { singleKeyEnabled: single, remaps: JSON.parse(remapKey) as Record<string, string> },
    );
    return reg.register(id, label, defaultCombo, () => ref.current());
  }, [id, label, defaultCombo, single, remapKey]);
}
