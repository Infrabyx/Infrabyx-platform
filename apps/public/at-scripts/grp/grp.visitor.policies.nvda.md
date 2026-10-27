# AT script: `grp.visitor.policies` with NVDA

From `packages/a11y/at-scripts/_template.md` (IPB-06 §06.4.4, IPB-06-15). The Accessibility Lead runs it before each release of the group site (OWNER-QUESTIONS #50).

## Preconditions

| Item       | Value                                        |
| ---------- | -------------------------------------------- |
| Journey    | `grp.visitor.policies` (`journeys/GRP.yaml`) |
| Device     | Windows laptop                               |
| AT         | NVDA, current release                        |
| Browser    | Firefox, current release                     |
| Theme      | light, then dark                             |
| Text scale | 100 %, then 200 %                            |
| Locale     | en-IN                                        |
| Data       | the public-site seed (synthetic data only)   |

## Steps

Start at `/legal`.

### Step 1

- **Action:** Open the Privacy Notice from the policy list.
- **Expected announcement:** "Privacy Notice …, heading level 1"
- **Expected focus:** the policy's main content
- **Pass when:** the version and dates are announced as a list of terms and values.

### Step 2

- **Action:** Open “Cookie settings” from the footer.
- **Expected announcement:** "Cookie settings, heading level 1"
- **Expected focus:** the preference centre
- **Pass when:** each category announces its name, state and help.

### Step 3

- **Action:** Choose “Reject all”.
- **Expected announcement:** "Your choices are saved."
- **Expected focus:** the button you pressed
- **Pass when:** the confirmation is announced without moving focus.

## Results

| Field   | Value                         |
| ------- | ----------------------------- |
| Tester  |                               |
| Date    |                               |
| Result  | pass or fail, with the step   |
| Defects | feedback references (`fbk_…`) |
