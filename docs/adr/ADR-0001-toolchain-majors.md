# ADR-0001 — Dev toolchain majors for PL0

- **Status:** accepted
- **Date:** 2026-10-26
- **Deciders:** owner (PL0 plan approval)
- **IPB sections:** IPB-01-05 (locked majors; majors need an ADR), IPB-02 patch SLA
- **Decision log:** PL0-D-01

## Context

The scaffold declared `eslint ^9.14`, `vitest ^2.1`, `typescript ^5.6`, `turbo ^2.3`, `@changesets/cli ^2.27`. At install time npm marks ESLint 9.x "no longer supported" and Vitest 2.x is end-of-life; IPB-02 requires supported majors so security patches can be applied within SLA. TypeScript 7 (native compiler) and Changesets 3 were also available.

## Decision

| Tool                  | Version          | Why                                                                                         |
| --------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| TypeScript            | 5.9.3            | Supported; TS 7 is a new compiler not yet verified against NestJS 11 / Next.js 16 / Drizzle |
| ESLint + `@eslint/js` | 10.13.0 / 10.0.1 | ESLint 9 unsupported upstream                                                               |
| typescript-eslint     | 8.72.0           | Supports ESLint 10 and TS 5.9                                                               |
| Vitest + Vite         | 4.1.12 / 7.3.7   | Vitest 2 EOL; Vitest 4 is the mature current line (5.0 is days old)                         |
| Prettier              | 3.9.10           | current major                                                                               |
| Turborepo             | 2.11.10          | within the scaffold's `^2`                                                                  |
| Changesets            | 2.31.1           | `changesets/action` v1 tested against 2.x; 3.x deferred                                     |
| `@types/node`         | 24.x             | matches the Node 24.22.1 pin                                                                |

All pinned exactly; Renovate moves minors/patches and blocks majors for `typescript`, `eslint`, `vitest`, `turbo`, `pnpm` (`renovate.json`).

## Verification

`pnpm lint`, `format:check`, `typecheck`, `build`, `test`, `test:policy`, `ipb:check`, `changeset status` green on Node 24.22.1 locally and in CI (PR #1).

## Consequences

Products inherit these majors through `@infrabyx/testing` and the shared ESLint config when those ship (PL1). Moving to TypeScript 7 or Changesets 3 needs a new ADR with the §01.4.1.3-style verification.
