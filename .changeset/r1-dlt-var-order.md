---
"@infrabyx/contracts": minor
"@infrabyx/notify": patch
---

SMS and WhatsApp template values in the template's order (Udofin PR-UDF-025; R1-D-54). The stored variables lost their order in `jsonb`, so a positional DLT template could receive them shuffled. `templates.sms.vars` and `templates.whatsapp.vars` (optional) name the order; a missing named variable fails the delivery instead of sending; without a list, names sort naturally (`v1`, `v2`, … `v10`).
