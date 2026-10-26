# Runbook — Temporal Cloud namespace (Mumbai) for the PL2 sandbox leg

**For:** the owner · **Decision:** PL2-D-16 (D-06) · **Latest by:** before PL2 session 5 (WORKFLOW) for the `temporal-cloud` sandbox leg to count at the exit gate; it does not block the PL2 publish (IPB-DEV-04).

`temporal-cloud` is recorded as `IN` from the start. The namespace runs in the AWS ap-south-1 (Mumbai) region, which Temporal Cloud has offered since August 2023. Its `maxDataClass` stays `INTERNAL` until PL6, and the payload codec (C-16) is always on.

## Steps

1. Go to <https://temporal.io/get-cloud> and sign up with your work email. Choose **Pay as you go** and add a card. Turn on MFA for your Temporal Cloud login under **Settings → Account**.
2. Open **Namespaces → Create Namespace** and fill it in:
   - **Name:** `infrabyx-sandbox`. Temporal appends your account ID, giving `infrabyx-sandbox.<account-id>`.
   - **Cloud provider and region:** **AWS — ap-south-1 (Mumbai)**. Check this twice; a namespace cannot change region.
   - **Retention:** **1 day**, the minimum. Test histories need no more, and it keeps storage cost down.
   - **Authentication:** **API keys**.
3. Open **Settings → Service accounts → Create service account**:
   - **Name:** `platform-ci-sandbox`;
   - **Account role:** none;
   - **Namespace permission:** `infrabyx-sandbox` → **Write**.
4. On that service account, choose **Create API key**:
   - **Name:** `github-sandbox`;
   - **Expiry:** 90 days. Rotation is quarterly, inside the 180-day rule of IPB-02-29.

   Copy the key once. It is not shown again.

5. On the namespace page, note the **gRPC endpoint for API key auth**. It has the form `ap-south-1.aws.api.temporal.io:7233`.
6. Keep a screenshot or PDF of the namespace page showing the region, and the pay-as-you-go order confirmation, as residency evidence for the Vendor Assurance Room (IPB-08).

## What to create in GitHub

In **Infrabyx/Infrabyx-platform → Settings → Environments → sandbox** (after the GitHub Team upgrade):

| Name                               | Kind     | Value                           |
| ---------------------------------- | -------- | ------------------------------- |
| `SANDBOX_TEMPORAL_CLOUD_API_KEY`   | Secret   | the API key from step 4         |
| `SANDBOX_TEMPORAL_CLOUD_NAMESPACE` | Variable | `infrabyx-sandbox.<account-id>` |
| `SANDBOX_TEMPORAL_CLOUD_ADDRESS`   | Variable | the endpoint from step 5        |

Do not paste the key anywhere else. Production keys go into the production SECRETS store in PL6 at `secrets/prod/workflow/temporal-cloud/api_key`.

## Cost

Pay-as-you-go bills per Action plus storage. The nightly contract leg runs a handful of short workflows (well under 1,000 Actions a night), so expect a few dollars a month at most. Check **Settings → Usage** after the first week.
