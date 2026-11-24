---
"@infrabyx/tenancy": minor
---

R1-D-283 (owner answer #201 (1), PR-UDF-083). The partner's original signed body is `REGULATED`, the class of the mapped `envelope` whose lender data it carries: migration `tenancy/0030` replaces `tenancy.add_ecosystem_inbox_original(...)` so new inboxes tag `<schema>.eco_inbox.original` `dataclass:REGULATED`, and retags the column of every inbox where tenancy 0029's `dataclass:INTERNAL` stands (a class a product set itself is left). A comment change only: the column, checks, trigger, grants and readers are 0029's. Product step: run `infrabyx-migrate` (0030); export, masking and AI-routing rules that read column classes now treat `original` as `envelope` (guide §7eu).
