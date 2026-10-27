# AT script: `<journey id>` with `<screen reader>`

IPB-06 §06.4.4 and IPB-06-15. Copy this file to `at-scripts/<product>/<journey>.<at>.md` and list it in the journey's `at_scripts`. Keep it plain Markdown, so the tester's own screen reader can read it aloud. Use one script per journey and screen reader.

## Preconditions

| Item       | Value                                               |
| ---------- | --------------------------------------------------- |
| Journey    | `<journey id>` (`journeys/<product>.yaml`)          |
| Device     | for example Windows 11 laptop, Pixel 8              |
| AT         | for example NVDA 2026.3                             |
| Browser    | for example Firefox 145                             |
| Theme      | light, dark, hc_light or hc_dark                    |
| Text scale | 100 % or 200 %                                      |
| Locale     | en-IN or hi-IN                                      |
| Data       | seed persona and records used (synthetic data only) |

## Steps

Each step lists what the tester does, then the expected announcement (a verbatim pattern; `…` stands for any text), the expected focus position and the pass criterion.

### Step 1

- **Action:** Open `<route>` and press Tab once.
- **Expected announcement:** "Skip to main content, link"
- **Expected focus:** the skip link, first in the page
- **Pass when:** the announcement matches and Enter moves focus to the main content.

### Step 2

- **Action:** …
- **Expected announcement:** "…"
- **Expected focus:** …
- **Pass when:** …

## Results

| Field          | Value                                                      |
| -------------- | ---------------------------------------------------------- |
| Tester         | name or pseudonymous ID (an AT-USER tester where required) |
| Evidence class | MANUAL or AT-USER                                          |
| Date           | DD MMM YYYY                                                |
| Result         | pass or fail                                               |
| Defects raised | `fbk_…` IDs with severity (P1 to P4)                       |
| Notes          |                                                            |
