# Runbook — messaging vendor checklist (DLT, MSG91, Gupshup, Meta)

**For:** the owner · **Decisions:** PL2-D-17 (D-07), IPB-DEV-03, IPB-DEV-05 · **Latest by:** before PL2 session 6 (EMAIL, SMS, WHATSAPP) for the sandbox legs to count at the exit gate. The weekly live SMS starts only after DLT registration is complete. None of this blocks the PL2 publish (IPB-DEV-04).

The legal entity throughout is **Infrabyx Consultancy OPC Private Limited** (OWN-02):

- CIN U74999RJ2020OPC071204
- GSTIN 08AAFCI8364M1ZX

Values go only into the GitHub environment `sandbox` under the names below. Never put them in chat, email or a file in the repository.

## 1. DLT principal-entity registration (TRAI TCCCPR 2018)

- [ ] Choose **one** operator DLT portal and register there as a **Principal Entity (enterprise)**. Registration on one portal is valid across all operators. The options are Jio TrueConnect, Vi Vilpower, Airtel DLT and BSNL DLT.
- [ ] Documents, typically:
  - PAN of the company;
  - GST certificate;
  - certificate of incorporation;
  - a **letter of authorisation** on company letterhead naming the person who operates the account;
  - that person's ID proof.

  The portal also charges a one-time registration fee **[VERIFY on the portal you choose]**.

- [ ] When approved, note the **Entity ID** (19 digits).
- [ ] Register **one header (sender ID)**: 6 letters, category **Transactional / Service**, for example `INFBYX`. Use a header that matches the brand.
- [ ] Register **one content template**:
  - category **Service-Implicit**, type **OTP**;
  - suggested text: `{#var#} is your Infrabyx verification code. It is valid for 10 minutes. Do not share it with anyone. - Infrabyx`;
  - note the **Template ID**.
- [ ] **URLs:** any URL in a template must be whitelisted on the DLT portal before the template can carry it. The suggested OTP template has none, so leave it that way.
- [ ] **Telemarketer chain:** under the portal's chain or telemarketer binding section, declare MSG91 and Gupshup as your telemarketers. Each vendor shows the exact name or ID to bind on its DLT page.

## 2. MSG91 (SMS reference adapter)

- [ ] Create an account at <https://msg91.com> and complete company KYC.
- [ ] Under **DLT details**, add the **Entity ID**, the **header** and the **Template ID** from section 1.
- [ ] Create an SMS template mapped to that DLT template.
- [ ] Create an **Auth key**. Do not IP-restrict it, because GitHub runner addresses change.
- [ ] GitHub `sandbox` environment:
  - secret `SANDBOX_MSG91_AUTH_KEY`;
  - variables `SANDBOX_MSG91_TEMPLATE_ID`, `SANDBOX_SMS_DLT_ENTITY_ID`, `SANDBOX_SMS_DLT_TEMPLATE_ID`, `SANDBOX_SMS_SENDER_ID`.

## 3. Gupshup SMS (SMS alternative)

- [ ] Ask Gupshup sales or support for an **Enterprise SMS** account for the entity, and bind it to the same DLT entity, header and template.
- [ ] Note the API **user ID** and **password**.
- [ ] GitHub `sandbox` environment: secrets `SANDBOX_GUPSHUP_SMS_USER_ID` and `SANDBOX_GUPSHUP_SMS_PASSWORD`.

## 4. Gupshup WhatsApp sandbox app (WhatsApp reference adapter)

- [ ] At <https://www.gupshup.io>, open **Dashboard → WhatsApp → Create app** and choose **Sandbox (test)**.
- [ ] From your test phone, send the opt-in message the console shows to the sandbox number, so that phone can receive test messages.
- [ ] Note the **app name** and the **API key**.
- [ ] GitHub `sandbox` environment: secret `SANDBOX_GUPSHUP_WA_API_KEY`; variable `SANDBOX_GUPSHUP_WA_APP_NAME`.
- [ ] Marketing templates stay off (OWN-08). The tests use utility and authentication templates only.

## 5. Meta developer app with test number (WhatsApp alternative)

- [ ] At <https://developers.facebook.com>, open **My Apps → Create app**, choose type **Business** and link it to your Meta Business portfolio.
- [ ] Add the **WhatsApp** product. Meta assigns a **test business phone number** and a test WhatsApp Business Account.
- [ ] Under **WhatsApp → API Setup → To**, add your test phone as a recipient. You can add up to five, each verified by a code.
- [ ] Create a **system user** under **Business settings → Users → System users** with access to the app and the WhatsApp account. Generate a **token that does not expire** with `whatsapp_business_messaging` and `whatsapp_business_management`. The 24-hour temporary token on the API Setup page is not enough for nightly runs.
- [ ] Under **App settings → Basic**, note the **App secret**. It verifies webhook signatures (C-13).
- [ ] GitHub `sandbox` environment:
  - secrets `SANDBOX_META_WA_ACCESS_TOKEN`, `SANDBOX_META_WA_APP_SECRET`, `SANDBOX_META_WA_VERIFY_TOKEN` (any 32-character random string you choose);
  - variables `SANDBOX_META_WA_PHONE_NUMBER_ID`, `SANDBOX_META_WA_WABA_ID`.

## 6. Your test phone number

- [ ] GitHub `sandbox` environment: **secret** `SANDBOX_TEST_PHONE_NUMBER` in E.164 form (`+91…`). It is personal data, so it is a secret, not a variable. Logs show it masked.
- [ ] The weekly live SMS goes only to this number, and only once sections 1 and 2 are complete.

## Also needed for the other PL2 sandbox legs (not on your list, same environment)

| Vendor             | Where                                                                    | Secrets / variables                                                                                                       | Latest by        |
| ------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Brevo (EMAIL alt.) | brevo.com free account → SMTP & API → API keys                           | secret `SANDBOX_BREVO_API_KEY`; secret `SANDBOX_BREVO_WEBHOOK_BEARER` (32 random characters you choose)                   | before session 6 |
| Razorpay (test)    | dashboard.razorpay.com → **Test mode** → API keys; Webhooks → add secret | secrets `SANDBOX_RAZORPAY_KEY_ID` (`rzp_test_…`), `SANDBOX_RAZORPAY_KEY_SECRET`, `SANDBOX_RAZORPAY_WEBHOOK_SECRET` (P-16) | before session 7 |
| Cashfree (sandbox) | merchant.cashfree.com → switch to **Sandbox** → Developers → API keys    | secrets `SANDBOX_CASHFREE_APP_ID`, `SANDBOX_CASHFREE_SECRET_KEY` (P-16)                                                   | before session 7 |

Only test-mode or sandbox credentials go here. A live key in CI is refused by the P-03 guard.
