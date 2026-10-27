---
"@infrabyx/cms": minor
---

Resources, forms and pricing (PL5 session 5b), with migration `cms/0003_resources_forms.sql`.

- **`ResourceService`:**
  - versions at `?v=`, with cite-as text;
  - withdrawal of a version;
  - gated downloads (public, email gate, login, plan) served by 300-second presigned URLs;
  - download records that keep the CRM lead reference;
  - `ResourceReviewDue`.
- **`FormService`:** consent comes before the hand-off to CRM, HR or SUPPORT, and no field values are stored.
- **`PricingService`:**
  - catalogue-only prices with GST labels;
  - a 5-minute cache and a 24-hour stale limit;
  - a drip-pricing and false-urgency lint, wired through the new `CmsStudio` option `extraLint`.
- **Media:** `MediaLibrary.upload({ gated: true })` stores the file in a private bucket.
- **Pricing copy:** `pricing_copy` is now a strict schema with no price field.
