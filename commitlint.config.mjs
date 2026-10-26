// IPB-09-19: conventional commits, scope = package or app; breaking changes marked with `!`.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "perf",
        "refactor",
        "docs",
        "chore",
        "test",
        "build",
        "ci",
        "revert",
        "style",
      ],
    ],
    "header-max-length": [2, "always", 100],
    "body-max-line-length": [2, "always", 120],
    "footer-max-line-length": [2, "always", 120],
  },
  ignores: [
    // Merge commits from the base branch and the Changesets release PR.
    (msg) => /^Merge /.test(msg),
  ],
};
