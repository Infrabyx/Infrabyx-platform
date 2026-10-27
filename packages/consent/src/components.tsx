// The CMP components, server-rendered (IPB-04-75…84; `@IPB-04-AT-80`, `-81`, `-84`; owner rule O-2).
// Accept all, Reject all and Manage are the same `Button` with the same variant, size and tab order
// (no colour bias). Both are plain forms posting to the consent endpoint, so they work without
// JavaScript; the first-party controller (`controller.ts`) enhances them. Text is at least 16 px
// and motion respects `prefers-reduced-motion` (CMP_CSS). The banner is a non-modal region, never
// auto-dismissed; the preference centre lists every category with its cookies and vendors.
import type { ReactNode } from "react";
import { Button, CheckboxField } from "@infrabyx/ui";
import type { ConsentChoice } from "@infrabyx/contracts/ports";
import { COOKIE_REGISTRY, VENDORS, type BannerState } from "./cmp.js";

export interface CmpTexts {
  banner: string;
  gpc: string;
  categories: Record<"necessary" | "functional" | "analytics" | "marketing", string>;
}

const Hidden = ({ csrf }: { csrf?: { name: string; value: string } | undefined }) =>
  csrf ? <input type="hidden" name={csrf.name} value={csrf.value} /> : null;

/** The three equal controls; the same component renders each (IPB-04-75). */
export function CmpChoices({ csrf }: { csrf?: { name: string; value: string } | undefined }) {
  return (
    <>
      <Hidden csrf={csrf} />
      <Button type="submit" name="action" value="accept_all" data-cmp-action="accept_all">
        Accept all
      </Button>
      <Button type="submit" name="action" value="reject_all" data-cmp-action="reject_all">
        Reject all
      </Button>
      <Button type="submit" name="action" value="manage" data-cmp-action="manage">
        Manage
      </Button>
    </>
  );
}

export function CookieBanner(p: {
  state: BannerState;
  texts: CmpTexts;
  action?: string;
  csrf?: { name: string; value: string };
  preferencePath?: string;
}) {
  if (!p.state.show) return null;
  return (
    <section
      className="ibx-cmp"
      role="region"
      aria-labelledby="ibx-cmp-title"
      data-cmp="banner"
      data-region={p.state.region}
    >
      <h2 id="ibx-cmp-title" className="ibx-cmp__title">
        Cookie choices
      </h2>
      <p className="ibx-cmp__text">{p.texts.banner}</p>
      {p.state.gpc ? (
        <p className="ibx-cmp__gpc" role="status">
          {p.texts.gpc}
        </p>
      ) : null}
      <form className="ibx-cmp__actions" method="post" action={p.action ?? "/api/consent"}>
        <CmpChoices csrf={p.csrf} />
      </form>
      {p.state.doNotSell ? (
        <p className="ibx-cmp__ccpa">
          <a href={`${p.preferencePath ?? "/cookie-settings"}#do-not-sell`}>
            Do Not Sell or Share My Personal Information
          </a>
        </p>
      ) : null}
    </section>
  );
}

const CATEGORY_LABEL = {
  necessary: "Necessary",
  functional: "Functional",
  analytics: "Analytics",
  marketing: "Marketing",
} as const;

/** The preference centre: current choices, every category with its cookies and vendors, equal actions. */
export function PreferenceCentre(p: {
  state: BannerState;
  texts: CmpTexts;
  action?: string;
  csrf?: { name: string; value: string };
}) {
  const row = (c: keyof typeof CATEGORY_LABEL): ReactNode => {
    const cookies = COOKIE_REGISTRY.filter((x) => x.category === c);
    const vendors = c === "necessary" ? [] : VENDORS.filter((v) => v.category === c);
    return (
      <fieldset key={c} className="ibx-cmp__category">
        <legend>{CATEGORY_LABEL[c]}</legend>
        <p id={`ibx-cmp-${c}-desc`}>{p.texts.categories[c]}</p>
        {c === "necessary" ? (
          <p className="ibx-cmp__always">Always on</p>
        ) : (
          <CheckboxField
            id={`ibx-cmp-${c}`}
            name={c}
            label={`Allow ${CATEGORY_LABEL[c].toLowerCase()} cookies`}
            helpKey={`hlp.consent.${c}`}
            checked={(p.state.choice as ConsentChoice)[c]}
          />
        )}
        {cookies.length || vendors.length ? (
          <table className="ibx-table">
            <caption>{CATEGORY_LABEL[c]} cookies and vendors</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Provider</th>
                <th scope="col">Purpose</th>
                <th scope="col">Duration</th>
              </tr>
            </thead>
            <tbody>
              {cookies.map((x) => (
                <tr key={x.name}>
                  <td>{x.name}</td>
                  <td>{x.provider}</td>
                  <td>{x.purpose}</td>
                  <td>{x.duration}</td>
                </tr>
              ))}
              {vendors.map((v) => (
                <tr key={v.name}>
                  <td>{v.name}</td>
                  <td>
                    <a href={v.policyUrl}>{v.name}</a>
                  </td>
                  <td>{v.purpose}</td>
                  <td>See the vendor</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No cookies in this category at present.</p>
        )}
      </fieldset>
    );
  };
  return (
    <form
      className="ibx-cmp-centre"
      method="post"
      action={p.action ?? "/api/consent"}
      data-cmp="centre"
    >
      <Hidden csrf={p.csrf} />
      <input type="hidden" name="from" value="preference_centre" />
      {p.state.gpc ? <p role="status">{p.texts.gpc}</p> : null}
      {p.state.categories.map((c) => row(c))}
      {p.state.doNotSell ? (
        <p id="do-not-sell">
          Turning marketing cookies off opts you out of the sale or sharing of personal information.
        </p>
      ) : null}
      <div className="ibx-cmp__actions">
        <Button type="submit" name="action" value="save" data-cmp-action="save">
          Save choices
        </Button>
        <Button type="submit" name="action" value="accept_all" data-cmp-action="accept_all">
          Accept all
        </Button>
        <Button type="submit" name="action" value="reject_all" data-cmp-action="reject_all">
          Reject all
        </Button>
      </div>
    </form>
  );
}

/** CMP layout: a bottom sheet that never blocks content, text at least 16 px, no motion when reduced. */
export const CMP_CSS = String.raw`
.ibx-cmp { position: fixed; inset: auto 0 0 0; z-index: 50; background: var(--color-surface); color: var(--color-text); border-top: 2px solid var(--color-border-strong); padding: var(--space-4); font-size: max(1rem, 16px); box-shadow: var(--shadow-2); }
.ibx-cmp__title { font-size: var(--text-lg); margin: 0 0 var(--space-2); }
.ibx-cmp__actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.ibx-cmp__actions .ibx-button { flex: 1 1 10rem; }
.ibx-cmp-centre { font-size: max(1rem, 16px); }
.ibx-cmp__category { margin: 0 0 var(--space-4); }
@media (prefers-reduced-motion: no-preference) { .ibx-cmp { transition: transform var(--duration-base) ease-out; } }
`;
