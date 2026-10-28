// Next.js configuration for the reference web app (PL6 plan §8.1), as for the console:
// - images.unoptimized: Next's image optimiser would load `sharp`; libvips is used only through the
//   MEDIA port (OWNER-QUESTIONS #53), and this app shows no optimised images.
// - The server-only platform packages run as plain Node modules, not bundled (pnpm links workspace
//   packages outside node_modules, so the webpack build marks them external). `ui` is bundled.
const SERVER_ONLY = [
  "@infrabyx/cms",
  "@infrabyx/config",
  "@infrabyx/contracts",
  "@infrabyx/crypto",
];
const external = (request) => SERVER_ONLY.some((p) => request === p || request.startsWith(`${p}/`));

/** @type {import("next").NextConfig} */
const config = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true },
  // Metadata (the <title>) is rendered in <head> for every client (IPB-06 SC 2.4.2).
  htmlLimitedBots: /.*/,
  serverExternalPackages: SERVER_ONLY,
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
