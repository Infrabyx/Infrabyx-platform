// `prepare`: installs the git hooks (PL1-D-17) in a git checkout. Skipped where there is no `.git`
// (a container build context) or when LEFTHOOK=0 says hooks are off (CI, image builds).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (process.env.LEFTHOOK === "0" || !existsSync(".git")) {
  console.log("prepare: git hooks not installed (no checkout, or LEFTHOOK=0)");
} else {
  execFileSync("lefthook", ["install"], { stdio: "inherit" });
}
