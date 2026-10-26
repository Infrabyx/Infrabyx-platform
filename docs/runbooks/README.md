# Owner runbooks

Step-by-step instructions for owner actions the build cannot do itself.

| Runbook                                                            | What it sets up                                                                                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| [aws-organization-and-sandbox.md](aws-organization-and-sandbox.md) | AWS Organization, sandbox member account, CloudFormation stack `infra/aws/sandbox/sandbox-account.cfn.yaml` (D-01)                      |
| [temporal-cloud.md](temporal-cloud.md)                             | Temporal Cloud pay-as-you-go namespace in Mumbai (D-06)                                                                                 |
| [messaging-vendors.md](messaging-vendors.md)                       | DLT registration, MSG91, Gupshup SMS and WhatsApp sandbox, Meta test app, Brevo, Razorpay and Cashfree test accounts (D-07, D-08, P-16) |

## 1. When each account must exist (PL2)

None of these blocks the PL2 publish. Gate A publishes on the unit, hermetic and available sandbox legs (IPB-DEV-04). An account that is missing at gate A leaves its adapter `unproven`. A product may not use an `unproven` adapter in staging (gate B).

| Account or setting                                                               | Unlocks                                                  | Latest to count at the PL2 exit gate | Latest at all                                          |
| -------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------ |
| GitHub Team plan and the `sandbox` environment (§2)                              | every sandbox leg (environment secrets)                  | before PL2 session 5                 | before the first staging deployment                    |
| Temporal Cloud namespace, Mumbai                                                 | `temporal-cloud`                                         | before session 5 (WORKFLOW)          | before a product routes to `temporal-cloud` in staging |
| Brevo; MSG91; Gupshup SMS and WhatsApp sandbox; Meta test app; test phone number | `brevo`, `msg91`, `gupshup-sms`, `gupshup`, `meta-cloud` | before session 6 (messaging)         | before a product routes to that adapter in staging     |
| DLT registration                                                                 | the weekly live SMS                                      | before session 6                     | before any live SMS                                    |
| Razorpay test mode; Cashfree sandbox                                             | `razorpay`, `cashfree`                                   | before session 7 (PAYMENTS)          | before a product takes payments in staging             |
| AWS Organization and sandbox account                                             | `s3`, `aws-sm`, `aws-kms`, `ses`                         | before session 8 (exit gate)         | before the first staging deployment (D-01)             |

Sessions 1 to 4 need none of these.

## 2. The GitHub `sandbox` environment (after the GitHub Team upgrade)

1. Open **Infrabyx/Infrabyx-platform → Settings → Environments → New environment**, name it `sandbox`.
2. Under **Deployment branches and tags**, choose **Selected branches and tags** and add `main`, `claude/*` and `cc/*`. Workflows from other branches then cannot read its secrets.
3. Leave **Required reviewers** off. The nightly run has nobody to approve it.
4. Add the secrets and variables each runbook names. GitHub shows secret values only as `***`, and the workflows never print them.
