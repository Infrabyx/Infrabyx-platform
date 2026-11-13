// ClamAV adapter unit tests against a fake clamd on loopback (PR-LDC-41, R1-D-117): the INSTREAM
// framing, every verdict, and the fail-closed paths (disabled, hash mismatch, too large, stale
// signatures, timeout, engine error, a public address). The contract leg runs the real clamd.
import { createServer, type Server, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PortHealth, scanDecision, type DocFileRef } from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import { EICAR, MemoryStorage } from "@infrabyx/testing";
import {
  ClamavFileScan,
  instream,
  isClusterAddress,
  parseVersion,
  type ClamavFileScanOptions,
} from "../clamav.js";

type Behaviour = "normal" | "silent" | "garbage" | "limit";
let behaviour: Behaviour = "normal";
let versionLine = "ClamAV 1.5.4/27812/Mon Nov  9 08:24:07 2026";
const received: Buffer[] = [];

/** A minimal clamd: PING, VERSION and INSTREAM (EICAR anywhere is FOUND). */
function handle(sock: Socket) {
  let buf = Buffer.alloc(0);
  sock.on("data", (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    if (behaviour === "silent") return;
    const cmdEnd = buf.indexOf(0);
    if (cmdEnd < 0) return;
    const cmd = buf.subarray(0, cmdEnd).toString("latin1");
    if (cmd === "zPING") return void sock.end("PONG\0");
    if (cmd === "zVERSION") return void sock.end(`${versionLine}\0`);
    if (cmd !== "zINSTREAM") return void sock.end("UNKNOWN COMMAND\0");
    if (behaviour === "limit") return void sock.end("INSTREAM size limit exceeded. ERROR\0");
    // Parse <len><bytes> frames until the zero-length terminator.
    let off = cmdEnd + 1;
    const parts: Buffer[] = [];
    for (;;) {
      if (buf.length < off + 4) return;
      const len = buf.readUInt32BE(off);
      if (len === 0) break;
      if (buf.length < off + 4 + len) return;
      parts.push(buf.subarray(off + 4, off + 4 + len));
      off += 4 + len;
    }
    const body = Buffer.concat(parts);
    received.push(body);
    if (behaviour === "garbage") return void sock.end("lstat() failed. ERROR\0");
    sock.end(
      body.includes(Buffer.from(EICAR)) ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0",
    );
  });
}

let server: Server;
let port = 0;
const storage = new MemoryStorage();
const NOW = new Date("2026-11-10T08:00:00Z");

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const make = (o: Partial<ClamavFileScanOptions> = {}) =>
  new ClamavFileScan({
    host: "127.0.0.1",
    port,
    storage,
    enabled: () => true,
    now: () => NOW,
    timeoutMs: 2_000,
    ...o,
  });

async function put(body: Uint8Array): Promise<DocFileRef> {
  const storageKey = `tenant/tnt_a/uploads/${ulid()}`;
  await storage.put(storageKey, body, { bucketClass: "QUARANTINE" });
  return { storageKey, sha256: sha256Hex(body) };
}

describe("ClamAV AV adapter (clamd protocol)", () => {
  it("streams the file in INSTREAM frames and maps OK and FOUND", async () => {
    behaviour = "normal";
    const big = new Uint8Array(200_000).fill(65);
    const clean = await make().scan(await put(big));
    expect(clean.verdict).toBe("CLEAN");
    expect(received.at(-1)?.equals(Buffer.from(big))).toBe(true);
    expect(clean.engine).toBe("ClamAV 1.5.4/27812");
    expect(clean.signaturesAt).toBe("2026-11-09T08:24:07.000Z");
    const bad = await make().scan(await put(EICAR));
    expect(bad.verdict).toBe("INFECTED");
    expect(bad.threat).toBe("Eicar-Test-Signature");
    expect(scanDecision(bad).action).toBe("reject");
    const frames = instream(big);
    expect(frames[0]?.toString("latin1")).toBe("zINSTREAM\0");
    expect(frames.at(-1)?.equals(Buffer.alloc(4))).toBe(true);
  });

  it("is fail-closed: disabled, hash mismatch, too large, missing object", async () => {
    behaviour = "normal";
    const f = await put(new TextEncoder().encode("hello"));
    expect((await make({ enabled: () => false }).scan(f)).reason).toBe("disabled");
    expect((await make().scan({ ...f, sha256: sha256Hex("other") })).reason).toBe("hash_mismatch");
    expect((await make({ maxBytes: 3 }).scan(f)).reason).toBe("too_large");
    const gone = await make().scan({
      storageKey: `tenant/tnt_a/uploads/${ulid()}`,
      sha256: f.sha256,
    });
    expect(gone.verdict).toBe("ERROR");
    expect(gone.reason).toBe("unavailable");
  });

  it("refuses stale signatures, and maps clamd's size limit, errors and silence", async () => {
    const f = await put(new TextEncoder().encode("doc"));
    behaviour = "normal";
    versionLine = "ClamAV 1.5.4/27800/Fri Nov  6 08:00:00 2026";
    const stale = await make().scan(f);
    expect(stale.reason).toBe("stale_signatures");
    const sick = await make().health();
    expect(sick.status).toBe("degraded");
    expect(sick.detail).toMatchObject({
      engine: "ClamAV 1.5.4/27800",
      signatures_at: "2026-11-06T08:00:00.000Z",
      max_signature_age_hours: 48,
      signatures_fresh: false,
    });
    expect(sick.detail?.signature_age_hours).toBeGreaterThan(48);
    expect(scanDecision(stale).action).toBe("quarantine");
    versionLine = "ClamAV 1.5.4";
    expect((await make().scan(f)).reason).toBe("stale_signatures");
    versionLine = "ClamAV 1.5.4/27812/Mon Nov  9 08:24:07 2026";
    behaviour = "limit";
    expect((await make().scan(f)).reason).toBe("too_large");
    behaviour = "garbage";
    expect((await make().scan(f)).reason).toBe("engine_error");
    behaviour = "silent";
    expect((await make({ timeoutMs: 200 }).scan(f)).reason).toBe("timeout");
    behaviour = "normal";
  });

  it("sends nothing to a host that is not loopback or private, and reports health", async () => {
    behaviour = "normal";
    const f = await put(new TextEncoder().encode("doc"));
    const before = received.length;
    const pub = make({ host: "clamd.example.com", resolve: async () => "203.0.113.7" });
    const r = await pub.scan(f);
    expect(r.verdict).toBe("ERROR");
    expect(r.reason).toBe("unavailable");
    expect(received.length).toBe(before);
    expect((await pub.health()).status).toBe("down");
    const ok = await make().health();
    expect(ok.status).toBe("up");
    expect(ok.detail).toMatchObject({ signatures_fresh: true, max_signature_age_hours: 48 });
    expect(PortHealth.parse(ok)).toEqual(ok);
    expect((await make({ port: 1 }).scan(f)).reason).toBe("unavailable");
  });

  it("classifies cluster addresses and parses VERSION", () => {
    for (const a of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.1",
      "100.64.0.9",
      "::1",
      "fd00::1",
      "::ffff:10.0.0.1",
    ])
      expect(isClusterAddress(a), a).toBe(true);
    for (const a of [
      "8.8.8.8",
      "172.32.0.1",
      "203.0.113.7",
      "2001:db8::1",
      "fe80::1",
      "::ffff:8.8.8.8",
    ])
      expect(isClusterAddress(a), a).toBe(false);
    expect(
      parseVersion("ClamAV 1.5.4/27812/Tue Nov 10 08:24:07 2026").signaturesAt?.toISOString(),
    ).toBe("2026-11-10T08:24:07.000Z");
    expect(() => parseVersion("nonsense")).toThrow();
  });
});
