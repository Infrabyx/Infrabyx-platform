# AT script: `grp.visitor.contact` with NVDA

From `packages/a11y/at-scripts/_template.md` (IPB-06 §06.4.4, IPB-06-15). The Accessibility Lead runs it before each release of the group site (OWNER-QUESTIONS #50).

## Preconditions

| Item       | Value                                       |
| ---------- | ------------------------------------------- |
| Journey    | `grp.visitor.contact` (`journeys/GRP.yaml`) |
| Device     | Windows laptop                              |
| AT         | NVDA, current release                       |
| Browser    | Firefox, current release                    |
| Theme      | light, then dark                            |
| Text scale | 100 %, then 200 %                           |
| Locale     | en-IN                                       |
| Data       | the public-site seed (synthetic data only)  |

## Steps

Start at `/contact`.

### Step 1

- **Action:** Press Tab once, then Enter.
- **Expected announcement:** "Skip to main content, link … main"
- **Expected focus:** the main content
- **Pass when:** focus lands in main.

### Step 2

- **Action:** Tab to the first field.
- **Expected announcement:** "Your name, required, edit text"
- **Expected focus:** the name field
- **Pass when:** each field announces its label and whether it is required.

### Step 3

- **Action:** Send the form empty.
- **Expected announcement:** "There is a problem … Your name is required, link"
- **Expected focus:** the error summary
- **Pass when:** each error links to its field and the field announces its error.

### Step 4

- **Action:** Fill the fields, tick the consent box and send.
- **Expected announcement:** "Thank you, your message was sent … Your reference is …"
- **Expected focus:** the success notice
- **Pass when:** the reference is announced.

## Results

| Field   | Value                         |
| ------- | ----------------------------- |
| Tester  |                               |
| Date    |                               |
| Result  | pass or fail, with the step   |
| Defects | feedback references (`fbk_…`) |
