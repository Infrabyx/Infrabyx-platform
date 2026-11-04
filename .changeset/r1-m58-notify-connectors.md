---
"@infrabyx/connectors": minor
---

EMAIL (R1-plan M58; R1-D-90): `ses` and `brevo` send `EmailMessage.content` (a tenant's rendered subject, plain text and optional HTML) in place of the vendor template, as SES simple content and as Brevo's `subject`, `textContent` and `htmlContent` (a text-only message gets its text escaped as the HTML body), and declare the capability `content: "native"`.
