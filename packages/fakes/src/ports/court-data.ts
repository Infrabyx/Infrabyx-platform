// COURT_DATA fake and contract cases (Finbyx PR-FBX-42; ADR-0009; R1-D-104). The fake reads no
// court: a test seeds cases (`seed`) with their hearings and orders and the cause lists that list
// them. Order documents go to an in-memory STORAGE map under the request's output prefix. The
// cases hold every adapter to the port's rules: read-only, every result names its source and
// time, an unknown case is IPB-PORT-005, and an order is stored once with its hash.
import { PortError } from "@infrabyx/contracts/errors";
import {
  CaseLookup,
  CauseListRequest,
  FetchOrderRequest,
  type AdapterDescriptor,
  type CauseList,
  type CourtCase,
  type CourtDataPort,
  type CourtOrderRef,
  type CourtSource,
  type Hearing,
  type PortHealth,
  type StoredCourtOrder,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";

export interface SeededCase {
  case: Omit<CourtCase, "source">;
  hearings: Hearing[];
  orders: Array<Omit<CourtOrderRef, "source" | "cnr">>;
}

const src = (): CourtSource => ({
  adapter: "fake-court-data",
  fetchedAt: new Date().toISOString(),
});

export class FakeCourtData implements CourtDataPort {
  readonly descriptor: AdapterDescriptor = {
    port: "COURT_DATA",
    adapter: "fake-court-data",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  readonly storage = new Map<string, Buffer>();
  private readonly cases = new Map<string, SeededCase>();
  private readonly stored = new Map<string, StoredCourtOrder>();

  /** Test control: a case the source knows. */
  seed(c: SeededCase): void {
    this.cases.set(c.case.cnr, structuredClone(c));
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: new Date().toISOString() };
  }

  async lookupCase(raw: CaseLookup): Promise<CourtCase> {
    const q = CaseLookup.parse(raw);
    const found =
      "cnr" in q
        ? this.cases.get(q.cnr)
        : [...this.cases.values()].find(
            (c) =>
              c.case.court.state === q.court.state &&
              c.case.court.establishment === q.court.establishment &&
              c.case.caseType === q.caseType &&
              c.case.number === q.number &&
              c.case.year === q.year,
          );
    if (!found) throw new PortError("IPB-PORT-005", "COURT_DATA", { detail: "no such case" });
    return { ...structuredClone(found.case), source: src() };
  }

  async hearings(cnr: string): Promise<Hearing[]> {
    return structuredClone(this.must(cnr).hearings).sort((a, b) => a.on.localeCompare(b.on));
  }

  async orders(cnr: string): Promise<CourtOrderRef[]> {
    return this.must(cnr)
      .orders.map((o) => ({ ...o, cnr, source: src() }))
      .sort((a, b) => a.on.localeCompare(b.on));
  }

  async fetchOrder(raw: FetchOrderRequest): Promise<StoredCourtOrder> {
    const req = FetchOrderRequest.parse(raw);
    const key = `${req.cnr}/${req.orderId}`;
    const have = this.stored.get(key);
    if (have) return have;
    const o = this.must(req.cnr).orders.find((x) => x.orderId === req.orderId);
    if (!o) throw new PortError("IPB-PORT-005", "COURT_DATA", { detail: "no such order" });
    const bytes = Buffer.from(`order ${key}`);
    const storageKey = `${req.outputPrefix}/${req.cnr}-${req.orderId.replace(/[^A-Za-z0-9]/g, "")}.pdf`;
    this.storage.set(storageKey, bytes);
    const s: StoredCourtOrder = {
      ...o,
      cnr: req.cnr,
      source: src(),
      file: { storageKey, sha256: sha256Hex(bytes) },
      contentType: "application/pdf",
    };
    this.stored.set(key, s);
    return s;
  }

  async causeList(raw: CauseListRequest): Promise<CauseList> {
    const req = CauseListRequest.parse(raw);
    let item = 0;
    const entries = [...this.cases.values()]
      .filter(
        (c) =>
          c.case.court.state === req.court.state &&
          c.case.court.establishment === req.court.establishment &&
          c.case.nextHearingOn === req.on,
      )
      .map((c) => ({
        item: ++item,
        cnr: c.case.cnr,
        caseNumber: `${c.case.caseType}/${c.case.number}/${c.case.year}`,
        purpose: c.case.stage,
        bench: null,
      }));
    return { court: req.court, on: req.on, entries, source: src() };
  }

  private must(cnr: string): SeededCase {
    const c = this.cases.get(cnr);
    if (!c) throw new PortError("IPB-PORT-005", "COURT_DATA", { detail: "no such case" });
    return c;
  }
}
