# ADR-0002 — Move the package manager from pnpm 9 to pnpm 10

- **Status:** accepted (owner, 2026-10-26; deviation IPB-DEV-02 against IPB-01-05)
- **Date:** 2026-10-26
- **Deciders:** owner (`@infrabyx/platform-owners`)
- **IPB sections:** IPB-01-05 (pnpm 9 locked; a major upgrade requires an ADR), IPB-01-04 / IPB-02 patch SLA (high: 7 days)
- **Trigger:** Renovate security PR #5 (closed 2026-10-26 by owner decision; majors go through an ADR)

## Context

The npm advisory database (queried 2026-10-26 through `registry.npmjs.org/-/npm/v1/security/advisories/bulk`) reports **25 advisories against pnpm 9.15.4, 12 of them high**. The same 25 apply to **9.15.9, the last 9.x release (10 March 2025)**. Every advisory is fixed only in 10.x; `pnpm@10.34.5` and later report none. There is therefore no 9.x patch to apply, and the IPB-02 7-day patch SLA for high findings cannot be met on pnpm 9.

| Severity | Count | Fixed in          | Examples                                                                                                                                                                                                                                                                                                        |
| -------- | ----- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| high     | 12    | 10.26.0 – 10.34.5 | GHSA-c59q-g84q-2gj5 virtual-store path traversal; GHSA-vq4v-j7r6-jq4m tarball manifest name escapes node_modules; GHSA-7vhp-vf5g-r2fw lockfile integrity bypass for remote tarballs; GHSA-2phv-j68v-wwqx command injection via env substitution; GHSA-5wx6-mg75-v57r manifest identity spoof runs build scripts |
| moderate | 13    | 10.0.0 – 10.34.2  | GHSA-8cc4-rfj6-fhg4 md5 path collisions; GHSA-cjhr-43r9-cfmw npm auth credentials bound to a repository-selected registry                                                                                                                                                                                       |

Exposure today: CI installs only registry tarballs pinned with integrity hashes from a committed lockfile; no git, tarball-URL or `file:` dependencies; no `configDependencies` or patches. Most of the advisories need a malicious package or repository config to be pulled in, so the practical risk is a supply-chain path, which is exactly what IPB-02 asks us to close.

## Decision

Move to **pnpm 10.34.7**: the newest 10.x release older than the 3-day `minimumReleaseAge` (IPB-02-33) on 2026-10-26; 10.34.8 and 10.34.9 were younger. All three report no advisories. Keep `engines.pnpm` as the major (`"10"`), `packageManager: pnpm@10.34.7` (exact), and update CLAUDE.md "pnpm 9" to "pnpm 10" with a pointer here. IPB-01-05 itself names pnpm 9; the ADR is the route that clause defines, and the owner may additionally record it in `docs/platform-requests.md` for the next IPB revision.

## Verification to run before accepting

1. `packageManager: pnpm@10.34.7`, regenerate `pnpm-lock.yaml` (lockfile v9 format is shared by pnpm 9 and 10; expect only `libc` fields added, as in PR #5).
2. pnpm 10 behaviour changes to check: dependency lifecycle scripts are blocked unless listed in `onlyBuiltDependencies` (esbuild needs listing); `pnpm link` and hoisting defaults; `node-linker=isolated` unchanged.
3. Full CI: lint, format, typecheck, build, test, policy-rules, licence, ipb-check, frozen install; release workflow dry run.
4. `pnpm/action-setup` reads the version from `packageManager`; `ipb:check` pin rule changes from `pnpm@9.` to `pnpm@10.`.

## Verification result (2026-10-26)

Lockfile regenerated with pnpm 10.34.7; `onlyBuiltDependencies` lists `esbuild`; lint, format, typecheck, build, test, policy-rules, licence, ipb-check and frozen install pass on Node 24.22.1 (PL1 branch, first commit).

## Consequences

Products install `@infrabyx/*` with any pnpm; no consumer impact. Renovate's runtime rule keeps pnpm majors out of automated PRs, so pnpm 11 will again need an ADR.
