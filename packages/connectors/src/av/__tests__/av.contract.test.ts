// AV contract leg (PR-LDC-41, R1-D-117; R1-plan M86). Hermetic: the pinned ClamAV image (clamd with
// its signature databases). The generic AV cases, then an EICAR inside a ZIP (archives are scanned).
// The image's signatures are as old as the image unless freshclam updates them at start, so the leg
// allows 30 days; the 48-hour production default is covered by the unit tests.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import {
  defineContractSuite,
  EICAR,
  fileScanContractCases,
  MemoryStorage,
  startService,
  type StartedService,
} from "@infrabyx/testing";
import { ClamavFileScan } from "../clamav.js";

let clamd: StartedService;
const storage = new MemoryStorage();
let adapter: ClamavFileScan;

beforeAll(async () => {
  // No log wait: clamd opens 3310 only once its databases are loaded (the default port wait).
  clamd = await startService("clamav", { ports: [3310] });
  adapter = new ClamavFileScan({
    host: clamd.host === "localhost" ? "127.0.0.1" : clamd.host,
    port: clamd.ports[3310] ?? 3310,
    storage,
    enabled: () => true,
    maxSignatureAgeHours: 30 * 24,
  });
  // clamd accepts connections a moment after it logs that it started.
  for (let i = 0; i < 60 && (await adapter.health()).status === "down"; i++)
    await new Promise((r) => setTimeout(r, 2_000));
}, 300_000);
afterAll(async () => clamd?.stop());

defineContractSuite("AV", () => adapter, fileScanContractCases(storage), { leg: "hermetic" });

describe("AV clamav: archives (IPB-02-44)", () => {
  it("finds EICAR inside a stored ZIP", async () => {
    const zip = storedZip("eicar.com", EICAR);
    const storageKey = `tenant/tnt_contract/uploads/${ulid()}.zip`;
    await storage.put(storageKey, zip, { bucketClass: "QUARANTINE" });
    const r = await adapter.scan({ storageKey, sha256: sha256Hex(zip) });
    expect(r.verdict).toBe("INFECTED");
    expect(r.engine).toMatch(/^ClamAV /);
  }, 60_000);
});

/** A one-entry ZIP with the file stored (no compression), enough for clamd to unpack. */
function storedZip(name: string, data: Uint8Array): Uint8Array {
  const crc = crc32(data);
  const n = Buffer.from(name, "latin1");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(10, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(10, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12);
  end.writeUInt32LE(local.length + n.length + data.length, 16);
  return Buffer.concat([local, n, Buffer.from(data), central, n, end]);
}

function crc32(b: Uint8Array): number {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
