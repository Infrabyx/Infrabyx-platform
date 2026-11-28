// @infrabyx/registers — regulatory registers (ADR-0016): a versioned, tenant-scoped row store with
// RLS, a retention trigger (no row deleted before its date, no purge) and maker-checker per row,
// driven by `@infrabyx/contracts/registers` `RegisterDefinition`. Private until its exit.
// Migration: `registers/0001_init.sql`, applied by `infrabyx-migrate` when this package is installed.
export const PACKAGE_NAME = "@infrabyx/registers" as const;
export * from "./store.js";
