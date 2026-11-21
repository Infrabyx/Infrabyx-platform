// FILE_TRANSFER contract legs (Udofin PR-UDF-071, R1-D-254, ADR-0014). Hermetic: the `sftp` adapter
// against the pinned OpenSSH SFTP container (`TEST_IMAGES.sftp`, a host key and an authorised client
// key made for this run), and the fake (the CI-green alternative). Then what only the adapter
// promises at the server: a host key that matches no pin is refused before authentication and nothing
// is written; a key the server does not authorise is `auth_failed`; two puts of one path at once
// create it once (the exclusive create is the server's, not a stat); a closed port is `unavailable`
// and a call past its deadline `timeout`; health with a probe. The container is on the runner's
// loopback, so the adapter here takes the test-only resolution and loopback allowance (the address
// guard itself is unit-tested with stub resolution in sftp.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSshEd25519KeyPair, sha256Hex } from "@infrabyx/crypto";
import {
  FakeFileTransfer,
  MemorySecrets,
  defineContractSuite,
  expectFileTransferRefusal,
  fileTransferBytes,
  fileTransferContractCases,
  fileTransferFakeFixtures,
  fileTransferName,
  startSftpServer,
  type FileTransferFixtures,
  type SftpTestServer,
} from "@infrabyx/testing";
import { SftpFileTransfer, type SftpFileTransferOptions } from "../sftp.js";

const HOST = "sftp.contract.example.in";
const KEY_PATH = "secrets/test/file_transfer/sftp/contract";
let server: SftpTestServer;
const secrets = new MemorySecrets();

beforeAll(async () => {
  server = await startSftpServer();
  await secrets.put(KEY_PATH, server.clientPrivateKey);
}, 300_000);
afterAll(async () => server?.stop());

function sftp(over: Partial<SftpFileTransferOptions> = {}, pins?: string[]): SftpFileTransfer {
  return new SftpFileTransfer({
    enabled: () => true,
    allowHosts: () => [{ host: HOST, residency: "IN", attestation: "contract-test" }],
    target: () => ({
      host: HOST,
      port: server.port,
      username: server.username,
      hostKeySha256: pins ?? [server.hostKeyFingerprint],
      clientKeySecret: KEY_PATH,
    }),
    secrets,
    testOnlyResolve: async () => [{ address: server.address, family: 4 }],
    testOnlyAllowLoopback: true,
    ...over,
  });
}

const fixtures: FileTransferFixtures<SftpFileTransfer> = {
  writableDir: () => server.writableDir,
  subdirOf: () => server.subDir,
};

defineContractSuite("FILE_TRANSFER", () => sftp(), fileTransferContractCases(fixtures), {
  leg: "hermetic",
});
defineContractSuite(
  "FILE_TRANSFER",
  () => new FakeFileTransfer(),
  fileTransferContractCases(fileTransferFakeFixtures),
);

describe("@IPB-01-15 FILE_TRANSFER hermetic leg (sftp, OpenSSH)", () => {
  it("refuses a host key that matches no pin before authentication, and writes nothing", async () => {
    const other = generateSshEd25519KeyPair().fingerprint;
    const path = `${server.writableDir}/${fileTransferName()}`;
    await expectFileTransferRefusal(
      () => sftp({}, [other]).put(path, new Uint8Array([1]), { ifAbsent: true }),
      "IPB-SEC-018",
      "host_key_mismatch",
    );
    await expectFileTransferRefusal(() => sftp().get(path), "IPB-STOR-001", "not_found");
    // A second, right pin beside a wrong one is accepted (key rotation).
    expect((await sftp({}, [other, server.hostKeyFingerprint]).list(".")).dir).toBe(".");
    const h = await sftp({ healthProbe: true }, [other]).health();
    expect(h).toMatchObject({ status: "down", detail: { reason: "host_key_mismatch" } });
  });

  it("is auth_failed with an Ed25519 key the server does not authorise", async () => {
    const s = new MemorySecrets();
    await s.put(KEY_PATH, generateSshEd25519KeyPair().privateKey);
    await expectFileTransferRefusal(
      () => sftp({ secrets: s }).list("."),
      "IPB-PORT-002",
      "auth_failed",
    );
  });

  it("creates a path once when two puts race for it (exclusive create at the server)", async () => {
    const path = `${server.writableDir}/${fileTransferName()}`;
    const a = fileTransferBytes(300_000);
    const b = fileTransferBytes(300_001);
    const r = await Promise.allSettled([
      sftp().put(path, a, { ifAbsent: true }),
      sftp().put(path, b, { ifAbsent: true }),
    ]);
    const ok = r.filter((x) => x.status === "fulfilled");
    const no = r.filter((x) => x.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(no).toHaveLength(1);
    expect(no[0]!.reason).toMatchObject({ code: "IPB-STOR-003", meta: { reason: "exists" } });
    const got = await sftp().get(path);
    expect([sha256Hex(a), sha256Hex(b)]).toContain(got.sha256);
    expect(got.sha256).toBe((ok[0] as PromiseFulfilledResult<{ sha256: string }>).value.sha256);
  });

  it("is unavailable on a closed port and timeout past its deadline; health probes when asked", async () => {
    const closed = new SftpFileTransfer({
      enabled: () => true,
      allowHosts: () => [{ host: HOST, residency: "IN" }],
      target: () => ({
        host: HOST,
        port: 1,
        username: server.username,
        hostKeySha256: [server.hostKeyFingerprint],
        clientKeySecret: KEY_PATH,
      }),
      secrets,
      testOnlyResolve: async () => [{ address: "127.0.0.1", family: 4 }],
      testOnlyAllowLoopback: true,
    });
    await expectFileTransferRefusal(() => closed.list("."), "IPB-PORT-002", "unavailable");
    await expectFileTransferRefusal(
      () => sftp({ timeoutMs: 1 }).list("."),
      "IPB-PORT-002",
      "timeout",
    );
    expect(await sftp({ healthProbe: true }).health()).toMatchObject({
      status: "up",
      detail: { probed: true },
    });
  });

  it("aborts a call in flight, and a cancelled put removes its partial file", async () => {
    const path = `${server.writableDir}/${fileTransferName()}`;
    const ac = new AbortController();
    const p = sftp().put(path, fileTransferBytes(64 * 1024 * 1024), {
      ifAbsent: true,
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 150);
    let err: unknown;
    try {
      await p;
    } catch (e) {
      err = e;
    }
    // Either the abort came before the session (nothing created) or during the write (removed).
    expect(err).toMatchObject({ code: "IPB-PORT-002", meta: { reason: "aborted" } });
    await expectFileTransferRefusal(() => sftp().get(path), "IPB-STOR-001", "not_found");
    // The path can be created afresh.
    expect((await sftp().put(path, new Uint8Array([7]), { ifAbsent: true })).size).toBe(1);
  }, 120_000);
});
