---
"@infrabyx/connectors": patch
---

WORKFLOW: the personal-data check on workflow ids, names and task queues now looks at whole tokens (split on `.` `_` `:` `-`), so a phone number or PAN used as an id part is still refused while a ULID or hex id that merely contains a PAN-shaped or long digit run is accepted (about 1 % of ULID ids were refused before).
