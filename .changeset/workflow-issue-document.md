---
"@infrabyx/workflow": minor
---

`DocumentIssuer` (templates item 2; R1-D-321): render (DOCGEN) → review or approval (maker-checker) → signing (ESIGN) → archive (STORAGE, REGULATED, write-once with retention), with migration `workflow/0006_document_issue.sql` (expand-only; `workflow.document_issue`, RLS enabled and forced). Register each template as `signing: "required"` (refused without signers, never archived unsigned) or `"none"` (archived only after a person other than its issuer reviews it, or after its approval); a signed document's unsigned render is archived beside it with the same retention (R1-D-318). Register `issuer.approvalPolicy({ checkerRoles })` on `DOCUMENT_ISSUE_ACTION`. Only hashes of the data and the signers are kept. Guide §7fl.
