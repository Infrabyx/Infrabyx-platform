// ESTAMP adapter `manual-paper` (Udofin PR-UDF-054, R1-D-245): records a physically stamped
// instrument the regulated entity holds, on physical stamp paper or by franking, without buying
// anything and without calling anything external (no egress client, no host, no SDK). Off behind
// `int.estamp.manual_paper.enabled` (default false) and `unproven` until the owner sets the
// evidence rules for manually keyed stamps (OWNER-QUESTIONS #177 (3)).
//
// The record carries the State, the Stamp Act article, the duty (and the duty the instrument
// states, never more than paid), the paper's or impression's serial number, the licensed stamp
// vendor's or franking agent's licence, the stamped document's SHA-256 (checked against STORAGE),
// the scanned certificate's document id and who keyed it (a user or a service, never an agent).
// Nobody outside can confirm it, so it is `verification: "MANUAL_RECORD"`. The serial is recorded
// once per State and channel, so one sheet of paper cannot evidence two instruments. No checker is
// added (the port's evidence calls carry none, and approval policy is on the locked list): whether
// a manually keyed stamp needs a checker before it enters a pack is #177 (3).
import type { PortHealth, StampCertificateRecord } from "@infrabyx/contracts/ports";
import {
  RecordingEstamp,
  type IssuerCheck,
  type RecordingEstampOptions,
  type StoredStamp,
} from "./record.js";

export type ManualPaperOptions = RecordingEstampOptions;

export class ManualStampPaper extends RecordingEstamp {
  constructor(o: ManualPaperOptions) {
    super(o, {
      adapter: "manual-paper",
      setting: "int.estamp.manual_paper.enabled",
      channels: ["PHYSICAL_PAPER", "FRANKING"],
    });
  }

  /** Nothing to ask: the record is the RE's own, checked for shape, hash and reuse only. */
  protected async check(_r: StampCertificateRecord, certificateId: string): Promise<IssuerCheck> {
    return { state: "issued", vendorRef: `manual:${certificateId}`, verification: "MANUAL_RECORD" };
  }

  /** Paper is not read back from anyone: the record stands as kept. */
  protected async readBack(s: StoredStamp): Promise<IssuerCheck> {
    return {
      state: s.certificate.state,
      vendorRef: s.certificate.vendorRef,
      verification: "MANUAL_RECORD",
    };
  }

  async health(): Promise<PortHealth> {
    let status: PortHealth["status"] = "up";
    try {
      if (!(await this.o.enabled())) status = "down";
    } catch {
      status = "down";
    }
    return { status, latency_ms: 0, checked_at: new Date().toISOString() };
  }
}
