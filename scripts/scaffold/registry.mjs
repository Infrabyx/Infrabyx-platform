#!/usr/bin/env node
// A local npm registry for the `scaffold` CI job (PL6 plan §9.1): serves the packed @infrabyx/*
// tarballs of this checkout over the npm registry protocol (the packument at /<name>, the tarball
// under /-/), so a scaffolded product installs the packages the way it will from GitHub Packages,
// with no external account. It serves the scope only; everything else comes from the public
// registry through the product's `.npmrc`.
//   node scripts/scaffold/registry.mjs --dir <folder of .tgz from `pnpm pack`> [--port 4873]
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";

const ROOT = new URL("../..", import.meta.url).pathname;

/** name → { version, manifest, file, integrity } from the packed tarballs. */
export async function loadTarballs(dir) {
  const { sha256Base64 } = await hashers();
  const out = new Map();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".tgz"))) {
    const file = join(dir, f);
    const manifest = JSON.parse(
      execFileSync("tar", ["-xzOf", file, "package/package.json"], { encoding: "utf8" }),
    );
    const body = readFileSync(file);
    out.set(manifest.name, {
      version: manifest.version,
      manifest,
      file,
      integrity: `sha256-${sha256Base64(body)}`,
    });
  }
  return out;
}

/** The tarball digest of the packument (`dist.integrity`, a Subresource Integrity value). */
async function hashers() {
  const { sha256 } = await import(join(ROOT, "packages/crypto/dist/index.js"));
  return { sha256Base64: (b) => Buffer.from(sha256(new Uint8Array(b))).toString("base64") };
}

export function packument(name, p, base) {
  const tarball = `${base}/-/${encodeURIComponent(name)}/${p.version}.tgz`;
  return {
    name,
    "dist-tags": { latest: p.version },
    versions: {
      [p.version]: {
        ...p.manifest,
        _id: `${name}@${p.version}`,
        dist: { tarball, integrity: p.integrity },
      },
    },
    time: { created: new Date(0).toISOString(), [p.version]: new Date(0).toISOString() },
  };
}

export function startRegistry(packages, port = 0) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const base = `http://127.0.0.1:${server.address().port}`;
      const send = (status, body, type = "application/json") => {
        res.writeHead(status, { "content-type": type });
        res.end(body);
      };
      const tar = /^\/-\/([^/]+)\/([^/]+)\.tgz$/.exec(url.pathname);
      if (tar) {
        const p = packages.get(decodeURIComponent(tar[1]));
        if (!p || p.version !== tar[2]) return send(404, '{"error":"not found"}');
        return send(200, readFileSync(p.file), "application/octet-stream");
      }
      const name = decodeURIComponent(url.pathname.slice(1));
      const p = packages.get(name);
      if (!p) return send(404, '{"error":"not found"}');
      return send(200, JSON.stringify(packument(name, p, base)));
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: { dir: { type: "string" }, port: { type: "string", default: "4873" } },
  });
  if (!values.dir) {
    console.error("usage: node scripts/scaffold/registry.mjs --dir <packs> [--port 4873]");
    process.exit(2);
  }
  const pkgs = await loadTarballs(values.dir);
  const server = await startRegistry(pkgs, Number(values.port));
  console.log(
    `registry: ${pkgs.size} packages at http://127.0.0.1:${server.address().port} (${[...pkgs.keys()].join(", ")})`,
  );
}
