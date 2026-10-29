---
"@infrabyx/config": minor
---

Saved table views and column layouts (Finbyx PR-FBX-09; IPB-07-13; R1-D-32). Migration `config/0002` adds `config.saved_view` and `config.table_layout` under forced RLS (personal views and layouts are their owner's alone). `SavedViews` (`@infrabyx/config/views`) lists, saves, updates (with the version read), removes and resolves the default view, and keeps the column chooser state; views are personal or shared with a team, tenant roles or the tenant, following `ux.tables.saved_views_shared`, with roles and tenant views and the tenant default for ORG_ADMIN or ORG_OWNER; filter values search would refuse are refused; every change is ledgered. Run `infrabyx-migrate`.
