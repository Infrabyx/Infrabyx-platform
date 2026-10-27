---
"@infrabyx/ui": patch
---

PL5 session 7: the base styles hide every element with the `hidden` attribute (`[hidden] { display: none !important; }`), so a component's own `display` rule no longer shows a dismissed banner or a closed panel.
