// Web snapshot fake and contract (PR-LDC-40, R1-D-176; threat model §3.125). Every implementation
// of `WebSnapshotPort` passes the same cases: a page is kept with its hash and opened only as a
// download, another tenant sees nothing, a type off the list and a status other than 200 are
// refused, an infected copy is rejected, altered bytes are refused on open, and an agent is
// refused. Run `defineWebSnapshotContract(name, setup)` against the fake (here) and against
// `PlatformWebSnapshot` on PostgreSQL (`@infrabyx/connectors`).
// Web snapshot fake and contract (PR-LDC-40, R1-D-176; threat model §3.125). Every implementation
// of `WebSnapshotPort` passes the same cases: a page is kept with its hash and opened only as a
// download, another tenant sees nothing, a type off the list and a status other than 200 are
// refused, an infected copy is rejected, altered bytes are refused on open, and an agent is
// refused. Run `defineWebSnapshotContract(name, setup)` against the fake (here) and against
// `PlatformWebSnapshot` on PostgreSQL (`@infrabyx/connectors`).
import { describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { WebSnapshot, WebSnapshotPort } from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import { agentContext } from "../context.js";
import { EICAR } from "./file-scan.js";
import { type FakeWebPage } from "@infrabyx/fakes";
export { type FakeWebPage, FakeWebSnapshot } from "@infrabyx/fakes";

/** What the contract needs from an implementation. */
export interface WebSnapshotFixture {
  port: WebSnapshotPort;
  /** A tenant user allowed to take snapshots, and that tenant's STORAGE prefix (`tenant/<t>/<m>`). */
  ctx: KernelContext;
  prefix: string;
  /** A user of another tenant. */
  otherTenant: KernelContext;
  /** Make `url` (on the tenant's allow-list) answer with `page`. */
  serve(url: string, page: FakeWebPage): void;
  /** Replace the stored bytes of a snapshot. */
  corrupt(s: WebSnapshot): Promise<void>;
  /** A URL base on the tenant's allow-list, such as `https://site.example`. */
  base: string;
}

const enc = (s: string) => new TextEncoder().encode(s);

export function defineWebSnapshotContract(
  name: string,
  setup: () => Promise<WebSnapshotFixture>,
): void {
  describe(`web snapshot contract (PR-LDC-40): ${name}`, () => {
    it("keeps a page with its SHA-256 and opens it only as a download", async () => {
      const f = await setup();
      const body = enc("<html><p>notice</p></html>");
      f.serve(`${f.base}/notice`, { contentType: "text/html", body });
      const s = await f.port.archive(f.ctx, { url: `${f.base}/notice`, outputPrefix: f.prefix });
      expect(s).toMatchObject({
        state: "RELEASED",
        contentType: "text/html",
        bytes: body.byteLength,
        sha256: sha256Hex(body),
        httpStatus: 200,
      });
      expect(await f.port.get(f.ctx, s.id)).toEqual(s);
      const o = await f.port.open(f.ctx, s.id);
      expect(o.body).toEqual(body);
      expect(o.headers["Content-Disposition"]).toMatch(
        /^attachment; filename="wsn_[0-9A-Z]{26}\.html"$/,
      );
      expect(o.headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(o.headers["Content-Security-Policy"]).toBe("sandbox; default-src 'none'");
    });

    it("another tenant sees nothing", async () => {
      const f = await setup();
      f.serve(`${f.base}/mine`, { contentType: "text/plain", body: enc("mine") });
      const s = await f.port.archive(f.ctx, { url: `${f.base}/mine`, outputPrefix: f.prefix });
      expect(await f.port.get(f.otherTenant, s.id)).toBeNull();
      await expect(f.port.open(f.otherTenant, s.id)).rejects.toMatchObject({
        code: "IPB-STOR-001",
      });
    });

    it("refuses a type off the list and a status other than 200", async () => {
      const f = await setup();
      f.serve(`${f.base}/svg`, { contentType: "image/svg+xml", body: enc("<svg onload=x />") });
      f.serve(`${f.base}/gone`, { status: 404, contentType: "text/html", body: enc("gone") });
      await expect(
        f.port.archive(f.ctx, { url: `${f.base}/svg`, outputPrefix: f.prefix }),
      ).rejects.toMatchObject({ code: "IPB-SEC-010" });
      await expect(
        f.port.archive(f.ctx, { url: `${f.base}/gone`, outputPrefix: f.prefix }),
      ).rejects.toMatchObject({ code: "IPB-PORT-002" });
    });

    it("rejects an infected copy and never opens it", async () => {
      const f = await setup();
      f.serve(`${f.base}/eicar`, { contentType: "text/plain", body: EICAR });
      const s = await f.port.archive(f.ctx, { url: `${f.base}/eicar`, outputPrefix: f.prefix });
      expect(s.state).toBe("REJECTED");
      await expect(f.port.open(f.ctx, s.id)).rejects.toMatchObject({ code: "IPB-SEC-011" });
    });

    it("refuses bytes that no longer hash to the record", async () => {
      const f = await setup();
      f.serve(`${f.base}/alt`, { contentType: "text/plain", body: enc("original") });
      const s = await f.port.archive(f.ctx, { url: `${f.base}/alt`, outputPrefix: f.prefix });
      await f.corrupt(s);
      await expect(f.port.open(f.ctx, s.id)).rejects.toMatchObject({
        code: "IPB-SEC-015",
        meta: { reason: "hash_mismatch" },
      });
    });

    it("refuses an agent", async () => {
      const f = await setup();
      f.serve(`${f.base}/agent`, { contentType: "text/plain", body: enc("a") });
      await expect(
        f.port.archive(agentContext(f.ctx.tenantId), {
          url: `${f.base}/agent`,
          outputPrefix: f.prefix,
        }),
      ).rejects.toMatchObject({ code: "IPB-SEC-004" });
    });
  });
}
