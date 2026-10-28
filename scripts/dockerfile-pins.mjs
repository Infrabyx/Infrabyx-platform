// The Dockerfile part of the pin check (IPB-01-01, @IPB-01-AT-01): every FROM line names its image
// by a sha256 digest, and every Node.js image is the pinned version on bookworm-slim. A FROM of an
// earlier stage of the same file (`FROM base AS deps`) names no image and needs no digest.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SKIP = new Set(["node_modules", "dist", ".next", ".turbo", ".git"]);

/** Every Dockerfile under the given folders. */
export function dockerfiles(root, dirs) {
  const walk = (d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? SKIP.has(e.name)
          ? []
          : walk(join(d, e.name))
        : /^Dockerfile(\..+)?$/.test(e.name)
          ? [join(d, e.name)]
          : [],
    );
  return dirs.flatMap((d) => {
    try {
      return walk(join(root, d));
    } catch {
      return [];
    }
  });
}

/** The pin problems of one Dockerfile's text. */
export function fromLineProblems(text, nodePin) {
  const stages = new Set();
  const problems = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i);
    if (!m) continue;
    const [, image, alias] = m;
    if (!stages.has(image.toLowerCase())) {
      if (!/@sha256:[0-9a-f]{64}$/.test(image))
        problems.push(`FROM ${image} must name a sha256 digest`);
      if (
        /^(docker\.io\/)?(library\/)?node:/i.test(image) &&
        image.split("@")[0] !== `node:${nodePin}-bookworm-slim`
      )
        problems.push(`FROM ${image} must be node:${nodePin}-bookworm-slim@sha256:<digest>`);
    }
    if (alias) stages.add(alias.toLowerCase());
  }
  return problems;
}

/** Every problem of every Dockerfile under the folders, as "<file>: <problem>". */
export function dockerfilePinProblems(root, dirs, nodePin) {
  return dockerfiles(root, dirs).flatMap((f) =>
    fromLineProblems(readFileSync(f, "utf8"), nodePin).map(
      (p) => `${f.slice(root.length + 1)}: ${p}`,
    ),
  );
}
