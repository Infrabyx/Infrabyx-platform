import { describe, expect, it } from "vitest";
import { checkWebEnv, type WebEnv } from "./env.ts";

const env = (o: Partial<WebEnv>): WebEnv => ({
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:53127",
  APP_API_URL: "http://127.0.0.1:53125",
  ...o,
});

describe("webEnv (IPB-SEC-018)", () => {
  it("allows plain HTTP to the API on loopback below staging only", () => {
    expect(checkWebEnv(env({})).APP_API_URL).toBe("http://127.0.0.1:53125");
    expect(() => checkWebEnv(env({ APP_API_URL: "http://api.internal:3000" }))).toThrow(
      /must be https in local/,
    );
    expect(() => checkWebEnv(env({ APP_ENV: "staging" }))).toThrow(/must be https in staging/);
    expect(checkWebEnv(env({ APP_ENV: "prod", APP_API_URL: "https://api.internal" })).APP_ENV).toBe(
      "prod",
    );
  });
});
