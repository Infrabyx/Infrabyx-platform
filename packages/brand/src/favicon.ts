// Favicon set and web manifest (IPB-04-22, `@IPB-04-AT-22` at file level). `icon.svg` is the
// sanitised logo; the PNG sizes are rasterised from it through the MEDIA port when re-encoding is
// on (OWNER-QUESTIONS #53, `BrandStudio.uploadLogo`), or come from an uploaded PNG master, so
// `favicon.ico` and the PNGs are listed only when present.
import type { BrandPackBody, MediaRef } from "./shape.js";

export interface FaviconFile {
  path: string;
  contentType: string;
  /** Inline content for generated files; a media reference for uploaded ones. */
  body?: string;
  media?: MediaRef;
}

export interface FaviconSet {
  files: FaviconFile[];
  /** What a complete IPB-04-22 set still lacks (shown in Studio; never blocks on PNGs, #43, #53). */
  missing: string[];
}

const PNG_FILES: Record<string, string> = {
  "180": "apple-touch-icon.png",
  "192": "icon-192.png",
  "512": "icon-512.png",
};

export function webManifest(body: BrandPackBody, themeColour: string): Record<string, unknown> {
  const icons: Record<string, unknown>[] = [
    { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
  ];
  const png = body.logo?.png ?? {};
  if (png["192"]) icons.push({ src: "/icon-192.png", type: "image/png", sizes: "192x192" });
  if (png["512"]) {
    icons.push({ src: "/icon-512.png", type: "image/png", sizes: "512x512" });
    icons.push({ src: "/icon-512.png", type: "image/png", sizes: "512x512", purpose: "maskable" });
  }
  return {
    name: body.app_name,
    short_name: body.app_name.length > 12 ? body.app_name.slice(0, 12).trim() : body.app_name,
    icons,
    theme_color: themeColour,
    background_color: body.tokens.colour.surface,
    display: "standalone",
    start_url: "/",
  };
}

/** The set served per host. `svg` is the sanitised logo text. */
export function faviconSet(
  body: BrandPackBody,
  svg: string | null,
  themeColour: string,
): FaviconSet {
  const files: FaviconFile[] = [];
  const missing: string[] = [];
  if (svg) files.push({ path: "/icon.svg", contentType: "image/svg+xml", body: svg });
  else missing.push("/icon.svg");
  files.push({
    path: "/site.webmanifest",
    contentType: "application/manifest+json",
    body: `${JSON.stringify(webManifest(body, themeColour), null, 2)}\n`,
  });
  const png = body.logo?.png ?? {};
  for (const [size, path] of Object.entries(PNG_FILES)) {
    const ref = png[size as keyof typeof png];
    if (ref) files.push({ path: `/${path}`, contentType: "image/png", media: ref });
    else missing.push(`/${path}`);
  }
  if (png["32"]) files.push({ path: "/favicon.ico", contentType: "image/png", media: png["32"] });
  else missing.push("/favicon.ico");
  return { files, missing };
}
