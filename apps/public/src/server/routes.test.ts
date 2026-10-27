import { describe, expect, it } from "vitest";
import { servedRoutes, STATIC_ROUTES } from "./routes.ts";

describe("servedRoutes (journeys-lint input, IPB-06-58)", () => {
  it("names CMS pages by path and detail pages by their pattern, once each", () => {
    const routes = servedRoutes([
      { path: "/", type: "page" },
      { path: "/about", type: "page" },
      { path: "/group-companies/udofin", type: "group_company" },
      { path: "/group-companies/finbyx", type: "group_company" },
      { path: "/careers/engineer", type: "job" },
    ]);
    expect(routes).toContain("/about");
    expect(routes).toContain("/group-companies/*");
    expect(routes).toContain("/careers/*");
    expect(routes).not.toContain("/group-companies/udofin");
    expect(routes.filter((r) => r === "/group-companies/*")).toHaveLength(1);
  });

  it("always lists the app's own routes", () => {
    const routes = servedRoutes([]);
    for (const r of STATIC_ROUTES) expect(routes).toContain(r.path);
    expect(routes).toEqual(expect.arrayContaining(["/legal/*", "/feedback/*", "/__gallery"]));
  });
});
