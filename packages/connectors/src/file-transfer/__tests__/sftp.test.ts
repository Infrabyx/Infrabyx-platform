// FILE_TRANSFER `sftp` before the network (PR-UDF-071, R1-D-254): the switch, the target, the
// India-hosted allow-list, the address guard on stub resolution (@IPB-02-43), the client key's checks,
// the fixed algorithm lists and health without a probe. The transport itself (host key, client key at
// the server, exclusive create) is the hermetic leg's (file-transfer.contract.test.ts).
import { describe, expect, it } from "vitest";
import { generateSshEd25519KeyPair } from "@infrabyx/crypto";
import { MemorySecrets, expectFileTransferRefusal } from "@infrabyx/testing";
import {
  SFTP_ALGORITHMS,
  SFTP_CLIENT_IDENT,
  SftpFileTransfer,
  type SftpFileTransferOptions,
} from "../sftp.js";

const HOST = "sftp.cic.example.in";
const KEY_PATH = "secrets/test/file_transfer/sftp/cic";
const pin = generateSshEd25519KeyPair().fingerprint;
const target = {
  host: HOST,
  username: "lender01",
  hostKeySha256: [pin],
  clientKeySecret: KEY_PATH,
};

async function adapter(
  over: Partial<SftpFileTransferOptions> = {},
  key = generateSshEd25519KeyPair().privateKey,
): Promise<SftpFileTransfer> {
  const secrets = new MemorySecrets();
  await secrets.put(KEY_PATH, key);
  return new SftpFileTransfer({
    enabled: () => true,
    allowHosts: () => [{ host: HOST, residency: "IN", attestation: "var:att-01" }],
    target: () => target,
    secrets,
    ...over,
  });
}

const resolveTo =
  (...addresses: string[]) =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

describe("sftp: before anything is sent", () => {
  it("is off until its switch, and needs a valid target and allow-list", async () => {
    await expectFileTransferRefusal(
      async () => (await adapter({ enabled: () => false })).list("."),
      "IPB-PORT-001",
      "adapter_disabled",
    );
    for (const t of [
      undefined,
      { ...target, hostKeySha256: [] },
      { ...target, hostKeySha256: ["MD5:aa"] },
      { ...target, host: "*.example.in" },
      { ...target, host: "SFTP.Example.in" },
      { ...target, extra: 1 },
    ])
      await expectFileTransferRefusal(
        async () => (await adapter({ target: () => t })).list("."),
        "IPB-PORT-001",
        "adapter_unconfigured",
      );
    await expectFileTransferRefusal(
      async () => (await adapter({ allowHosts: () => [{ host: HOST }] })).list("."),
      "IPB-PORT-001",
      "adapter_unconfigured",
    );
  });

  it("refuses a host off the India-hosted allow-list, and an entry not declared IN", async () => {
    for (const allow of [[], [{ host: "other.example.in", residency: "IN" }], null])
      await expectFileTransferRefusal(
        async () =>
          (await adapter({ allowHosts: () => allow })).put("a.csv", new Uint8Array(1), {
            ifAbsent: true,
          }),
        "IPB-SEC-018",
        "not_allowed",
      );
    await expectFileTransferRefusal(
      async () =>
        (await adapter({ allowHosts: () => [{ host: HOST, residency: "US" }] })).list("."),
      "IPB-PORT-003",
      "residency",
    );
  });

  it("@IPB-02-43 refuses a host that resolves to any address outside public unicast", async () => {
    for (const answers of [
      ["10.0.0.5"],
      ["192.168.1.10"],
      ["169.254.169.254"],
      ["127.0.0.1"],
      ["::1"],
      ["fd00::1"],
      ["100.64.0.1"],
      ["8.8.8.8", "172.16.0.1"], // a mixed answer is how rebinding is staged
    ])
      await expectFileTransferRefusal(
        async () => (await adapter({ testOnlyResolve: resolveTo(...answers) })).list("."),
        "IPB-SEC-018",
        "address",
      );
    // An IP literal target is checked the same way, and must itself be on the allow-list.
    await expectFileTransferRefusal(
      async () =>
        (
          await adapter({
            target: () => ({ ...target, host: "10.1.2.3" }),
            allowHosts: () => [{ host: "10.1.2.3", residency: "IN" }],
          })
        ).list("."),
      "IPB-SEC-018",
      "address",
    );
    // The test-only loopback allowance admits loopback and nothing else.
    await expectFileTransferRefusal(
      async () =>
        (
          await adapter({ testOnlyResolve: resolveTo("10.0.0.5"), testOnlyAllowLoopback: true })
        ).list("."),
      "IPB-SEC-018",
      "address",
    );
    await expectFileTransferRefusal(
      async () =>
        (
          await adapter({
            testOnlyResolve: async () => {
              throw new Error("ENOTFOUND sftp.cic.example.in");
            },
          })
        ).list("."),
      "IPB-PORT-002",
      "dns",
    );
  });

  it("needs one unencrypted OpenSSH ssh-ed25519 client key in SECRETS", async () => {
    const pub = resolveTo("8.8.8.8");
    // Armour built at run time: no key-shaped text in the repository (secret scanning).
    const armour = (kind: string, body: string) =>
      `-----BEGIN ${kind}PRIVATE KEY-----\n${body}\n-----END ${kind}PRIVATE KEY-----\n`;
    for (const key of [
      "not a key",
      armour("OPENSSH ", "AAAA"),
      armour("", "MC4CAQAwBQYDK2VwBCIEIA=="),
    ])
      await expectFileTransferRefusal(
        async () => (await adapter({ testOnlyResolve: pub }, key)).list("."),
        "IPB-PORT-001",
        "client_key",
      );
    const missing = new SftpFileTransfer({
      enabled: () => true,
      allowHosts: () => [{ host: HOST, residency: "IN" }],
      target: () => target,
      secrets: new MemorySecrets(),
      testOnlyResolve: pub,
    });
    await expectFileTransferRefusal(() => missing.list("."), "IPB-PORT-002", "unavailable");
  });

  it("checks the path, the class and ifAbsent before the target", async () => {
    const off = await adapter({ enabled: () => false });
    await expectFileTransferRefusal(() => off.get("../x"), "IPB-SEC-018", "invalid_path");
    await expectFileTransferRefusal(
      () => off.put("x.csv", new Uint8Array(1), { ifAbsent: true, dataClass: "SECRET" }),
      "IPB-PORT-003",
      "data_class",
    );
    const ac = new AbortController();
    ac.abort();
    await expectFileTransferRefusal(
      async () => (await adapter()).get("x.csv", { signal: ac.signal }),
      "IPB-PORT-002",
      "aborted",
    );
  });

  it("offers fixed modern algorithms only, and names no library version", () => {
    expect(SFTP_ALGORITHMS).toEqual({
      kex: ["curve25519-sha256", "curve25519-sha256@libssh.org"],
      serverHostKey: ["ssh-ed25519"],
      cipher: ["aes256-gcm@openssh.com", "chacha20-poly1305@openssh.com"],
      hmac: ["hmac-sha2-256-etm@openssh.com"],
      compress: ["none"],
    });
    expect(JSON.stringify(SFTP_ALGORITHMS)).not.toMatch(
      /cbc|ctr|sha1|group1|group14|nistp|rsa|dss/,
    );
    expect(SFTP_CLIENT_IDENT).not.toMatch(/ssh2|\d+\.\d+\.\d+/);
  });

  it("answers health without a connection unless asked: down when off or refused, up when configured", async () => {
    expect((await (await adapter({ enabled: () => false })).health()).status).toBe("down");
    const h = await (await adapter()).health();
    expect(h).toMatchObject({ status: "up", detail: { probed: false } });
    const refused = await (await adapter({ allowHosts: () => [] })).health();
    expect(refused).toMatchObject({ status: "down", detail: { reason: "not_allowed" } });
  });

  it("declares IN and REGULATED", async () => {
    expect((await adapter()).descriptor).toEqual({
      port: "FILE_TRANSFER",
      adapter: "sftp",
      residency: "IN",
      maxDataClass: "REGULATED",
    });
  });
});
