// `TallyPrimeStub`: an in-memory TallyPrime for tests (PR-FBX-46, R1-D-178). It speaks the XML
// envelope the agent sends (voucher import, the REMOTEID collection export, the ledger closing
// balances) and keeps vouchers per company. No real TallyPrime runs in CI (OWNER-QUESTIONS #128);
// the shapes are the agent's reading of Tally's documentation and stay [VERIFY].
//
// A second create with an existing REMOTEID behaves as the company's overwrite setting decides
// (R1-D-178): `duplicate` stores a second voucher, `alter` overwrites the first in place and
// answers ALTERED 1. Tests run under both, and can refuse the next import, lose its answer (the
// voucher is stored, the answer never arrives) or take TallyPrime down.
import { isoDate, paiseToRupees, rupeesToPaise } from "./amounts.js";
import type { FetchLike } from "./tally.js";
import { el, field, findAll, first, parseXml, type XmlElement } from "./xml.js";

export interface StubVoucher {
  guid: string;
  number: number;
  remoteId: string;
  voucherType: string;
  date: string;
  lines: Array<{ ledger: string; paise: number }>;
}

interface Company {
  ledgers: Set<string>;
  voucherTypes: Set<string>;
  from: string;
  to: string;
  vouchers: StubVoucher[];
}

export interface StubCompanyInput {
  name: string;
  ledgers: readonly string[];
  voucherTypes?: readonly string[];
  /** The open period (inclusive), YYYY-MM-DD. */
  from?: string;
  to?: string;
}

export class TallyPrimeStub {
  private readonly companies = new Map<string, Company>();
  private seq = 0;
  private refusals: string[] = [];
  private lose = 0;
  /** While true every request fails as a refused connection. */
  down = false;
  /** Requests seen, by kind. */
  readonly calls = { imports: 0, lookups: 0, balances: 0 };

  constructor(
    /** What a second create of an existing REMOTEID does. */
    public collision: "duplicate" | "alter" = "duplicate",
  ) {}

  company(c: StubCompanyInput): this {
    this.companies.set(c.name, {
      ledgers: new Set(c.ledgers),
      voucherTypes: new Set(c.voucherTypes ?? ["Journal", "Receipt", "Payment", "Contra"]),
      from: c.from ?? "2026-04-01",
      to: c.to ?? "2027-03-31",
      vouchers: [],
    });
    return this;
  }

  vouchers(company: string): readonly StubVoucher[] {
    return this.companies.get(company)?.vouchers ?? [];
  }

  /** A voucher entered by hand in TallyPrime (to stage a mismatch or a duplicate). */
  enter(company: string, v: Omit<StubVoucher, "guid" | "number">): StubVoucher {
    const c = this.companies.get(company);
    if (!c) throw new Error(`no company ${company}`);
    const s = { ...v, guid: `guid-${++this.seq}`, number: this.seq };
    c.vouchers.push(s);
    return s;
  }

  /** The next import is refused with this LINEERROR text. */
  refuseNextImport(text: string): void {
    this.refusals.push(text);
  }

  /** The next `n` imports are applied but their answers are lost. */
  loseNextAnswers(n = 1): void {
    this.lose += n;
  }

  readonly fetch: FetchLike = async (_url, init) => {
    if (this.down) throw new TypeError("fetch failed: connect ECONNREFUSED");
    const { body, lost } = this.handle(init.body);
    if (lost) throw new TypeError("fetch failed: socket hang up");
    const bytes = new TextEncoder().encode(body);
    return {
      status: 200,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  };

  handle(xml: string): { body: string; lost: boolean } {
    const doc = parseXml(xml);
    const request = (first(doc, "TALLYREQUEST") ?? "").toLowerCase();
    const companyName = first(doc, "SVCURRENTCOMPANY") ?? "";
    const company = this.companies.get(companyName);
    if (!company)
      return {
        body: el(
          "RESPONSE",
          null,
          el("LINEERROR", null, `Could not set 'SVCurrentCompany' to '${companyName}'`),
          el("CREATED", null, "0"),
          el("ERRORS", null, "1"),
        ).xml,
        lost: false,
      };
    if (request === "import data") return this.importVouchers(doc, company);
    const id = first(doc, "ID");
    if (id === "IPBVoucherByRemoteId") return { body: this.lookup(doc, company), lost: false };
    if (id === "IPBTrialBalance") return { body: this.balances(doc, company), lost: false };
    return {
      body: el("RESPONSE", null, el("LINEERROR", null, "Unknown request")).xml,
      lost: false,
    };
  }

  private importVouchers(doc: XmlElement, c: Company): { body: string; lost: boolean } {
    this.calls.imports++;
    const answer = (created: number, altered: number, error?: string) =>
      el(
        "RESPONSE",
        null,
        ...(error ? [el("LINEERROR", null, error)] : []),
        el("CREATED", null, String(created)),
        el("ALTERED", null, String(altered)),
        el("DELETED", null, "0"),
        el("LASTVCHID", null, String(this.seq)),
        el("ERRORS", null, error ? "1" : "0"),
      ).xml;
    const refusal = this.refusals.shift();
    if (refusal) return { body: answer(0, 0, refusal), lost: false };
    let created = 0;
    let altered = 0;
    for (const v of findAll(doc, "VOUCHER")) {
      if (v.attrs.ACTION !== "Create")
        return { body: answer(0, 0, "The agent only creates vouchers"), lost: false };
      const voucherType = field(v, "VOUCHERTYPENAME") ?? "";
      const date = isoDate(field(v, "DATE") ?? "") ?? "";
      if (!c.voucherTypes.has(voucherType))
        return { body: answer(0, 0, `Voucher Type '${voucherType}' does not exist!`), lost: false };
      if (date < c.from || date > c.to)
        return {
          body: answer(0, 0, `Voucher date is out of the financial period of the company`),
          lost: false,
        };
      const lines: StubVoucher["lines"] = [];
      for (const l of v.children.filter((x) => x.name === "ALLLEDGERENTRIES.LIST")) {
        const ledger = field(l, "LEDGERNAME") ?? "";
        if (!c.ledgers.has(ledger))
          return { body: answer(0, 0, `Ledger '${ledger}' does not exist!`), lost: false };
        lines.push({ ledger, paise: rupeesToPaise(field(l, "AMOUNT") ?? "") ?? NaN });
      }
      const remoteId = v.attrs.REMOTEID ?? "";
      const prior = c.vouchers.find((x) => x.remoteId === remoteId);
      if (prior && this.collision === "alter") {
        Object.assign(prior, { voucherType, date, lines });
        altered++;
      } else {
        c.vouchers.push({
          guid: `guid-${++this.seq}`,
          number: this.seq,
          remoteId,
          voucherType,
          date,
          lines,
        });
        created++;
      }
    }
    const lost = this.lose > 0;
    if (lost) this.lose--;
    return { body: answer(created, altered), lost };
  }

  private lookup(doc: XmlElement, c: Company): string {
    this.calls.lookups++;
    const formula = findAll(doc, "SYSTEM").find((s) => s.attrs.NAME === "IPBRemoteIdMatch");
    const m = /^\$RemoteID = "([^"]+)"$/.exec(formula?.text.trim() ?? "");
    const hits = m ? c.vouchers.filter((v) => v.remoteId === m[1]) : [];
    return el(
      "ENVELOPE",
      null,
      el("HEADER", null, el("VERSION", null, "1"), el("STATUS", null, "1")),
      el(
        "BODY",
        null,
        el("DESC", null),
        el(
          "DATA",
          null,
          el(
            "COLLECTION",
            null,
            ...hits.map((v) =>
              el(
                "VOUCHER",
                { REMOTEID: v.remoteId, VCHTYPE: v.voucherType, ACTION: "Create" },
                el("DATE", { TYPE: "Date" }, v.date.replace(/-/g, "")),
                el("GUID", { TYPE: "String" }, v.guid),
                el("VOUCHERTYPENAME", null, v.voucherType),
                el("VOUCHERNUMBER", null, String(v.number)),
                ...v.lines.map((l) =>
                  el(
                    "ALLLEDGERENTRIES.LIST",
                    null,
                    el("LEDGERNAME", null, l.ledger),
                    el("ISDEEMEDPOSITIVE", null, l.paise < 0 ? "Yes" : "No"),
                    el("AMOUNT", null, paiseToRupees(Math.abs(l.paise), l.paise < 0)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ).xml;
  }

  private balances(doc: XmlElement, c: Company): string {
    this.calls.balances++;
    const asOf = isoDate(first(doc, "SVTODATE") ?? "") ?? "9999-12-31";
    const bal = new Map<string, number>();
    for (const v of c.vouchers)
      if (v.date <= asOf)
        for (const l of v.lines) bal.set(l.ledger, (bal.get(l.ledger) ?? 0) + l.paise);
    return el(
      "ENVELOPE",
      null,
      el("HEADER", null, el("STATUS", null, "1")),
      el(
        "BODY",
        null,
        el(
          "DATA",
          null,
          el(
            "COLLECTION",
            null,
            ...[...c.ledgers].map((name) => {
              const p = bal.get(name) ?? 0;
              return el(
                "LEDGER",
                { NAME: name },
                el("CLOSINGBALANCE", null, p === 0 ? "" : paiseToRupees(Math.abs(p), p < 0)),
              );
            }),
          ),
        ),
      ),
    ).xml;
  }
}
