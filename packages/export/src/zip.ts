// A small deterministic ZIP writer and reader (PKWARE APPNOTE 6.3, no ZIP64): entries in path order,
// one fixed entry time (the `zip_entry_times` normaliser), UTF-8 names (flag bit 11), DEFLATE
// through node:zlib. The same files always give the same bytes, so a re-download of the same archive
// has the same SHA-256 (IPB-09-37). Archives above 4 GiB or 65 535 entries are refused.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

const MAX = 0xffffffff;

/** DOS date and time of a UTC instant (2-second resolution; 1980 is the earliest). */
function dosTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

export interface ZipOptions {
  /** Entry time for every file (default 1980-01-01T00:00:00Z). */
  entryTime?: Date;
}

export function writeZip(files: ReadonlyMap<string, Uint8Array>, o: ZipOptions = {}): Buffer {
  const paths = [...files.keys()].sort();
  if (paths.length > 0xffff) throw new Error("too many entries for a ZIP without ZIP64");
  const { time, date } = dosTime(o.entryTime ?? new Date(Date.UTC(1980, 0, 1)));
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const p of paths) {
    const data = Buffer.from(files.get(p) as Uint8Array);
    const name = Buffer.from(p, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);
    if (data.length > MAX || offset > MAX)
      throw new Error("archive too large for a ZIP without ZIP64");
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(stored ? 0 : 8, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x0314, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(stored ? 0 : 8, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    locals.push(head, name, body);
    central.push(cd, name);
    offset += head.length + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(paths.length, 8);
  end.writeUInt16LE(paths.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}

/** Read every entry of a ZIP written by `writeZip` (or any non-ZIP64 store/deflate archive). */
export function readZip(zip: Uint8Array): Map<string, Buffer> {
  const b = Buffer.from(zip);
  let e = b.length - 22;
  while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e -= 1;
  if (e < 0) throw new Error("not a ZIP archive");
  const count = b.readUInt16LE(e + 10);
  let p = b.readUInt32LE(e + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt central directory");
    const method = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const csize = b.readUInt32LE(p + 20);
    const nlen = b.readUInt16LE(p + 28);
    const xlen = b.readUInt16LE(p + 30);
    const clen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const lnlen = b.readUInt16LE(local + 26);
    const lxlen = b.readUInt16LE(local + 28);
    const start = local + 30 + lnlen + lxlen;
    const raw = b.subarray(start, start + csize);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null;
    if (!data) throw new Error(`unsupported compression method ${method}`);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}`);
    if (name.includes("..") || name.startsWith("/")) throw new Error(`unsafe entry name ${name}`);
    out.set(name, data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
