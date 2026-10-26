// pr-checklist (IPB-09-03 / IPB-09-04): every mandatory item in the PR body's IPB conformance
// checklist is ticked, and a Claude-Code branch links its phase plan file.
// Inputs via env (never interpolated into a shell): PR_BODY, HEAD_REF.
const body = process.env.PR_BODY ?? "";
const headRef = process.env.HEAD_REF ?? "";
const fail = (m) => {
  console.error("PR-CHECKLIST FAIL:", m);
  process.exitCode = 1;
};

if (!body.trim()) fail("PR body is empty; use .github/PULL_REQUEST_TEMPLATE.md");

const start = body.indexOf("## IPB conformance checklist");
if (start < 0) fail("PR body lacks the '## IPB conformance checklist' section");
else {
  const rest = body.slice(start);
  const nextHeading = rest.slice(1).search(/\n## /);
  const section = nextHeading >= 0 ? rest.slice(0, nextHeading + 1) : rest;
  const unchecked = section.split("\n").filter((l) => /^\s*[-*]\s+\[ \]/.test(l));
  if (unchecked.length) {
    fail(`${unchecked.length} unchecked mandatory item(s):\n${unchecked.join("\n")}`);
  }
}

if (/^(cc|claude)\//.test(headRef)) {
  if (!/docs\/(phases\/PL\d+-plan\.md|plans\/[\w./-]+\.md)/.test(body)) {
    fail(
      `branch ${headRef} is Claude-Code work; the PR body must link its plan file (docs/phases/PLn-plan.md) (IPB-09-04)`,
    );
  }
  if (!/IPB files read/i.test(body))
    fail("PR body must state which IPB files were read (IPB-09-04)");
}

if (!process.exitCode) console.log("PR-CHECKLIST OK");
