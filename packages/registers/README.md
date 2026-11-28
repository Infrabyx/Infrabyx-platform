# @infrabyx/registers

Regulatory registers (ADR-0016; regulatory templates item (a), part 2). Specified by IPB-14 §14.2 (spec request PR-052), IPB-01-09 (module = schema), IPB-02-12 and IPB-02-19 (RLS, data classes), IPB-10 (lists and cursors). Private (`0.0.0`) until its exit; 1.0.0 waits for the owner.

- `RegisterStore`: `define(definition)`, `create`, `correct` (a new version), `get`, `versions`, `history` (versions and ledger entries), `list` (filters on column values, keyset cursor) and `refreshApproval`.
- Maker-checker per change: register `store.approvalPolicy({ checkerRoles })` on `REGISTER_ROW_ACTION`.
- Migration `registers/0001_init.sql`: `registers.row_version`, RLS enabled and forced. A trigger refuses deleting a version before its retention date and refuses any change of a version's content; truncation is refused. There is no purge.
- Values up to CONFIDENTIAL; a definition with a REGULATED column is refused.

Guide §7fn.
