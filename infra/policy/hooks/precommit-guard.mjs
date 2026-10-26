// Pre-commit guard (IPB-11-09): refuse staged .env* files other than .env.example, and
// SEED_CREDENTIALS.md, wherever they are. Run by lefthook with the staged file list.
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

export function blockedFiles(paths) {
  return paths.filter((p) => {
    const name = basename(p);
    if (name === "SEED_CREDENTIALS.md") return true;
    return name.startsWith(".env") && name !== ".env.example";
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const blocked = blockedFiles(process.argv.slice(2));
  if (blocked.length) {
    process.stderr.write(
      `pre-commit: refusing to commit ${blocked.join(", ")} (IPB-11-09). Environment files and seed credentials never enter git.\n`,
    );
    process.exit(1);
  }
}
