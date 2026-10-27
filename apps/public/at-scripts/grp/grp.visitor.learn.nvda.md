# AT script: `grp.visitor.learn` with NVDA

From `packages/a11y/at-scripts/_template.md` (IPB-06 §06.4.4, IPB-06-15). The Accessibility Lead runs it before each release of the group site (OWNER-QUESTIONS #50).

## Preconditions

| Item       | Value                                      |
| ---------- | ------------------------------------------ |
| Journey    | `grp.visitor.learn` (`journeys/GRP.yaml`)  |
| Device     | Windows laptop                             |
| AT         | NVDA, current release                      |
| Browser    | Firefox, current release                   |
| Theme      | light, then dark                           |
| Text scale | 100 %, then 200 %                          |
| Locale     | en-IN                                      |
| Data       | the public-site seed (synthetic data only) |

## Steps

Start at `/`.

### Step 1

- **Action:** Press Tab once.
- **Expected announcement:** "Skip to main content, link"
- **Expected focus:** the skip link, first in the page
- **Pass when:** Enter moves focus to the main content.

### Step 2

- **Action:** Move through the headings with H.
- **Expected announcement:** "Software for legal, compliance and finance work, heading level 1"
- **Expected focus:** the page's only level 1 heading
- **Pass when:** every section is reached by its heading, in order.

### Step 3

- **Action:** Open “Group companies” from the main navigation.
- **Expected announcement:** "Group companies, link … Group companies, heading level 1"
- **Expected focus:** the new page's main content
- **Pass when:** the current page is announced as current in the navigation.

## Results

| Field   | Value                         |
| ------- | ----------------------------- |
| Tester  |                               |
| Date    |                               |
| Result  | pass or fail, with the step   |
| Defects | feedback references (`fbk_…`) |
