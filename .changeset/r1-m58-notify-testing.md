---
"@infrabyx/testing": minor
---

EMAIL stubs (R1-plan M58; R1-D-90): the SES v2 stub accepts simple-content sends and records them (`simple`); the Brevo stub accepts sends without a template (`subject` and `htmlContent` required, `textContent` optional) and records them, so `BrevoStubMessage.templateId` is now optional.
