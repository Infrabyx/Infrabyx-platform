# Runbook — AWS Organization and the PL2 sandbox account

**For:** the owner · **Decision:** PL2-D-11 (D-01) · **Region:** ap-south-1 (Mumbai) · **Latest by:** before the first staging deployment; before PL2 session 8 if the AWS sandbox legs should count at the PL2 exit gate (see `docs/runbooks/README.md`).

The result is two accounts:

- a **management account** that holds nothing but the AWS Organization, billing and sign-in;
- a **sandbox member account** in which one CloudFormation stack creates everything the PL2 contract tests need.

Production gets its own member account in PL6. Nobody creates IAM users or access keys at any step. GitHub reaches the sandbox through OIDC only (IPB-02-08).

You need:

- two email addresses you control, one per account (plus-addresses such as `aws+mgmt@…` work);
- a phone for MFA, or better, a hardware key or passkey;
- a card for billing.

## 1. Create the management account

1. Go to <https://signin.aws.amazon.com/signup>. Use the management email address and an account name such as `infrabyx-management`. Choose the **Basic (free)** support plan.
2. Sign in as root and open **IAM → Security credentials** (top-right menu → Security credentials).
3. Under **Multi-factor authentication (MFA)**, choose **Assign MFA device**. Register a passkey or security key, and preferably a second one as backup.
4. Under **Access keys**, confirm the list is empty. **Never create a root access key.**
5. Under **Account → Alternate contacts**, add billing, operations and security contacts (your own details are fine).
6. Under **Account → IAM user and role access to Billing information**, choose **Activate**.

## 2. Create the organization and your day-to-day sign-in

1. Open **AWS Organizations → Create an organization** (all features).
2. Open **IAM Identity Center** and switch the console region to **ap-south-1** first. Choose **Enable**, then **Enable with AWS Organizations**.
3. Under **Identity Center → Users → Add user**, add yourself with your normal email. Under **Settings → Authentication → MFA**, require MFA every time (security key or authenticator app).
4. Under **Permission sets → Create**, use the predefined **AdministratorAccess** and set the session duration to 1 hour.
5. From now on, sign in through the Identity Center access-portal URL (shown on the Identity Center dashboard), not as root. Put the root credentials away.

## 3. Create the sandbox member account

1. Open **Organizations → AWS accounts → Add an AWS account → Create an AWS account**. Use the sandbox email address and the account name `infrabyx-sandbox`. Leave the IAM role name at its default.
2. Open **Organizations → Settings → Root access management** (centralised root access) and choose **Enable**. Then select the sandbox account and **Delete root user credentials**. The member account then has no root password or keys at all.
   - If your console does not offer this option, set a root password for the sandbox account through the **Forgot password** flow, register MFA as in step 1, and confirm it has no access keys.
3. Under **IAM Identity Center → AWS accounts**, select `infrabyx-sandbox`, choose **Assign users or groups**, pick yourself and the **AdministratorAccess** permission set.
4. Optional, recommended: create a **service control policy** that denies every region except ap-south-1 and ap-south-2, with the usual exceptions for global services (IAM, Organizations, Budgets, Support, STS, CloudFront). Attach it to the sandbox account. Ask me for the JSON if you want it.

## 4. Deploy the sandbox stack

1. From the access portal, open the **infrabyx-sandbox** account as AdministratorAccess. Set the console region to **Asia Pacific (Mumbai) ap-south-1**.
2. Open **CloudFormation → Create stack → With new resources**. Upload `infra/aws/sandbox/sandbox-account.cfn.yaml` from this repository.
3. Use the stack name `infrabyx-platform-sandbox` and these parameters:

   | Parameter            | Value                                                             |
   | -------------------- | ----------------------------------------------------------------- |
   | `GitHubOrg`          | `Infrabyx`                                                        |
   | `GitHubRepo`         | `Infrabyx-platform`                                               |
   | `GitHubEnvironment`  | `sandbox`                                                         |
   | `CreateOidcProvider` | `true`                                                            |
   | `BudgetEmail`        | your address                                                      |
   | `SesSenderEmail`     | an address you can read, for example `sandbox-mail@<your domain>` |

4. Tick **I acknowledge that AWS CloudFormation might create IAM resources with custom names** and choose **Submit**. The stack takes about 3 minutes.
5. Open the inbox of `SesSenderEmail` and click the **Amazon SES verification** link. The account stays in the SES sandbox; the tests send only to SES's mailbox-simulator addresses.
6. Confirm the budget alert emails when they arrive.

The stack creates:

- the GitHub OIDC provider;
- the role `infrabyx-platform-sandbox-ci`, which only jobs in this repository's `sandbox` environment can assume;
- a USD 10/month budget with alerts at 70 %, 100 % and forecast 100 %;
- the Object Lock test bucket (compliance mode, 1-day retention, objects expire after 2 days);
- two test KMS keys (symmetric with rotation; ECC P-256 for signing);
- the canary secret `secrets/sandbox/secrets/aws-sm/canary`;
- the SES configuration set and sender identity;
- the SES event topic with **SignatureVersion 2** (C-13).

## 5. Hand the outputs to GitHub

Do this once the organisation is on GitHub Team (environments; PL2-D-12).

1. Open **CloudFormation → infrabyx-platform-sandbox → Outputs**.
2. In GitHub, open **Infrabyx/Infrabyx-platform → Settings → Environments → sandbox** (create it if it does not exist; `docs/runbooks/README.md` §2). Add these as **variables**, not secrets; none of them is a credential:

   | Variable                        | Output                        |
   | ------------------------------- | ----------------------------- |
   | `SANDBOX_AWS_ROLE_ARN`          | `RoleArn`                     |
   | `SANDBOX_AWS_REGION`            | `ap-south-1`                  |
   | `SANDBOX_S3_BUCKET`             | `BucketName`                  |
   | `SANDBOX_KMS_SYMMETRIC_KEY_ARN` | `SymmetricKeyArn`             |
   | `SANDBOX_KMS_SIGNING_KEY_ARN`   | `SigningKeyArn`               |
   | `SANDBOX_SES_CONFIGURATION_SET` | `SesConfigurationSetName`     |
   | `SANDBOX_SES_EVENT_TOPIC_ARN`   | `SesEventTopicArn`            |
   | `SANDBOX_SES_SENDER`            | the `SesSenderEmail` you used |

3. Tell me in the session. The next nightly run proves `s3`, `aws-sm`, `aws-kms` and `ses`, and their `port-contract` issues close.

## Costs and clean-up

Expected spend is a few dollars a month: about USD 2 for the two KMS keys, cents for the canary secret, and the rest negligible. The budget alerts you at USD 7.

To remove everything, delete the stack. The bucket is kept on purpose (`DeletionPolicy: Retain`, because Object Lock objects cannot be force-deleted). Empty it after the 1-day retention has passed, then delete it by hand.
