// The verdict-to-action mapping is fail-closed: only CLEAN releases (IPB-02-44; PR-LDC-41).
import { describe, expect, it } from "vitest";
import { ERROR_CATALOGUE } from "../error-catalogue.js";
import { PORT_CATALOGUE } from "./catalogue.js";
import { FileScanRequest, SCAN_VERDICTS, scanDecision } from "./file-scan.js";

describe("AV port (FileScanPort)", () => {
  it("releases only CLEAN; INFECTED is IPB-SEC-011, ERROR is quarantine IPB-SEC-015", () => {
    expect(SCAN_VERDICTS).toEqual(["CLEAN", "INFECTED", "ERROR"]);
    expect(scanDecision({ verdict: "CLEAN" })).toEqual({ action: "release" });
    expect(scanDecision({ verdict: "INFECTED" })).toEqual({
      action: "reject",
      code: "IPB-SEC-011",
    });
    expect(scanDecision({ verdict: "ERROR" })).toEqual({
      action: "quarantine",
      code: "IPB-SEC-015",
    });
    // An unknown verdict (a newer adapter, a cast) never releases.
    expect(scanDecision({ verdict: "MAYBE" as never }).action).toBe("quarantine");
    expect(ERROR_CATALOGUE["IPB-SEC-011"].status).toBe(422);
    expect(ERROR_CATALOGUE["IPB-SEC-015"].status).toBe(202);
  });
  it("is catalogued with an interface and takes a STORAGE reference only", () => {
    expect(PORT_CATALOGUE.AV.interfaceDefined).toBe(true);
    expect(() =>
      FileScanRequest.parse({ storageKey: "k", sha256: "0".repeat(64), body: "x" }),
    ).toThrow();
  });
});
