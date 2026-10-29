// The IPB-10-07 interceptor (R1-D-27): POST and PATCH need a UUIDv7 key; the handler's
// IdempotentResult becomes the response, with the replay headers on a replay.
import { describe, expect, it } from "vitest";
import { of } from "rxjs";
import { idempotencyRequestHash, type IdempotencyRequest } from "./idempotency.js";
import { IdempotencyKeyInterceptor } from "./nest/index.js";

// UUIDv7 fixtures (IPB-10-07 asks for v7), built so no literal reads as a credential.
const uuid7 = (tail: number) => `01890a5d-ac96-774b-bcce-b302099a${tail}`;
const KEY = uuid7(8057);
function call(req: Record<string, unknown>, out: unknown) {
  const res = { code: 0, headers: {} as Record<string, string> };
  const http = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({
        status: (c: number) => (res.code = c),
        setHeader: (n: string, v: string) => (res.headers[n] = v),
      }),
    }),
  };
  return new Promise<{ body: unknown; res: typeof res }>((done) =>
    new IdempotencyKeyInterceptor()
      .intercept(http as never, { handle: () => of(out) } as never)
      .subscribe((body) => done({ body, res })),
  );
}

describe("@IPB-10-07 IdempotencyKeyInterceptor", () => {
  it("puts the key, route and request hash on a POST, and replays with the headers", async () => {
    const req: Record<string, unknown> = {
      method: "POST",
      route: { path: "/v1/loans" },
      body: { amount: 1 },
      headers: { "idempotency-key": KEY, "x-request-id": "req-2" },
    };
    const { body, res } = await call(req, {
      status: 201,
      body: { id: "l1" },
      replayed: true,
      originalRequestId: "req-1",
    });
    expect(req.idempotency as IdempotencyRequest).toEqual({
      key: KEY,
      route: "POST /v1/loans",
      requestHash: idempotencyRequestHash("POST", "POST /v1/loans", { amount: 1 }),
      requestId: "req-2",
    });
    expect(body).toEqual({ id: "l1" });
    expect(res).toEqual({
      code: 201,
      headers: { "Idempotent-Replayed": "true", "Idempotent-Original-Request-Id": "req-1" },
    });
  });

  it("refuses a POST or PATCH without a UUIDv7 key, and leaves a GET alone", async () => {
    for (const method of ["POST", "PATCH"])
      expect(() =>
        new IdempotencyKeyInterceptor().intercept(
          { switchToHttp: () => ({ getRequest: () => ({ method, headers: {} }) }) } as never,
          { handle: () => of(null) } as never,
        ),
      ).toThrow(expect.objectContaining({ code: "IPB-API-010" }));
    const { body } = await call({ method: "GET", headers: {} }, { plain: true });
    expect(body).toEqual({ plain: true });
  });
});
