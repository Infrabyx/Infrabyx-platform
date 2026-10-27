// Carries a handler's result across the post-redirect-get without JavaScript: the app redirects to
// `?r=<encoded>` and the screen decodes it. Text only, size-capped; a tampered value decodes to null
// (it holds no authority, only words to show).
import type { FieldError, Flash, StudioResult } from "./types.js";

const MAX = 4096;
const TONES = new Set(["success", "warning", "danger", "info"]);

const toB64Url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromB64Url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
};

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : undefined);

/** Encode a result for the redirect query (`flash`, `errors`, `reveal`; not `redirectTo`). */
export function encodeResult(r: StudioResult): string {
  const v = toB64Url(
    JSON.stringify({
      f: r.flash,
      e: (r.errors ?? []).slice(0, 20),
      ...(r.reveal ? { v: r.reveal } : {}),
    }),
  );
  return v.length > MAX ? toB64Url(JSON.stringify({ f: r.flash })) : v;
}

/** Decode `?r=`; anything malformed is null. */
export function decodeResult(
  raw: string | null | undefined,
): { flash: Flash; errors: FieldError[]; reveal?: string } | null {
  if (!raw || raw.length > MAX || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const o = JSON.parse(fromB64Url(raw)) as {
      f?: Record<string, unknown>;
      e?: unknown;
      v?: unknown;
    };
    const tone = str(o.f?.["tone"]);
    const title = str(o.f?.["title"], 200);
    if (!tone || !TONES.has(tone) || !title) return null;
    const detail = str(o.f?.["detail"]);
    const errors = (Array.isArray(o.e) ? o.e : [])
      .map((x: { fieldId?: unknown; message?: unknown }) => ({
        fieldId: str(x?.fieldId, 100),
        message: str(x?.message, 300),
      }))
      .filter((x): x is FieldError => Boolean(x.fieldId && x.message));
    const reveal = str(o.v, 1000);
    return {
      flash: { tone: tone as Flash["tone"], title, ...(detail ? { detail } : {}) },
      errors,
      ...(reveal ? { reveal } : {}),
    };
  } catch {
    return null;
  }
}
