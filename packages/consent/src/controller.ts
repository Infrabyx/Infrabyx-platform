// The CMP controller: the one first-party script the site loads for consent (PL5 plan §3.5), served
// from the site's own origin under the CSP nonce (`/consent.js`). Without it every control still
// works as a form post. With it:
//   - banner and preference-centre buttons post with fetch and update the page in place;
//   - Escape on the banner records Reject for every non-necessary category (IPB-04-75, 04-83);
//   - `[data-cmp-open]` links ("Cookie settings") open the preference centre (IPB-04-80);
//   - inert `script[type="text/plain"][data-consent]` declarations are activated only for the
//     consented categories; a script created by this nonced script is allowed by 'strict-dynamic'.
export const CMP_CONTROLLER_JS = String.raw`(() => {
  "use strict";
  const read = () => {
    const m = /(?:^|; )ibx_consent=v1\.[0-9.]+\.([01])([01])([01])\./.exec(document.cookie);
    return m ? { functional: m[1] === "1", analytics: m[2] === "1", marketing: m[3] === "1" } : null;
  };
  const activate = () => {
    const c = read();
    if (!c) return;
    for (const s of document.querySelectorAll('script[type="text/plain"][data-consent]')) {
      const cat = s.getAttribute("data-consent");
      if (!c[cat] || s.hasAttribute("data-activated")) continue;
      const n = document.createElement("script");
      n.src = s.getAttribute("data-src");
      if (s.hasAttribute("data-async")) n.async = true;
      s.setAttribute("data-activated", "");
      s.after(n);
    }
  };
  const post = async (form, action) => {
    const body = new URLSearchParams(new FormData(form));
    body.set("action", action);
    const r = await fetch(form.action, { method: "POST", body, credentials: "same-origin", headers: { accept: "application/json" } });
    return r.ok;
  };
  const banner = document.querySelector('[data-cmp="banner"]');
  if (banner) {
    const form = banner.querySelector("form");
    banner.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-cmp-action]");
      if (!b) return;
      const action = b.getAttribute("data-cmp-action");
      if (action === "manage") return;
      e.preventDefault();
      if (await post(form, action)) { banner.hidden = true; activate(); }
    });
    banner.addEventListener("keydown", async (e) => {
      if (e.key !== "Escape") return;
      if (await post(form, "reject_all")) banner.hidden = true;
    });
  }
  const centre = document.querySelector('[data-cmp="centre"]');
  if (centre) {
    centre.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-cmp-action]");
      if (!b) return;
      e.preventDefault();
      if (await post(centre, b.getAttribute("data-cmp-action"))) {
        const s = centre.querySelector('[role="status"][data-cmp-saved]') || centre.appendChild(Object.assign(document.createElement("p"), { role: "status" }));
        s.setAttribute("data-cmp-saved", "");
        s.textContent = "Your choices are saved.";
        activate();
      }
    });
  }
  activate();
})();
`;
