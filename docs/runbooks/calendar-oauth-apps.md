# Calendar OAuth applications (owner tasks; OWNER-QUESTIONS #126, R1-D-126)

The CALENDAR port (`@infrabyx/contracts/ports`, `CalendarPort`) writes entries into a person's own calendar after that person connects it with delegated OAuth. The platform builds the interface, the fake and the contract cases now. The Microsoft 365 and Google adapters stay **off and `unproven`** (`int.calendar.microsoft365.enabled`, `int.calendar.google.enabled`) until the applications below exist and the sandbox leg has passed against them.

Two rules apply throughout:

- **No secret ever goes in chat, an issue, a PR or the repository.** The client ID is not secret; the client secret or certificate is. It goes straight from the provider's console into the SECRETS port (the production secret store), under the reference named below.
- **One application per environment class.** Register one for non-production (local, CI sandbox, staging) and a separate one for production, so a staging credential can never mint production tokens and the production redirect list holds only production hosts.

## 1. Redirect URIs (both providers)

The adapters complete the code flow at one fixed path on the product's own console host:

```text
https://{console-host}/oauth/calendar/{provider}/callback
```

`{provider}` is `microsoft365` or `google`. `{console-host}` is each product's console host name for that environment (every product that enables the port adds its own host; no tenant host is ever registered, since tenants connect through their product's console). Register exact URIs only: no wildcards, no `http://` except `http://localhost:3000/oauth/calendar/{provider}/callback` on the non-production application.

## 2. Microsoft 365 (Entra ID app registration) — OWNER TASK

Do this in the organisation's own Microsoft 365 tenant, signed in as a Global Administrator or Application Administrator.

1. **Microsoft Entra admin center → Identity → Applications → App registrations → New registration.**
   - Name: `Infrabyx Calendar (non-production)` (and later `Infrabyx Calendar` for production).
   - Supported account types: **Accounts in any organizational directory (Any Microsoft Entra ID tenant — Multitenant)**. Customers' staff sign in from their own Microsoft 365 tenants. Do not choose the option that also admits personal Microsoft accounts unless a product asks for it.
   - Redirect URI: platform **Web**, the first URI from §1. Add the others under **Authentication** afterwards.
2. **Authentication:** leave **Access tokens** and **ID tokens** (implicit grant) unticked; the adapter uses the authorisation-code flow with PKCE. Set **Allow public client flows** to **No**. Front-channel logout URL: leave empty.
3. **API permissions → Add a permission → Microsoft Graph → Delegated permissions.** Add only:
   - `Calendars.ReadWrite` (create, update and delete the entries the platform wrote; the adapter never reads entries it did not write);
   - `offline_access` (a refresh token, so a connection survives without the person signing in again);
   - `openid` and `email` (to show which account is connected).

   Remove `User.Read` if Entra added it by default. **Never add Application permissions** (app-only access to every mailbox): the port is delegated only.

4. **Admin consent:** `Calendars.ReadWrite` is user-consentable by default, but many customer tenants restrict user consent. Then the customer's own administrator grants consent once for their tenant, from the consent link the product's admin page shows (`https://login.microsoftonline.com/{customer-tenant}/adminconsent?client_id={client-id}`). Do **not** press **Grant admin consent** in the Infrabyx tenant for production customers; it only consents for the Infrabyx tenant itself.
5. **Branding & properties:** set the publisher domain to the organisation's verified domain, and the terms-of-service and privacy-statement URLs of the products. **Publisher verification** (a blue "verified" badge) needs a Microsoft AI Cloud Partner Program account. Without it, tenants with the default consent policy cannot let their users consent to a multitenant app, so their admins must consent (step 4). Joining that programme is a separate owner decision (an external account).
6. **Certificates & secrets:** prefer **Certificates** (upload the public half of a certificate whose private key lives only in the secret store). If you use a **Client secret**, choose the shortest expiry that fits the rotation calendar (at most 12 months), and copy the value **directly** into the secret store under `int/calendar/microsoft365/client-credential`. It is shown once. Do not paste it anywhere else.
7. **Record** (not secret, goes into settings once the adapter ships): the **Application (client) ID** → `int.calendar.microsoft365.client_id`; the application's object ID for the exit runbook.
8. Tell the build session the application exists (the client ID is enough). It then runs the sandbox leg with a test account and turns the adapter from `unproven` to proven. `int.calendar.microsoft365.enabled` stays off in production until the owner turns it on (production configuration).

## 3. Google (Google Cloud project) — OWNER TASK, later

The organisation does not have a Google Cloud project yet. When it does, signed in with the organisation's Google Workspace administrator or a Cloud project owner:

1. **Create a project:** Google Cloud console → project picker → **New project**, named `infrabyx-calendar-nonprod` (later `infrabyx-calendar-prod`), under the organisation's own Cloud organisation if it has one.
2. **Enable the API:** **APIs & Services → Library → Google Calendar API → Enable.** Enable nothing else.
3. **OAuth consent screen (Google Auth Platform):**
   - **Branding:** app name, support email (a shared mailbox, not a person), the products' home page, privacy-policy and terms URLs, and **Authorized domains** (the products' registrable domains only).
   - **Audience:** user type **External** (customers' staff use their own Google accounts). While the app is in **Testing**, only listed test users can connect, and their refresh tokens expire after 7 days. That is fine for the sandbox leg but not for production.
   - **Data access (scopes):** add only `https://www.googleapis.com/auth/calendar.events` (read and write events; no access to calendar settings, sharing or other calendars' lists), plus `openid` and `email`. Do not add `https://www.googleapis.com/auth/calendar` (full calendar access).
4. **Credentials → Create credentials → OAuth client ID → Web application.** Name it after the environment; **Authorized JavaScript origins:** none; **Authorized redirect URIs:** the URIs from §1 with `{provider}` = `google`.
5. **Client secret:** download the JSON or copy the secret **directly** into the secret store under `int/calendar/google/client-credential`, then delete the downloaded file. Record the **Client ID** for `int.calendar.google.client_id`.
6. **Verification before production:** `calendar.events` is a _sensitive_ scope, so moving the production app to **In production** needs Google's OAuth app verification (brand verification, a demonstration video of the consent flow, the privacy policy covering calendar data). It is not a _restricted_ scope, so no third-party security assessment is needed. Until verification passes, users see an "unverified app" warning and the app is capped at 100 users.
7. Tell the build session the project exists. Then, as for Microsoft: sandbox leg, then proven; `int.calendar.google.enabled` stays off in production until the owner turns it on.

## 4. What the adapters do with these (for the review)

- Authorisation-code flow with PKCE and a `state` bound to the person's session; the redirect URI is compared exactly.
- Delegated access and refresh tokens are stored encrypted per tenant (`fieldCryptoForTenant`), never logged, and revoked at the provider on disconnect (Microsoft: the refresh token is dropped and the grant is removed from the person's account; Google: `https://oauth2.googleapis.com/revoke`).
- The adapter writes only entries it created (tracked by the product's external id) and deletes only those.
- Each tenant can turn the port off; each person can disconnect at any time from the product.
