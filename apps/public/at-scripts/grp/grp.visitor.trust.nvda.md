# AT script: `grp.visitor.trust` with NVDA

From `packages/a11y/at-scripts/_template.md` (IPB-06 §06.4.4, IPB-06-15). The Accessibility Lead runs it before each release of the group site (OWNER-QUESTIONS #50).

## Preconditions

| Item       | Value                                      |
| ---------- | ------------------------------------------ |
| Journey    | `grp.visitor.trust` (`journeys/GRP.yaml`)  |
| Device     | Windows laptop                             |
| AT         | NVDA, current release                      |
| Browser    | Firefox, current release                   |
| Theme      | light, then dark                           |
| Text scale | 100 %, then 200 %                          |
| Locale     | en-IN                                      |
| Data       | the public-site seed (synthetic data only) |

## Steps

Start at `/trust`.

### Step 1

- **Action:** Press Tab once, then Enter.
- **Expected announcement:** "Skip to main content, link … main"
- **Expected focus:** the main content
- **Pass when:** focus lands in main.

### Step 2

- **Action:** Move through the headings with H.
- **Expected announcement:** "Published documents, heading level 2"
- **Expected focus:** the documents section
- **Pass when:** each document is announced with its title and publication date.

### Step 3

- **Action:** Open “Report a security issue”.
- **Expected announcement:** "Report a security issue, heading level 1"
- **Expected focus:** the security page
- **Pass when:** the contact address is announced as a link.

## Results

| Field   | Value                         |
| ------- | ----------------------------- |
| Tester  |                               |
| Date    |                               |
| Result  | pass or fail, with the step   |
| Defects | feedback references (`fbk_…`) |
