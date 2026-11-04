import { describe, expect, it } from "vitest";
import {
  FORM_RULES,
  FormLayoutSchema,
  formControlName,
  isValidAutocomplete,
  lintForm,
  sortFindings,
  type FormControl,
  type FormFinding,
  type FormLayoutInput,
} from "./form.js";
import { wcagMapping } from "./mapping.js";

const good = (): FormLayoutInput => ({
  id: "contact",
  title: "Contact details",
  headings: [
    { id: "h-contact", level: 2, text: "Contact details" },
    { id: "h-prefs", level: 3, text: "Preferences" },
  ],
  texts: [{ id: "email-hint", text: "We send the receipt here." }],
  groups: [{ id: "g-channel", legend: "How should we contact you?" }],
  controls: [
    { id: "full-name", kind: "text", label: "Full name *", required: true, autocomplete: "name" },
    {
      id: "email",
      kind: "email",
      label: "Email *",
      required: true,
      autocomplete: "email",
      describedBy: ["email-hint", "email-error"],
      errorId: "email-error",
      errorText: "Enter an email address like name@example.com",
      invalid: true,
    },
    { id: "ch-email", kind: "radio", name: "channel", label: "Email", group: "g-channel" },
    { id: "ch-phone", kind: "radio", name: "channel", label: "Phone", group: "g-channel" },
    { id: "notes", kind: "textarea", label: "Anything else?" },
    { id: "token", kind: "hidden" },
    { id: "send", kind: "submit", label: "Send" },
  ],
});

/** The good layout with control `id` changed (or `null` to remove it) and extra controls. */
function withControl(
  id: string,
  patch: Partial<FormControl> | null,
  extra: FormControl[] = [],
): FormLayoutInput {
  const f = good();
  const controls = (f.controls ?? [])
    .flatMap((c) => (c.id !== id ? [c] : patch === null ? [] : [{ ...c, ...patch }]))
    .concat(extra);
  return { ...f, controls };
}

const rules = (f: FormFinding[]) => f.map((x) => `${x.rule}:${x.subject}:${x.severity}`);

describe("lintForm (PR-LDC-24)", () => {
  it("passes a well-formed layout with no findings", () => {
    expect(lintForm(good())).toEqual([]);
  });

  it("tags every rule with a WCAG 2.2 criterion from mapping.json", () => {
    const scs = new Set(wcagMapping().criteria.map((c) => c.sc));
    for (const [rule, r] of Object.entries(FORM_RULES)) expect(scs.has(r.sc), rule).toBe(true);
  });

  it("refuses something that is not a layout", () => {
    expect(() => lintForm({ id: "x", controls: [] })).toThrow();
    expect(() =>
      lintForm({ id: "x", controls: [{ id: "a", kind: "slider" as "text", label: "A" }] }),
    ).toThrow();
  });

  describe("accessible names (4.1.2, 3.3.2, 2.5.3)", () => {
    it("fails a control with no name and a placeholder-only label", () => {
      const f = lintForm(
        withControl("notes", { label: undefined as unknown as string }, [
          { id: "q", kind: "search", placeholder: "Search" },
        ]),
      );
      expect(rules(f)).toEqual(
        expect.arrayContaining(["name-missing:notes:error", "label-placeholder-only:q:error"]),
      );
      expect(f.find((x) => x.rule === "name-missing")).toMatchObject({ sc: "4.1.2" });
      expect(f.find((x) => x.rule === "label-placeholder-only")).toMatchObject({ sc: "3.3.2" });
    });

    it("names a control by aria-labelledby, then aria-label, then label", () => {
      const f = FormLayoutSchema.parse(good());
      const c = (p: Partial<FormControl>): FormControl => ({ id: "c", kind: "text", ...p });
      expect(formControlName(c({ labelledBy: ["h-prefs", "email-hint"], label: "L" }), f)).toEqual({
        name: "Preferences We send the receipt here.",
        from: "labelledby",
      });
      expect(formControlName(c({ ariaLabel: "A", label: "L" }), f)).toEqual({
        name: "A",
        from: "aria-label",
      });
      expect(formControlName(c({ labelledBy: ["nope"], label: "L" }), f)).toEqual({
        name: "L",
        from: "label",
      });
      expect(formControlName(c({ placeholder: "P" }), f)).toBeUndefined();
    });

    it("warns when the name is only an aria-label, but not for an icon button", () => {
      const f = lintForm(
        withControl("notes", { label: undefined as unknown as string, ariaLabel: "Notes" }, [
          { id: "clear", kind: "button", ariaLabel: "Clear the form" },
        ]),
      );
      expect(rules(f)).toEqual(["label-not-visible:notes:warning"]);
    });

    it("warns when aria-label does not contain the visible label (label in name)", () => {
      expect(rules(lintForm(withControl("notes", { ariaLabel: "Comments" })))).toEqual([
        "label-in-name:notes:warning",
      ]);
      expect(lintForm(withControl("notes", { ariaLabel: "Anything else? (optional)" }))).toEqual(
        [],
      );
    });
  });

  describe("unique names (2.4.6)", () => {
    it("fails two controls with the same name", () => {
      const f = lintForm(
        withControl("notes", null, [
          {
            id: "name2",
            kind: "text",
            label: " full  NAME * ",
            required: true,
            autocomplete: "name",
          },
        ]),
      );
      expect(f).toEqual([
        {
          rule: "name-duplicate",
          sc: "2.4.6",
          severity: "error",
          subject: "name2",
          message: 'the accessible name "full  NAME *" is also the name of full-name',
          source: "lint",
        },
      ]);
    });

    it("allows the same name in different groups with distinct legends", () => {
      const f = good();
      const layout: FormLayoutInput = {
        ...f,
        groups: [
          ...(f.groups ?? []),
          { id: "g-a", legend: "Applicant" },
          { id: "g-b", labelledBy: ["co-legend"] },
        ],
        texts: [...(f.texts ?? []), { id: "co-legend", text: "Co-applicant" }],
        controls: [
          ...f.controls,
          { id: "a-pan", kind: "text", label: "Tax ID", group: "g-a", personalData: false },
          { id: "b-pan", kind: "text", label: "Tax ID", group: "g-b", personalData: false },
        ],
      };
      expect(lintForm(layout)).toEqual([]);
    });

    it("fails the same name in one group, in groups with equal legends, or with one ungrouped", () => {
      const f = good();
      const base = {
        ...f,
        groups: [
          ...(f.groups ?? []),
          { id: "g-a", legend: "Applicant" },
          { id: "g-b", legend: "applicant" },
        ],
      };
      const tax = (id: string, group?: string): FormControl => ({
        id,
        kind: "text",
        label: "Tax ID",
        personalData: false,
        ...(group ? { group } : {}),
      });
      const same = lintForm({
        ...base,
        controls: [...f.controls, tax("x", "g-a"), tax("y", "g-a")],
      });
      expect(rules(same)).toEqual(["name-duplicate:y:error"]);
      const equal = lintForm({
        ...base,
        controls: [...f.controls, tax("x", "g-a"), tax("y", "g-b")],
      });
      expect(rules(equal)).toEqual(["name-duplicate:y:error"]);
      const loose = lintForm({ ...base, controls: [...f.controls, tax("x", "g-a"), tax("y")] });
      expect(rules(loose)).toEqual(["name-duplicate:y:error"]);
    });
  });

  describe("errors and required (3.3.1, 3.3.2, 1.3.1, 4.1.2)", () => {
    it("fails an error message that is not referenced", () => {
      const f = lintForm(withControl("email", { describedBy: ["email-hint"] }));
      expect(rules(f)).toEqual(["error-not-associated:email:error"]);
      expect(f[0]).toMatchObject({ sc: "3.3.1" });
    });

    it("fails an error message without an id", () => {
      const f = lintForm(
        withControl("email", { errorId: undefined as unknown as string, describedBy: [] }),
      );
      expect(f[0]?.message).toMatch(/has no id/);
    });

    it("accepts aria-errormessage only while aria-invalid is true", () => {
      expect(
        lintForm(
          withControl("email", { describedBy: ["email-hint"], errorMessage: "email-error" }),
        ),
      ).toEqual([]);
      const f = lintForm(
        withControl("email", {
          describedBy: ["email-hint"],
          errorMessage: "email-error",
          invalid: false,
        }),
      );
      expect(rules(f)).toEqual([
        "error-not-associated:email:error",
        "error-state-missing:email:warning",
      ]);
      expect(f[0]?.message).toMatch(/aria-invalid is true/);
    });

    it("warns when an error is shown but aria-invalid is not set", () => {
      expect(
        rules(lintForm(withControl("email", { invalid: undefined as unknown as boolean }))),
      ).toEqual(["error-state-missing:email:warning"]);
    });

    it("fails a label marked required on a control that is not", () => {
      const f = lintForm(withControl("full-name", { required: false }));
      expect(rules(f)).toEqual(["required-not-programmatic:full-name:error"]);
      expect(f[0]).toMatchObject({ sc: "1.3.1" });
      expect(rules(lintForm(withControl("notes", { label: "Anything else? (required)" })))).toEqual(
        ["required-not-programmatic:notes:error"],
      );
    });

    it("warns on a required control with no visible marker, unless it has an indicator", () => {
      expect(rules(lintForm(withControl("notes", { required: true })))).toEqual([
        "required-not-visible:notes:warning",
      ]);
      expect(lintForm(withControl("notes", { required: true, requiredIndicator: true }))).toEqual(
        [],
      );
    });
  });

  describe("focus order (2.4.3, 2.1.1)", () => {
    it("fails a positive tabindex and warns on a negative one", () => {
      expect(rules(lintForm(withControl("notes", { tabIndex: 2 })))).toEqual([
        "tabindex-positive:notes:error",
      ]);
      expect(rules(lintForm(withControl("notes", { tabIndex: -1 })))).toEqual([
        "tabindex-removed:notes:warning",
      ]);
      expect(lintForm(withControl("notes", { tabIndex: 0 }))).toEqual([]);
    });
  });

  describe("headings (1.3.1, 2.4.6)", () => {
    it("fails a skipped level and an empty heading", () => {
      const f = lintForm({
        ...good(),
        headings: [
          { id: "h1", level: 2, text: "Contact details" },
          { id: "h2", level: 4, text: " " },
        ],
      });
      expect(rules(f)).toEqual(["heading-empty:h2:error", "heading-skip:h2:error"]);
      expect(f.find((x) => x.rule === "heading-skip")).toMatchObject({
        sc: "1.3.1",
        message: "h4 follows h2; heading levels must not skip",
      });
    });

    it("checks the first heading against the parent level when given", () => {
      expect(rules(lintForm(good(), { parentHeadingLevel: 0 }))).toEqual([
        "heading-skip:h-contact:error",
      ]);
      expect(lintForm(good(), { parentHeadingLevel: 1 })).toEqual([]);
    });

    it("warns when the form has neither a heading nor a title", () => {
      expect(rules(lintForm({ ...good(), title: "", headings: [] }))).toEqual([
        "heading-missing:contact:warning",
      ]);
      expect(lintForm({ ...good(), headings: [] })).toEqual([]);
    });
  });

  describe("groups (1.3.1)", () => {
    it("fails an ungrouped radio and a group without a legend", () => {
      const f = lintForm({
        ...withControl("ch-email", { group: undefined as unknown as string }),
        groups: [{ id: "g-channel", legend: "" }],
      });
      expect(rules(f)).toEqual([
        "group-legend-missing:g-channel:error",
        "group-missing:ch-email:error",
      ]);
    });

    it("fails a set of same-named checkboxes outside a group, but not a lone checkbox", () => {
      const box = (id: string, label: string): FormControl => ({
        id,
        kind: "checkbox",
        name: "topics",
        label,
      });
      expect(lintForm(withControl("notes", null, [box("t1", "News")]))).toEqual([]);
      expect(
        rules(lintForm(withControl("notes", null, [box("t1", "News"), box("t2", "Offers")]))),
      ).toEqual(["group-missing:t1:error", "group-missing:t2:error"]);
    });

    it("fails an unknown group and warns on a legendless group of text fields", () => {
      const f = good();
      const layout: FormLayoutInput = {
        ...f,
        groups: [...(f.groups ?? []), { id: "g-addr" }],
        controls: [
          ...f.controls,
          { id: "x", kind: "text", label: "Reference", group: "g-addr" },
          { id: "y", kind: "text", label: "Other", group: "g-nope" },
        ],
      };
      expect(rules(lintForm(layout))).toEqual([
        "group-legend-missing:g-addr:warning",
        "group-unknown:y:error",
      ]);
    });
  });

  describe("input purpose (1.3.5)", () => {
    it("validates autocomplete token lists from the HTML specification", () => {
      for (const ok of [
        "on",
        "off",
        "name",
        "EMAIL",
        "section-a shipping street-address",
        "billing work tel",
        "mobile tel-national",
        "username webauthn",
        "section-x postal-code",
      ])
        expect(isValidAutocomplete(ok), ok).toBe(true);
      for (const bad of [
        "",
        "nope",
        "work name",
        "shipping",
        "section- name",
        "name email",
        "off name",
      ])
        expect(isValidAutocomplete(bad), bad).toBe(false);
    });

    it("fails an invalid token", () => {
      const f = lintForm(withControl("full-name", { autocomplete: "fullname" }));
      expect(rules(f)).toEqual(["autocomplete-invalid:full-name:error"]);
      expect(f[0]).toMatchObject({ sc: "1.3.5" });
    });

    it("fails a personal-data input without a purpose, by kind or by flag", () => {
      expect(
        rules(lintForm(withControl("email", { autocomplete: undefined as unknown as string }))),
      ).toEqual(["autocomplete-missing:email:error"]);
      expect(rules(lintForm(withControl("email", { autocomplete: "off" })))).toEqual([
        "autocomplete-missing:email:error",
      ]);
      expect(rules(lintForm(withControl("notes", { personalData: true })))).toEqual([
        "autocomplete-missing:notes:error",
      ]);
      expect(lintForm(withControl("email", { autocomplete: "", personalData: false }))).toEqual([]);
    });

    it("warns when the label suggests personal data, naming the token", () => {
      const f = lintForm(
        withControl("notes", null, [
          { id: "dob", kind: "date", label: "Date of birth" },
          { id: "pin", kind: "text", label: "PIN code" },
          { id: "ref", kind: "text", label: "Reference number" },
        ]),
      );
      expect(rules(f)).toEqual([
        "autocomplete-missing:dob:warning",
        "autocomplete-missing:pin:warning",
      ]);
      expect(f[0]?.message).toContain('"bday"');
      expect(f[1]?.message).toContain('"postal-code"');
    });
  });

  describe("id references (4.1.2, 1.3.1, 3.3.1)", () => {
    it("fails labelledBy, describedBy and errorMessage that point at missing ids", () => {
      const f = good();
      const layout: FormLayoutInput = {
        ...f,
        groups: [{ id: "g-channel", legend: "How?", labelledBy: ["gone"] }],
        controls: f.controls.map((c) =>
          c.id === "notes"
            ? {
                ...c,
                labelledBy: ["missing-a"],
                describedBy: ["missing-b"],
                errorMessage: "missing-c",
              }
            : c,
        ),
      };
      expect(rules(lintForm(layout))).toEqual([
        "labelledby-target-missing:g-channel:error",
        "describedby-target-missing:notes:error",
        "errormessage-target-missing:notes:error",
        "labelledby-target-missing:notes:error",
      ]);
    });

    it("fails a duplicate id", () => {
      const f = lintForm(
        withControl("notes", null, [{ id: "h-prefs", kind: "text", label: "Other" }]),
      );
      expect(rules(f)).toEqual(["id-duplicate:h-prefs:error"]);
    });
  });

  it("warns when the form has no submit button (3.2.2)", () => {
    const f = lintForm(withControl("send", null));
    expect(f).toEqual([
      expect.objectContaining({ rule: "submit-missing", sc: "3.2.2", subject: "contact" }),
    ]);
  });

  it("orders findings by form, headings, groups and controls, then rule", () => {
    const f = good();
    const layout: FormLayoutInput = {
      ...f,
      title: "",
      headings: [],
      groups: [{ id: "g-channel", legend: "" }],
      controls: [
        { id: "z", kind: "text", tabIndex: 3 },
        ...f.controls.filter((c) => c.kind !== "submit"),
      ],
    };
    const a = lintForm(layout);
    expect(rules(a)).toEqual([
      "heading-missing:contact:warning",
      "submit-missing:contact:warning",
      "group-legend-missing:g-channel:error",
      "name-missing:z:error",
      "tabindex-positive:z:error",
    ]);
    expect(lintForm(layout)).toEqual(a);
    expect(sortFindings([...a].reverse(), ["contact", "g-channel", "z"])).toEqual(a);
  });
});
