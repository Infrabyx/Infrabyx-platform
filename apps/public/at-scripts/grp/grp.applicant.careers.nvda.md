# AT script: `grp.applicant.careers` with NVDA

From `packages/a11y/at-scripts/_template.md` (IPB-06 §06.4.4, IPB-06-15). The Accessibility Lead runs it before each release of the group site (OWNER-QUESTIONS #50).

## Preconditions

| Item       | Value                                         |
| ---------- | --------------------------------------------- |
| Journey    | `grp.applicant.careers` (`journeys/GRP.yaml`) |
| Device     | Windows laptop                                |
| AT         | NVDA, current release                         |
| Browser    | Firefox, current release                      |
| Theme      | light, then dark                              |
| Text scale | 100 %, then 200 %                             |
| Locale     | en-IN                                         |
| Data       | the public-site seed (synthetic data only)    |

## Steps

Start at `/careers`.

### Step 1

- **Action:** Press Tab once, then Enter.
- **Expected announcement:** "Skip to main content, link … main"
- **Expected focus:** the main content
- **Pass when:** focus lands in main.

### Step 2

- **Action:** Move to “Open roles” with H.
- **Expected announcement:** "Open roles, heading level 2"
- **Expected focus:** the open roles section
- **Pass when:** the list of roles, or that there are none, is announced.

### Step 3

- **Action:** Tab to the application form and send it complete.
- **Expected announcement:** "Thank you, your message was sent …"
- **Expected focus:** the success notice
- **Pass when:** the reference is announced.

## Results

| Field   | Value                         |
| ------- | ----------------------------- |
| Tester  |                               |
| Date    |                               |
| Result  | pass or fail, with the step   |
| Defects | feedback references (`fbk_…`) |
