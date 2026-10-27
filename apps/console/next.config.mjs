// Next.js configuration for the reference Studio console (PL5 plan §9.6), as for the group site.
// - images.unoptimized: Next's image optimiser would load `sharp`; libvips is used only through
//   the MEDIA port (OWNER-QUESTIONS #53), so pages use the CMS renditions and plain <img>.
// - The server-only platform packages run as plain Node modules, not bundled: they read their
//   shipped files (policy templates, the help registry, the claims word list) relative to
//   themselves. pnpm links workspace packages outside node_modules, so `serverExternalPackages`
//   alone does not catch them; the webpack build (`next build --webpack`) marks them external.
//   `ui` is bundled with the pages.
const SERVER_ONLY = [
  "@infrabyx/audit",
  "@infrabyx/brand",
  "@infrabyx/cms",
  "@infrabyx/config",
  "@infrabyx/consent",
  "@infrabyx/contracts",
  "@infrabyx/crypto",
  "@infrabyx/tenancy",
  "@infrabyx/testing",
  "@infrabyx/feedback",
  "@infrabyx/trust",
];
const external = (request) =>
  request === "pg" || SERVER_ONLY.some((p) => request === p || request.startsWith(`${p}/`));

/** @type {import("next").NextConfig} */
const config = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true },
  // Metadata (the <title>) is rendered in <head> for every client, not streamed into <body>
  // (IPB-06 SC 2.4.2; HTML_CodeSniffer H25).
  htmlLimitedBots: /.*/,
  serverExternalPackages: ["pg", ...SERVER_ONLY],
  webpack(cfg, { isServer }) {
    if (isServer)
      cfg.externals = [
        ...(Array.isArray(cfg.externals) ? cfg.externals : cfg.externals ? [cfg.externals] : []),
        ({ request }, callback) =>
          external(request) ? callback(null, `module ${request}`) : callback(),
      ];
    return cfg;
  },
};
export default config;
