---
"@infrabyx/consent": minor
---

Owner answer #57 (PL5-D-11), with migration `consent/0002_form_consent_end.sql`: a form consent for a marketing lead ends 24 months after the last interaction and the sweep then deletes it on the #48 rule, unless the person has an active relationship or a legal hold applies. `ConsentSubjects` records interactions and relationships (the product reports them) and legal holds (PLT_LEGAL_REVIEWER only). `ConsentPurge.sweep()` also removes status rows with no record left and returns `subjects`.
