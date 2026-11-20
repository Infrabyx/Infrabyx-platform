---
"@infrabyx/contracts": minor
"@infrabyx/config": minor
"@infrabyx/connectors": minor
"@infrabyx/notify": minor
"@infrabyx/testing": minor
---

Borrower email with byte-identical attachments and a delivery receipt, and the verified email (Udofin PR-UDF-055; R1-D-224). `contracts`: `NotificationRequest.attachments` (`NotificationAttachment`: STORAGE key, SHA-256, file name, PDF, PNG or JPEG; at most 10), `DeliveryRecord.vendorRef` and `DeliveryRecord.attachments` (the receipt), `EmailMessage.files` (`EmailAttachment`: verified bytes, sent unchanged, only to an adapter with `attachments: "native"`), `EMAIL_ATTACHMENT_LIMITS`, `EMAIL_ATTACHMENT_MEDIA_TYPES`, `emailAttachmentTypeOf`, `attachmentExtensionFits`; optional `CustomerIdentityPort.startEmailVerification`, `confirmEmailVerification` and `verifiedEmail` (`VerifiedCustomerEmail`). `config`: the settings `ntf.email.attachments.enabled` (tenant), `ntf.email.attachments.confidential` and `int.identity.customer.email_capture.enabled` (platform), all off. `notify`: attachments read from STORAGE at send and checked (class, type, SHA-256, 10 MiB) before the adapter; the receipt in `deliveryStatus`; migration `0008_email_attachments` (two nullable columns; expand-only). `connectors`: `ses` and `brevo` take `files` and check each SHA-256 again; the verified-email capture in the customer IDENTITY adapters (`emailCapture` option, `readCustomerEmailCapture`, `CustomerAuthStore.saveVerifiedEmail` and `verifiedEmail`, optional); migration `0015_customer_verified_email` (expand-only). `testing`: the SES and Brevo stubs record each attachment's SHA-256. Everything is off by default; nothing existing changes. Apply `notify/0008` and `connectors/0015` before turning either feature on.
