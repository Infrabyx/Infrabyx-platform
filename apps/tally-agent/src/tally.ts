// The agent's TallyPrime client (PR-FBX-46, R1-D-137, R1-D-178): XML requests to TallyPrime's
// local port (default 9000) on the tenant's own network.
//
// Request and answer shapes follow Tally's documentation as far as it could be read from the build
// session (Tally Help "XML Integration", "Case Study I – XML Request and Response Formats", "Import
// Data – FAQ"; search snippets of help.tallysolutions.com, 18 Nov 2026; the site itself was not
// reachable): an ENVELOPE with HEADER and BODY; vouchers imported through "Import Data" /
// "Vouchers" with SVCURRENTCOMPANY; an import answers CREATED, ALTERED, ERRORS and LINEERROR; a
// collection is exported with its own TDL definition and a FILTER. Every shape here is
// [VERIFY with a TallyPrime sandbox company, OWNER-QUESTIONS #128], so the reader is tolerant of
// where elements sit and strict about what they hold.
//
// `REMOTEID` is not a uniqueness guarantee (R1-D-178): depending on the company's "Overwrite
// voucher when a voucher with same GUID exists" setting, a second create may duplicate the voucher
// or alter it in place. The agent therefore never creates a voucher it has not first looked up and
// found absent, and the vouchers a lookup returns are filtered again here by exact `REMOTEID`, in
// case TallyPrime ignored the filter.
import type { JournalEntry, TallyReasonCode } from "@infrabyx/contracts/ports";
import { isoDate, paiseToRupees, rupeesToPaise, tallyDate } from "./amounts.js";
import { el, field, findAll, first, parseXml, XmlError, type XmlElement } from "./xml.js";

export const REMOTE_ID = /^ipb:[A-Za-z0-9_.:-]{8,128}:[A-Za-z0-9_./:-]{1,64}$/;
/** The `REMOTEID` of one voucher of a journal. */
export const remoteIdOf = (journalId: string, reference: string): string => {
  const r = `ipb:${journalId}:${reference}`;
  if (!REMOTE_ID.test(r)) throw new RangeError("not a remote id");
  return r;
};

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface TallyClientOptions {
  /** TallyPrime's XML port, e.g. `http://127.0.0.1:9000`. */
  url: string;
  fetch?: FetchLike;
  /** Per request (default 30 s). */
  timeoutMs?: number;
  /** Largest answer read (default 8 MiB). */
  maxResponseBytes?: number;
}

export interface TallyLine {
  ledger: string;
  side: "debit" | "credit";
  paise: number;
}

export interface TallyVoucher {
  remoteId: string;
  guid: string | null;
  number: string | null;
  date: string | null;
  voucherType: string | null;
  lines: TallyLine[];
  /** A line whose amount could not be read (never matches). */
  unreadable: boolean;
}

export type ImportAnswer =
  | { kind: "created" }
  | { kind: "refused"; reasonCode: TallyReasonCode; reason: string }
  | { kind: "lost" };

/** TallyPrime could not be reached, or answered something that is not its XML. */
export class TallyUnavailable extends Error {
  constructor(
    readonly reasonCode: TallyReasonCode,
    message: string,
  ) {
    super(message);
  }
}

/** Maps a TallyPrime error line to a reason code (the wording is [VERIFY]). */
export function reasonOf(text: string): TallyReasonCode {
  const t = text.toLowerCase();
  if (/voucher\s*type/.test(t) && /(not exist|does not|not found|unknown)/.test(t))
    return "voucher_type_unknown";
  if (/ledger/.test(t) && /(not exist|does not|not found|unknown)/.test(t)) return "ledger_unknown";
  if (/(svcurrentcompany|company)/.test(t) && /(not|could not|unable|closed)/.test(t))
    return "company_not_open";
  if (/(period|books beginning|financial year|locked|out of range|date)/.test(t))
    return "period_closed";
  if (/duplicate/.test(t)) return "duplicate_voucher";
  return "tally_error";
}

const REASON_TEXT: Record<TallyReasonCode, string> = {
  ledger_unknown: "TallyPrime does not know a ledger of this voucher",
  voucher_type_unknown: "TallyPrime does not know the voucher type",
  period_closed: "the voucher date is outside the company's open period",
  company_not_open: "the TallyPrime company is not open",
  duplicate_voucher: "TallyPrime refused a duplicate voucher",
  remote_mismatch: "a different voucher already carries this voucher's REMOTEID",
  remote_duplicate: "more than one voucher carries this voucher's REMOTEID",
  tally_unreachable: "TallyPrime could not be reached",
  tally_error: "TallyPrime refused the voucher",
  agent_unreachable: "no agent took the batch",
  too_large: "the job is too large",
};
export const reasonText = (c: TallyReasonCode, reference?: string): string =>
  reference ? `${REASON_TEXT[c]} (voucher ${reference})` : REASON_TEXT[c];

const envelope = (header: Record<string, string>, body: ReturnType<typeof el>) =>
  `<?xml version="1.0" encoding="UTF-8"?>${
    el(
      "ENVELOPE",
      null,
      el("HEADER", null, ...Object.entries(header).map(([k, v]) => el(k, null, v))),
      el("BODY", null, body),
    ).xml
  }`;

export class TallyClient {
  private readonly fetch: FetchLike;
  constructor(private readonly o: TallyClientOptions) {
    this.fetch = o.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  /** One request; the answer as a document. */
  async request(xml: string): Promise<XmlElement> {
    const signal = AbortSignal.timeout(this.o.timeoutMs ?? 30_000);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetch(this.o.url, {
        method: "POST",
        headers: { "content-type": "text/xml; charset=utf-8" },
        body: xml,
        signal,
      });
    } catch {
      throw new TallyUnavailable("tally_unreachable", "TallyPrime did not answer");
    }
    if (res.status !== 200)
      throw new TallyUnavailable("tally_error", `TallyPrime answered HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > (this.o.maxResponseBytes ?? 8 * 1024 * 1024))
      throw new TallyUnavailable("tally_error", "TallyPrime's answer is too large");
    let text: string;
    try {
      text =
        buf[0] === 0xff && buf[1] === 0xfe
          ? new TextDecoder("utf-16le", { fatal: true }).decode(buf.subarray(2))
          : new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      throw new TallyUnavailable("tally_error", "TallyPrime's answer is not UTF-8 or UTF-16");
    }
    try {
      return parseXml(text);
    } catch (e) {
      if (e instanceof XmlError)
        throw new TallyUnavailable("tally_error", `TallyPrime's answer is not readable XML`);
      throw e;
    }
  }

  /** The vouchers carrying exactly `remoteId` (normally none or one). */
  async lookup(company: string, remoteId: string): Promise<TallyVoucher[]> {
    if (!REMOTE_ID.test(remoteId)) throw new RangeError("not a remote id");
    const tdl = el(
      "TDL",
      null,
      el(
        "TDLMESSAGE",
        null,
        el(
          "COLLECTION",
          { NAME: "IPBVoucherByRemoteId", ISMODIFY: "No" },
          el("TYPE", null, "Voucher"),
          el(
            "FETCH",
            null,
            "GUID, REMOTEID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, ALLLEDGERENTRIES.LIST",
          ),
          el("FILTER", null, "IPBRemoteIdMatch"),
        ),
        // The id is checked against REMOTE_ID above: no quote can reach the formula.
        el("SYSTEM", { TYPE: "Formulae", NAME: "IPBRemoteIdMatch" }, `$RemoteID = "${remoteId}"`),
      ),
    );
    const doc = await this.request(
      envelope(
        { VERSION: "1", TALLYREQUEST: "Export", TYPE: "Collection", ID: "IPBVoucherByRemoteId" },
        el(
          "DESC",
          null,
          el(
            "STATICVARIABLES",
            null,
            el("SVCURRENTCOMPANY", null, company),
            el("SVEXPORTFORMAT", null, "$$SysName:XML"),
          ),
          tdl,
        ),
      ),
    );
    this.assertCompany(doc);
    return findAll(doc, "VOUCHER")
      .map(readVoucher)
      .filter((v) => v.remoteId === remoteId);
  }

  /** Creates one voucher (never alters or deletes). */
  async create(company: string, remoteId: string, entry: JournalEntry): Promise<ImportAnswer> {
    const lines = entry.lines.map((l) =>
      el(
        "ALLLEDGERENTRIES.LIST",
        null,
        el("LEDGERNAME", null, l.ledger),
        el("ISDEEMEDPOSITIVE", null, l.side === "debit" ? "Yes" : "No"),
        el("AMOUNT", null, paiseToRupees(l.amountPaise, l.side === "debit")),
        ...(l.costCentre
          ? [
              el(
                "CATEGORYALLOCATIONS.LIST",
                null,
                el("CATEGORY", null, "Primary Cost Category"),
                el(
                  "COSTCENTREALLOCATIONS.LIST",
                  null,
                  el("NAME", null, l.costCentre),
                  el("AMOUNT", null, paiseToRupees(l.amountPaise, l.side === "debit")),
                ),
              ),
            ]
          : []),
      ),
    );
    const voucher = el(
      "VOUCHER",
      { REMOTEID: remoteId, VCHTYPE: entry.voucherType, ACTION: "Create" },
      el("DATE", null, tallyDate(entry.date)),
      el("VOUCHERTYPENAME", null, entry.voucherType),
      el("REFERENCE", null, entry.reference),
      ...(entry.narration ? [el("NARRATION", null, entry.narration)] : []),
      ...lines,
    );
    let doc: XmlElement;
    try {
      doc = await this.request(
        envelope(
          { TALLYREQUEST: "Import Data" },
          el(
            "IMPORTDATA",
            null,
            el(
              "REQUESTDESC",
              null,
              el("REPORTNAME", null, "Vouchers"),
              el("STATICVARIABLES", null, el("SVCURRENTCOMPANY", null, company)),
            ),
            el("REQUESTDATA", null, el("TALLYMESSAGE", null, voucher)),
          ),
        ),
      );
    } catch (e) {
      // Sent, but the answer is lost or unreadable: the read-back decides.
      if (e instanceof TallyUnavailable) return { kind: "lost" };
      throw e;
    }
    const errors = findAll(doc, "LINEERROR")
      .map((x) => x.text.trim())
      .filter(Boolean);
    const created = Number(first(doc, "CREATED") ?? "NaN");
    const errCount = Number(first(doc, "ERRORS") ?? "NaN");
    if (errors.length || errCount > 0) {
      const code = reasonOf(errors.join(" "));
      return { kind: "refused", reasonCode: code, reason: reasonText(code, entry.reference) };
    }
    if (created === 1) return { kind: "created" };
    // ALTERED 1, or an answer without counts: never trusted; the read-back decides.
    return { kind: "lost" };
  }

  /** Closing balances as of `asOf` (inclusive), in paise. */
  async trialBalance(
    company: string,
    asOf: string,
  ): Promise<Array<{ ledger: string; debitPaise: number; creditPaise: number }>> {
    const doc = await this.request(
      envelope(
        { VERSION: "1", TALLYREQUEST: "Export", TYPE: "Collection", ID: "IPBTrialBalance" },
        el(
          "DESC",
          null,
          el(
            "STATICVARIABLES",
            null,
            el("SVCURRENTCOMPANY", null, company),
            el("SVTODATE", null, tallyDate(asOf)),
            el("SVEXPORTFORMAT", null, "$$SysName:XML"),
          ),
          el(
            "TDL",
            null,
            el(
              "TDLMESSAGE",
              null,
              el(
                "COLLECTION",
                { NAME: "IPBTrialBalance", ISMODIFY: "No" },
                el("TYPE", null, "Ledger"),
                el("FETCH", null, "NAME, CLOSINGBALANCE"),
              ),
            ),
          ),
        ),
      ),
    );
    this.assertCompany(doc);
    const out: Array<{ ledger: string; debitPaise: number; creditPaise: number }> = [];
    for (const l of findAll(doc, "LEDGER")) {
      const name = (l.attrs.NAME ?? field(l, "NAME") ?? "").trim();
      const raw = field(l, "CLOSINGBALANCE") ?? "";
      if (!name) continue;
      const v = raw === "" ? 0 : rupeesToPaise(raw);
      if (v === null)
        throw new TallyUnavailable("tally_error", "a closing balance is not a plain amount");
      if (v === 0) continue;
      out.push({ ledger: name, debitPaise: v < 0 ? -v : 0, creditPaise: v > 0 ? v : 0 });
    }
    return out;
  }

  private assertCompany(doc: XmlElement): void {
    const errors = findAll(doc, "LINEERROR")
      .map((x) => x.text.trim())
      .filter(Boolean);
    if (errors.length) {
      const code = reasonOf(errors.join(" "));
      throw new TallyUnavailable(
        code === "company_not_open" ? code : "tally_error",
        "TallyPrime refused the export",
      );
    }
  }
}

function readVoucher(v: XmlElement): TallyVoucher {
  let unreadable = false;
  const lines: TallyLine[] = [];
  for (const l of v.children.filter(
    (x) => x.name === "ALLLEDGERENTRIES.LIST" || x.name === "LEDGERENTRIES.LIST",
  )) {
    const ledger = field(l, "LEDGERNAME") ?? "";
    const p = rupeesToPaise(field(l, "AMOUNT") ?? "");
    if (!ledger || p === null || p === 0) {
      unreadable = true;
      continue;
    }
    lines.push({ ledger, side: p < 0 ? "debit" : "credit", paise: Math.abs(p) });
  }
  const date = field(v, "DATE");
  return {
    remoteId: (v.attrs.REMOTEID ?? field(v, "REMOTEID") ?? "").trim(),
    guid: field(v, "GUID") || null,
    number: field(v, "VOUCHERNUMBER") || null,
    date: date ? isoDate(date) : null,
    voucherType: (field(v, "VOUCHERTYPENAME") || v.attrs.VCHTYPE || "").trim() || null,
    lines,
    unreadable,
  };
}

/** Whether TallyPrime's voucher is the entry as the platform posted it. */
export function sameVoucher(v: TallyVoucher, e: JournalEntry): boolean {
  if (v.unreadable || v.date !== e.date || v.voucherType !== e.voucherType) return false;
  const key = (l: { ledger: string; side: string; paise: number }) =>
    `${l.side}\u0000${l.ledger}\u0000${l.paise}`;
  const a = v.lines.map(key).sort();
  const b = e.lines
    .map((l) => key({ ledger: l.ledger, side: l.side, paise: l.amountPaise }))
    .sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
