# Manual accessibility checklist (per release)

IPB-06-55. These are the 40 checks that automation cannot make. The Accessibility Lead (`PLT_ACCESSIBILITY_LEAD`) runs every item on the release candidate, records pass, fail or not applicable with a note, and signs. The signed copy is stored with the release record, and the accessibility statement generator reads it (§06.4.9). A failed item becomes a known issue with a target date, or blocks the release when it is on a regulated step.

Item lines keep the form `- [ ] **Cnn** (SC x.y.z) text`; `@infrabyx/a11y` parses them, so do not reword the IDs.

## Sensory characteristics and colour

- [ ] **C01** (SC 1.3.3) Instructions never rely only on shape, size, position, colour or sound ("the green button", "on the right").
- [ ] **C02** (SC 1.4.1) Charts, status chips and form errors use a pattern, icon or text as well as colour.
- [ ] **C03** (SC 1.4.11) Chart series, focus rings and input borders are distinguishable from their surroundings in all four themes.
- [ ] **C04** (SC 1.4.6) The high-contrast themes reach 7:1 for body text on every page sampled, and the theme choice persists.

## Media

- [ ] **C05** (SC 1.2.1) Every audio-only item has a transcript; every video-only item has a transcript or an audio description.
- [ ] **C06** (SC 1.2.2) Every video has English and Hindi captions, reviewed by a person (`caption_review_by` set), in sync with the speech.
- [ ] **C07** (SC 1.2.3, 1.2.5) Tutorial narration describes the on-screen action, or an extended transcript is published.
- [ ] **C08** (SC 1.2.4) Live captions appear in a hosted meeting or hearing and are accurate enough to follow the discussion.
- [ ] **C09** (SC 1.4.2) No audio plays automatically for more than three seconds, and every player has a visible pause.
- [ ] **C10** (SC 1.4.5) Text is HTML text, not an image of text, except for logos.
- [ ] **C11** (SC 2.2.2) Moving, blinking or auto-updating content can be paused, stopped or hidden.
- [ ] **C12** (SC 2.3.1) Nothing flashes more than three times a second.

## Copy, headings and links

- [ ] **C13** (SC 2.4.4) Every link's purpose is clear from its text or its sentence; no bare "click here" or "read more".
- [ ] **C14** (SC 2.4.6) Headings describe the section below them and labels describe the input.
- [ ] **C15** (SC 2.4.2) Each page title follows `<Page> · <Module> · <Product>` and describes the page.
- [ ] **C16** (SC 3.1.2) Passages in another language (for example Devanagari text on an English page) carry the right `lang`.
- [ ] **C17** (SC 3.1.5) Plain-language mode is present on public pages and regulated steps, and the explanation differs from the legal text, which stays byte-identical.
- [ ] **C18** (SC 3.3.3) Every error message says what happened, why, and what to do next, and gives the help key and code.
- [ ] **C19** (SC 3.3.2) Required fields, formats and limits are stated before the input, not only in placeholders.

## Navigation and predictability

- [ ] **C20** (SC 2.4.5) There are at least two ways to reach each page (navigation, search, site map or related links).
- [ ] **C21** (SC 2.4.8) Every page below the top level has a breadcrumb or equivalent location cue.
- [ ] **C22** (SC 3.2.1) Moving focus onto a control never changes the page, opens a window or submits a form.
- [ ] **C23** (SC 3.2.2) Changing a setting never causes an unannounced change of context.
- [ ] **C24** (SC 3.2.3) Header, navigation and footer appear in the same order on every page sampled.
- [ ] **C25** (SC 3.2.4) Components with the same function have the same name and icon everywhere.
- [ ] **C26** (SC 3.2.6) Help (the "?" menu, contact and grievance links) is in the same place on every page.

## Keyboard, pointer and motion

- [ ] **C27** (SC 2.1.1) Every journey completes by keyboard alone, including dialogs, menus and the cookie banner.
- [ ] **C28** (SC 2.1.2) Focus never gets stuck; Esc closes every overlay and focus returns to the trigger.
- [ ] **C29** (SC 2.4.3) Focus order follows the reading order, and a newly opened dialog receives focus.
- [ ] **C30** (SC 2.4.11) The focused element is never fully hidden by a sticky header, footer or banner.
- [ ] **C31** (SC 2.5.1) Every multi-point or path gesture (pinch, swipe, map drag) has a single-pointer alternative.
- [ ] **C32** (SC 2.5.4) Nothing is triggered by shaking or tilting the device without a button alternative.
- [ ] **C33** (SC 2.5.7) Every drag action has a click or keyboard alternative.
- [ ] **C34** (SC 2.3.3, IPB-06-34) With reduced motion on, transitions and parallax stop.

## Forms, time and authentication

- [ ] **C35** (SC 2.2.1) Every time limit warns at least 20 seconds ahead and can be extended, except limits fixed by regulation, which say so.
- [ ] **C36** (SC 3.3.4) Legal, financial and data-changing steps can be reviewed, corrected or confirmed before they are final.
- [ ] **C37** (SC 3.3.7) A multi-step form never asks again for information already given in the same process.
- [ ] **C38** (SC 3.3.8) Sign-in needs no cognitive test, and paste and password managers work in every credential field.

## Assistive technology and alerts

- [ ] **C39** (SC 4.1.3, IPB-06 §06.4.6) Status messages and alerts are announced with the politeness in the alert matrix, and each alert has a visual equivalent.
- [ ] **C40** (IPB-06-15, IPB-06-56) The AT test plan for this release ran: the required journeys and screen readers, with results and evidence class recorded.

## Sign-off

| Field               | Value |
| ------------------- | ----- |
| Release             |       |
| Accessibility Lead  |       |
| Date                |       |
| Items failed (IDs)  |       |
| Known issues raised |       |
