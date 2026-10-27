---
"@infrabyx/brand": minor
---

Owner answer #52 (PL5-D-05): the contrast guard checks each colour against the roles it is used in. A primary keeps the strict rule (at least 3:1 on the surface, text on it at least 4.5:1). An accent may be lighter, but only as a filled background with text on it at least 4.5:1; on a light surface it is never text, an icon, a border or a focus ring. Each failure carries its `role` and `reason` (`contrast` with the nearest compliant colour, or `role_not_permitted`). `contrastGuard` takes `roles` for a product's extra uses; `COLOUR_ROLES`, `DEFAULT_ROLES` and `isLightSurface` are exported.
