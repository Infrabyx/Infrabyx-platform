// The local stack's layout from the product setting (DEV-LOCAL-01, R1-D-290).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APP_PORT_BASE,
  composeApps,
  LOCAL_ENV_KEYS,
  LOCAL_PRODUCTS,
  localStack,
  PORT_DEFAULTS,
  PRODUCT_PORT_OFFSETS,
  portBlocksOverlap,
  readLocalSetting,
  realmRedirects,
  SEED_REFUSED_ENVS,
} from "./local-stack.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** A product with two web apps (a borrower app and a portal), as Udofin has. */
const udofin = {
  product: "UDF",
  local: {
    apps: [
      { name: "api", dir: "apps/api", kind: "api", slot: 5 },
      { name: "worker", dir: "apps/worker", kind: "worker", slot: 6 },
      { name: "web", dir: "apps/web", kind: "web", slot: 7 },
      { name: "portal", dir: "apps/portal", kind: "web", slot: 8, postLogoutPath: "/signed-out" },
    ],
  },
};

describe("local stack: project and port blocks", () => {
  it("names the project after the product code and gives each product its own block", () => {
    const s = localStack(udofin);
    expect(s.project).toBe("infrabyx-udf");
    expect(s.offset).toBe(100);
    expect(s.ports.PG_PORT).toBe(55532);
    expect(s.ports.KEYCLOAK_PORT).toBe(58180);
    expect(s.apps.find((a) => a.name === "portal").port).toBe(APP_PORT_BASE + 8 + 100);
    // Finbyx keeps today's ports.
    expect(localStack({ product: "FBX" }).ports).toEqual(PORT_DEFAULTS);
    expect(localStack({ product: "FBX" }).project).toBe("infrabyx-fbx");
  });

  it("no two product blocks share a port, and every product has a block", () => {
    expect(portBlocksOverlap()).toEqual([]);
    expect(Object.keys(PRODUCT_PORT_OFFSETS).sort()).toEqual([...LOCAL_PRODUCTS].sort());
    // The check itself catches a clash (MinIO + 200 is OpenSearch).
    expect(portBlocksOverlap({ FBX: 0, X: 200 })).toContain("FBX/X:59200");
    for (const off of Object.values(PRODUCT_PORT_OFFSETS))
      for (const p of Object.values(PORT_DEFAULTS)) expect(p + off).toBeLessThan(65536);
  });

  it("the platform repository keeps today's ports under its own project", () => {
    const s = localStack(readLocalSetting(ROOT));
    expect(s.project).toBe("infrabyx-platform");
    expect(s.ports.PG_PORT).toBe(55432);
    expect(s.apps.map((a) => [a.name, a.port, a.product])).toEqual([
      ["public", 53123, "OH"],
      ["console", 53124, "OH"],
      ["api", 53125, "LD"],
      ["worker", 53126, "LD"],
      ["web", 53127, "LD"],
    ]);
  });

  it("a port set in .env.local wins; a bad one is refused", () => {
    expect(localStack(udofin, { PG_PORT: "55999" }).ports.PG_PORT).toBe(55999);
    expect(localStack(udofin, { WEB_PORT: "54000" }).apps.find((a) => a.name === "web").port).toBe(
      54000,
    );
    expect(localStack(udofin, { PG_PORT: "" }).ports.PG_PORT).toBe(55532);
    expect(() => localStack(udofin, { PG_PORT: "80" })).toThrow(/PG_PORT/);
  });

  it.each([
    [{ product: "XX" }, /infrabyx.product/],
    [{ product: "UDF", local: { project: "Bad Name" } }, /project/],
    [{ product: "UDF", local: { portOffset: -1 } }, /portOffset/],
    [
      { product: "UDF", local: { apps: [{ name: "web", dir: "../x", kind: "web", slot: 1 }] } },
      /dir/,
    ],
    [
      { product: "UDF", local: { apps: [{ name: "web", dir: "apps/web", kind: "spa", slot: 1 }] } },
      /kind/,
    ],
    [
      {
        product: "UDF",
        local: { apps: [{ name: "web", dir: "apps/web", kind: "web", slot: 20 }] },
      },
      /slot/,
    ],
    [
      {
        product: "UDF",
        local: {
          apps: [
            { name: "api", dir: "apps/api", kind: "api", slot: 1 },
            { name: "web", dir: "apps/web", kind: "web", slot: 1 },
          ],
        },
      },
      /slot 1 is declared twice/,
    ],
    [
      { product: "UDF", local: { apps: [{ name: "web", dir: "apps/web", kind: "web", slot: 2 }] } },
      /must name its api/,
    ],
    [
      {
        product: "UDF",
        local: { apps: [{ name: "web", dir: "apps/web", kind: "web", slot: 2, api: "nope" }] },
      },
      /not a declared api/,
    ],
    [
      {
        product: "UDF",
        local: {
          apps: [
            { name: "api", dir: "apps/api", kind: "api", slot: 1 },
            { name: "web", dir: "apps/web", kind: "web", slot: 2, callbackPath: "https://evil/cb" },
          ],
        },
      },
      /callbackPath/,
    ],
  ])("refuses an invalid setting (%#)", (setting, msg) => {
    expect(() => localStack(setting)).toThrow(msg);
  });
});

describe("local stack: apps and the realm", () => {
  it("registers every declared web app's callback and post-logout URI, and each api's callback", () => {
    expect(realmRedirects(localStack(udofin))).toEqual({
      redirectUris: [
        "http://localhost:53225/auth/callback",
        "http://localhost:53227/auth/callback",
        "http://localhost:53228/auth/callback",
      ],
      postLogoutRedirectUris: ["http://localhost:53227/", "http://localhost:53228/signed-out"],
    });
  });

  it("builds and runs the product's own apps with its product code, never the reference's", () => {
    const { services } = composeApps(localStack(udofin));
    expect(Object.keys(services)).toEqual(["api", "worker", "web", "portal"]);
    expect(services.api.build.args.APP).toBe("api");
    expect(services.portal.build.args.APP).toBe("portal");
    for (const s of Object.values(services)) {
      expect(s.environment.APP_PRODUCT).toBe("UDF");
      expect(s.profiles).toEqual(["apps"]);
      expect(s.cap_drop).toEqual(["ALL"]);
      expect(s.read_only).toBe(true);
    }
    expect(services.portal.environment.APP_BASE_URL).toBe("http://localhost:53228");
    expect(services.portal.environment.APP_API_URL).toBe("http://127.0.0.1:53225");
    expect(services.worker.environment.PORT).toBe("53226");
    expect(services.api.environment.DB_URL).toContain("@127.0.0.1:55532/");
    expect(JSON.stringify(services)).not.toMatch(/"LD"|reference\//);
  });

  it("leaves out a declared app whose folder is missing (no public site, no public seed)", () => {
    const s = localStack({
      product: "UDF",
      local: {
        apps: [
          { name: "api", dir: "apps/api", kind: "api", slot: 5 },
          { name: "public", dir: "apps/public", kind: "public", slot: 3 },
        ],
      },
    });
    expect(Object.keys(composeApps(s, (d) => d !== "apps/public").services)).toEqual(["api"]);
  });

  it("keeps the migrations' recorded name of every earlier copy for a single api", () => {
    expect(localStack(udofin).apps.find((a) => a.name === "api").migrationName).toBe("reference");
  });

  it("the platform's own apps file matches what the old compose file ran", () => {
    const { services } = composeApps(localStack(readLocalSetting(ROOT)));
    expect(services.api.build.args.APP).toBe("reference/api");
    expect(services.web.build.args.APP).toBe("reference/web");
    expect(services.public.build.args.APP).toBe("public");
    expect(services.public.ports).toEqual(["127.0.0.1:53123:3000"]);
    expect(services.console.environment.APP_SITE_URL).toBe("http://localhost:53123");
    expect(services.api.environment.APP_WEB_URL).toBe("http://localhost:53127");
    expect(services.api.environment.APP_PRODUCT).toBe("LD");
    expect(services.web.depends_on).toEqual({ api: { condition: "service_healthy" } });
  });
});

describe("local stack: .env.example and seeds", () => {
  it("infra/compose/.env.example lists every variable dev:up, the migrations and the seeds need, with no value", () => {
    const lines = read("infra/compose/.env.example").split("\n");
    for (const k of LOCAL_ENV_KEYS)
      expect(
        lines.some((l) => l.startsWith(`${k}=`)),
        k,
      ).toBe(true);
    for (const l of lines.filter((x) => /^[A-Z0-9_]+=/.test(x)))
      expect(l.replace(/\s+#.*$/, ""), l).toMatch(/^[A-Z0-9_]+=$/);
  });

  it("dev:up names every port variable the compose file reads", () => {
    const compose = read("infra/compose/docker-compose.yml");
    const used = [...compose.matchAll(/\$\{([A-Z0-9_]+_PORT):-(\d+)\}/g)];
    expect(used.length).toBeGreaterThan(10);
    for (const [, key, def] of used) expect(PORT_DEFAULTS[key], key).toBe(Number(def));
    expect(compose).not.toMatch(/^name:/m);
  });

  it("refuses the same environments as @infrabyx/contracts", async () => {
    const { SEED_REFUSED_ENVS: contracts } = await import("../packages/contracts/dist/env.js");
    expect(SEED_REFUSED_ENVS).toEqual([...contracts]);
  });

  it("dev:down keeps the volumes unless --volumes is given, and names only its own project", () => {
    const devUp = read("scripts/dev-up.mjs");
    expect(devUp).toMatch(/\.\.\.\(volumes \? \["--volumes"\] : \[\]\)/);
    expect(devUp).toContain('"-p", stack.project');
    expect(devUp).not.toMatch(/"down",\s*"--volumes"/);
  });
});
