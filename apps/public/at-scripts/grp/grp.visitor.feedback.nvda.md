# AT script: `grp.visitor.feedback` with NVDA

From `packages/a11y/at-scripts/_template.md` (IPB-06 §06.4.4, IPB-06-15). The Accessibility Lead runs it before each release of the group site (OWNER-QUESTIONS #50).

## Preconditions

| Item       | Value                                        |
| ---------- | -------------------------------------------- |
| Journey    | `grp.visitor.feedback` (`journeys/GRP.yaml`) |
| Device     | Windows laptop                               |
| AT         | NVDA, current release                        |
| Browser    | Firefox, current release                     |
| Theme      | light, then dark                             |
| Text scale | 100 %, then 200 %                            |
| Locale     | en-IN                                        |
| Data       | the public-site seed (synthetic data only)   |

## Steps

Start at `/accessibility`.

### Step 1

- **Action:** Move to “Report an accessibility problem” with H.
- **Expected announcement:** "Report an accessibility problem, heading level 2"
- **Expected focus:** the report form's heading
- **Pass when:** the response time is announced in the text before the form.

### Step 2

- **Action:** Fill the form, tick “Problem stops you” and send it.
- **Expected announcement:** "Feedback … Status: Received"
- **Expected focus:** the status page
- **Pass when:** the reference and status are announced.

## Results

| Field   | Value                         |
| ------- | ----------------------------- |
| Tester  |                               |
| Date    |                               |
| Result  | pass or fail, with the step   |
| Defects | feedback references (`fbk_…`) |
