---
"@infrabyx/contracts": minor
---

Tenant notification templates (R1-plan M58; R1-D-90): `NotificationClass.variables` (the variables a tenant email template may use); `ResolvedTemplate` email gains `content?: EmailTemplateContent` (subject, plain text, optional HTML with `{{var}}` placeholders, rendered by NOTIFY); `EmailMessage.content?: EmailContent` (rendered subject without line breaks, plain text and optional HTML, sent in place of the vendor template by an adapter with the `content: "native"` capability).
