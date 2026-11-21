// FILE_TRANSFER contract cases (IPB-01-15; Udofin PR-UDF-071, R1-D-254, ADR-0014). The fake (here)
// and the `sftp` adapter (against the pinned SFTP container, `@infrabyx/connectors`) both pass them:
// a file put is read back byte for byte with its SHA-256 and listed with its size; a put on an
// existing path is refused `exists` (IPB-STOR-003) and the first bytes stay; a get past the cap is
// refused `too_large` (IPB-SEC-013) and one at the cap is read; a missing file is `not_found` and a
// directory `not_a_file` (IPB-STOR-001); a put into a missing directory is `not_found`; lists are
// sorted and capped; invalid paths, a SECRET or lowered class and an aborted signal are refused
// before anything is written; no refusal carries a host key, a key or an address.
import { expect } from "vitest";
import { generateSshEd25519KeyPair, randomInt, sha256Hex, ulid } from "@infrabyx/crypto";
import type { FileTransferPort } from "@infrabyx/contracts/ports";
import type { FileTransferFixtures } from "@infrabyx/fakes";
import { startService } from "../containers.js";
import type { ContractCase } from "../contract.js";
export {
  FakeFileTransfer,
  fileTransferFakeFixtures,
  type FakeFileTransferOptions,
  type FileTransferFixtures,
} from "@infrabyx/fakes";

let seqBase = 0;
let seq = 0;
/** A file name in the §3.11 shape, unique in this process (a random base, then a counter). */
export const fileTransferName = (ext = "csv"): string => {
  if (seqBase === 0) seqBase = 1 + randomInt(900_000);
  seq += 1;
  return `udf_RE01_contract_v1_20261121_${seqBase + seq}.${ext}`;
};

/** Bytes of a given length, not all one value. */
export const fileTransferBytes = (n: number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);

const LEAKS = [/SHA256:/, /BEGIN OPENSSH/, /ssh-ed25519 AAAA/, /\b\d{1,3}(\.\d{1,3}){3}\b/];

/** The refusal of `f`, checked for its code, its fixed label and that it leaks nothing. */
export async function expectFileTransferRefusal(
  f: () => Promise<unknown>,
  code: string,
  reason: string,
): Promise<void> {
  let err: unknown;
  try {
    await f();
  } catch (e) {
    err = e;
  }
  expect(err, `expected ${reason}`).toBeDefined();
  expect(err).toMatchObject({ code, meta: { reason } });
  const text = `${(err as Error).message} ${JSON.stringify(err)}`;
  for (const l of LEAKS) expect(text).not.toMatch(l);
}

export function fileTransferContractCases<P extends FileTransferPort>(
  fx: FileTransferFixtures<P>,
): Array<ContractCase<P>> {
  return [
    {
      name: "put then get answers the same bytes and SHA-256, and list shows the file with its size",
      method: "put",
      async run(p) {
        const dir = await fx.writableDir(p);
        const path = `${dir}/${fileTransferName()}`;
        const bytes = fileTransferBytes(70_001);
        const put = await p.put(path, bytes, { ifAbsent: true });
        expect(put).toEqual({ path, size: bytes.byteLength, sha256: sha256Hex(bytes) });
        const got = await p.get(path);
        expect(got.path).toBe(path);
        expect(got.size).toBe(bytes.byteLength);
        expect(got.sha256).toBe(sha256Hex(bytes));
        expect(Buffer.from(got.bytes).equals(Buffer.from(bytes))).toBe(true);
        const l = await p.list(dir);
        expect(l.dir).toBe(dir);
        const e = l.entries.find((x) => `${dir}/${x.name}` === path);
        expect(e).toMatchObject({ type: "file", size: bytes.byteLength });
        expect(Number.isNaN(Date.parse(e!.modifiedAt))).toBe(false);
        const names = l.entries.map((x) => x.name);
        expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
        // An empty file is a file too.
        const empty = `${dir}/${fileTransferName("txt")}`;
        expect((await p.put(empty, new Uint8Array(0), { ifAbsent: true })).size).toBe(0);
        expect((await p.get(empty)).bytes.byteLength).toBe(0);
      },
    },
    {
      name: "put on an existing path is refused exists (IPB-STOR-003) and the first bytes stay",
      method: "put",
      async run(p) {
        const dir = await fx.writableDir(p);
        const path = `${dir}/${fileTransferName()}`;
        const first = fileTransferBytes(1000);
        await p.put(path, first, { ifAbsent: true });
        await expectFileTransferRefusal(
          () => p.put(path, fileTransferBytes(10), { ifAbsent: true }),
          "IPB-STOR-003",
          "exists",
        );
        const got = await p.get(path);
        expect(got.sha256).toBe(sha256Hex(first));
        expect(got.size).toBe(1000);
        // A directory is an existing path as well.
        const sub = await fx.subdirOf(p, dir);
        await expectFileTransferRefusal(
          () => p.put(sub, first, { ifAbsent: true }),
          "IPB-STOR-003",
          "exists",
        );
      },
    },
    {
      name: "get past the cap is refused too_large (IPB-SEC-013); a file at the cap is read",
      method: "get",
      async run(p) {
        const dir = await fx.writableDir(p);
        const path = `${dir}/${fileTransferName()}`;
        const bytes = fileTransferBytes(4097);
        await p.put(path, bytes, { ifAbsent: true });
        await expectFileTransferRefusal(
          () => p.get(path, { maxBytes: 4096 }),
          "IPB-SEC-013",
          "too_large",
        );
        expect((await p.get(path, { maxBytes: 4097 })).size).toBe(4097);
      },
    },
    {
      name: "a missing file is not_found and a directory not_a_file (IPB-STOR-001); a put into a missing directory is not_found",
      method: "get",
      async run(p) {
        const dir = await fx.writableDir(p);
        await expectFileTransferRefusal(
          () => p.get(`${dir}/${fileTransferName()}`),
          "IPB-STOR-001",
          "not_found",
        );
        const sub = await fx.subdirOf(p, dir);
        await expectFileTransferRefusal(() => p.get(sub), "IPB-STOR-001", "not_a_file");
        await expectFileTransferRefusal(
          () => p.list(`${dir}/missing-${ulid().toLowerCase()}`),
          "IPB-STOR-001",
          "not_found",
        );
        await expectFileTransferRefusal(
          () =>
            p.put(
              `${dir}/missing-${ulid().toLowerCase()}/${fileTransferName()}`,
              new Uint8Array(1),
              {
                ifAbsent: true,
              },
            ),
          "IPB-STOR-001",
          "not_found",
        );
        const l = await p.list(dir);
        expect(l.entries.find((e) => `${dir}/${e.name}` === sub)?.type).toBe("directory");
      },
    },
    {
      name: "list is capped by maxEntries and says when it is truncated",
      method: "list",
      async run(p) {
        const dir = await fx.writableDir(p);
        for (let i = 0; i < 3; i++)
          await p.put(`${dir}/${fileTransferName()}`, new Uint8Array([i]), { ifAbsent: true });
        const l = await p.list(dir, { maxEntries: 2 });
        expect(l.entries).toHaveLength(2);
        expect(l.truncated).toBe(true);
        expect((await p.list(dir, { maxEntries: 10_000 })).truncated).toBe(false);
        expect((await p.list(".")).dir).toBe(".");
      },
    },
    {
      name: "invalid paths, a SECRET or lowered class, no ifAbsent and an aborted call are refused, and nothing is written",
      method: "put",
      async run(p) {
        const dir = await fx.writableDir(p);
        const b = new Uint8Array([1, 2, 3]);
        for (const bad of ["../x.csv", `/${dir}/x.csv`, `${dir}/../x.csv`, `${dir}//x.csv`, "a\\b"])
          await expectFileTransferRefusal(
            () => p.put(bad, b, { ifAbsent: true }),
            "IPB-SEC-018",
            "invalid_path",
          );
        await expectFileTransferRefusal(
          () => p.get("../etc/passwd"),
          "IPB-SEC-018",
          "invalid_path",
        );
        await expectFileTransferRefusal(() => p.list("/"), "IPB-SEC-018", "invalid_path");
        const path = `${dir}/${fileTransferName()}`;
        await expectFileTransferRefusal(
          () => p.put(path, b, { ifAbsent: true, dataClass: "SECRET" }),
          "IPB-PORT-003",
          "data_class",
        );
        await expectFileTransferRefusal(
          () => p.put(path, b, { ifAbsent: true, dataClass: "INTERNAL" }),
          "IPB-PORT-003",
          "data_class",
        );
        await expectFileTransferRefusal(
          () => p.put(path, b, {} as { ifAbsent: true }),
          "IPB-SEC-018",
          "invalid_path",
        );
        const ac = new AbortController();
        ac.abort();
        await expectFileTransferRefusal(
          () => p.put(path, b, { ifAbsent: true, signal: ac.signal }),
          "IPB-PORT-002",
          "aborted",
        );
        await expectFileTransferRefusal(() => p.get(path), "IPB-STOR-001", "not_found");
      },
    },
  ];
}

/** A running OpenSSH SFTP server for the `sftp` adapter's hermetic leg (`TEST_IMAGES.sftp`). */
export interface SftpTestServer {
  /** The address the mapped port is reachable on (loopback on a runner). */
  address: string;
  port: number;
  username: string;
  /** The server's ssh-ed25519 host key fingerprint (generated for this run). */
  hostKeyFingerprint: string;
  /** The authorised client key (unencrypted OpenSSH Ed25519; test data, never a real key). */
  clientPrivateKey: string;
  /** A directory the account may write (`upload`), and one inside it (`upload/sub`). */
  writableDir: string;
  subDir: string;
  stop(): Promise<void>;
}

/**
 * Start the pinned SFTP server with a host key and an authorised client key made for this run, so
 * nothing in the image is trusted: the chrooted account `ipb` logs in by key only and may write in
 * `upload`.
 */
export async function startSftpServer(): Promise<SftpTestServer> {
  const host = generateSshEd25519KeyPair();
  const client = generateSshEd25519KeyPair("ipb-contract");
  const username = "ipb";
  const s = await startService("sftp", {
    ports: [22],
    command: [`${username}::1001::upload,upload/sub`],
    readyLog: /Server listening on/,
    files: [
      { content: host.privateKey, target: "/etc/ssh/ssh_host_ed25519_key" },
      { content: `${host.publicKey}\n`, target: "/etc/ssh/ssh_host_ed25519_key.pub" },
      { content: `${client.publicKey}\n`, target: `/home/${username}/.ssh/keys/contract.pub` },
    ],
  });
  return {
    address: s.host === "localhost" ? "127.0.0.1" : s.host,
    port: s.ports[22] ?? 22,
    username,
    hostKeyFingerprint: host.fingerprint,
    clientPrivateKey: client.privateKey,
    writableDir: "upload",
    subDir: "upload/sub",
    stop: () => s.stop(),
  };
}
