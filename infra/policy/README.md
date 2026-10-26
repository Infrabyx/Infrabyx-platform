# infra/policy

Policy-as-code for the platform (IPB-01 §01.4.2): ESLint IPB rules (`eslint/`), and later
Semgrep rules, `migration-lint` rules, `rls-lint`, OPA/Kyverno policies and the GitHub ruleset
export (`github/rulesets.json`, IPB-09 §09.4.1.4).

| Folder    | Check                                                            | IPB                                | Status                                                                                       |
| --------- | ---------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `eslint/` | `ipb/vendor-import`, `ipb/schema-boundary`, `ipb/no-process-env` | IPB-01-14, IPB-01-09/11, IPB-01-19 | PL0 placeholders (path/pattern based); tests in `eslint/rules.test.mjs` (`pnpm test:policy`) |
