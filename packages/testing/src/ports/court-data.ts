// COURT_DATA fake and contract cases (Finbyx PR-FBX-42; ADR-0009; R1-D-104). The fake reads no
// court: a test seeds cases (`seed`) with their hearings and orders and the cause lists that list
// them. Order documents go to an in-memory STORAGE map under the request's output prefix. The
// cases hold every adapter to the port's rules: read-only, every result names its source and
// time, an unknown case is IPB-PORT-005, and an order is stored once with its hash.
// COURT_DATA fake and contract cases (Finbyx PR-FBX-42; ADR-0009; R1-D-104). The fake reads no
// court: a test seeds cases (`seed`) with their hearings and orders and the cause lists that list
// them. Order documents go to an in-memory STORAGE map under the request's output prefix. The
// cases hold every adapter to the port's rules: read-only, every result names its source and
// time, an unknown case is IPB-PORT-005, and an order is stored once with its hash.
import { expect } from "vitest";
import type { CourtDataPort } from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";
import { type SeededCase } from "@infrabyx/fakes";
export { type SeededCase, FakeCourtData } from "@infrabyx/fakes";

/** Seeds cases on the adapter under test (the fake's own control, or a sandbox's). */
export interface CourtDataScript {
  seed(c: SeededCase): void;
}

const CNR = "MHPU010012342025";
const court = { state: "MH", district: "pune", establishment: "PU01" };
const seeded: SeededCase = {
  case: {
    cnr: CNR,
    court,
    caseType: "CC",
    number: "1234",
    year: 2025,
    title: "Lender v. Borrower",
    status: "pending",
    stage: "evidence",
    filedOn: "2025-02-01",
    registeredOn: "2025-02-03",
    nextHearingOn: "2026-12-01",
    disposedOn: null,
  },
  hearings: [
    { on: "2025-06-10", purpose: "appearance", business: null, judge: null },
    { on: "2025-03-01", purpose: "admission", business: null, judge: null },
  ],
  orders: [{ orderId: "ord-2", kind: "interim_order", on: "2025-06-10" }],
};
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? "error",
  );

export function courtDataContractCases(s: CourtDataScript): ContractCase<CourtDataPort>[] {
  return [
    {
      name: "finds a case by CNR or by court, type, number and year, naming its source and time",
      async run(p) {
        s.seed(seeded);
        const a = await p.lookupCase({ cnr: CNR });
        expect(a).toMatchObject({ cnr: CNR, status: "pending", nextHearingOn: "2026-12-01" });
        expect(a.source.adapter.length).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(a.source.fetchedAt))).toBe(false);
        const b = await p.lookupCase({ court, caseType: "CC", number: "1234", year: 2025 });
        expect(b.cnr).toBe(CNR);
        expect(await code(p.lookupCase({ cnr: "MHPU019999992025" }))).toBe("IPB-PORT-005");
        await expect(p.lookupCase({ cnr: "not-a-cnr" })).rejects.toThrow();
      },
    },
    {
      name: "lists hearings and orders oldest first, and stores an order once with its hash",
      async run(p) {
        s.seed(seeded);
        expect((await p.hearings(CNR)).map((h) => h.on)).toEqual(["2025-03-01", "2025-06-10"]);
        const [o] = await p.orders(CNR);
        expect(o).toMatchObject({ cnr: CNR, orderId: "ord-2", kind: "interim_order" });
        const req = { cnr: CNR, orderId: "ord-2", outputPrefix: "tenant/tnt_a/court" };
        const f = await p.fetchOrder(req);
        expect(f.file.storageKey.startsWith("tenant/tnt_a/court/")).toBe(true);
        expect(f.file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(await p.fetchOrder(req)).toEqual(f);
        expect(await code(p.fetchOrder({ ...req, orderId: "ord-9" }))).toBe("IPB-PORT-005");
        await expect(p.fetchOrder({ ...req, outputPrefix: "elsewhere/court" })).rejects.toThrow();
      },
    },
    {
      name: "a cause list names the court, the day and the listed cases",
      async run(p) {
        s.seed(seeded);
        const l = await p.causeList({ court, on: "2026-12-01" });
        expect(l).toMatchObject({ on: "2026-12-01", court });
        expect(l.entries.some((e) => e.cnr === CNR)).toBe(true);
        expect((await p.causeList({ court, on: "2026-12-02" })).entries).toEqual([]);
      },
    },
  ];
}
