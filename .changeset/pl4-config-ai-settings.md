---
"@infrabyx/config": minor
---

The `ai.*` and `vidhi.*` settings keys of IPB-03 §03.5 (232 keys in the registry), with content capture locked off, plus `trust.privacy.cross_border_ai_allowed` (default false) and the token caps used while model prices are unset (PL4-D-02).

New settings field `mc_deactivate` (bool keys only): switching an explicit `true` to `false` needs maker-checker at that class, while every other change applies at once. The four `ai.kill.*` keys use it with `tighten: true`, so a kill switch turns on immediately, needs an R2 checker to turn off, and a lower tier can never switch off a higher one (IPB-03-48).
