// The gotenberg DOCGEN adapter against a stub of Gotenberg's Chromium route (#120, R1-D-100): the
// request it sends (one index.html, A4, the page's own size, fail on console errors, PDF/A on
// request), the PDF it stores in STORAGE, and what it refuses.
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStorage } from "@infrabyx/testing";
import { GotenbergDocgen, pageCount } from "../gotenberg.js";

const PDF = Buffer.from(
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n%%EOF\n",
  "latin1",
);
let server: Server;
let base = "";
let reply: { status: number; body: Buffer } = { status: 200, body: PDF };
const seen: Array<{ url: string; auth?: string; body: string }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({
        url: req.url ?? "",
        ...(req.headers.authorization ? { auth: req.headers.authorization } : {}),
        body: Buffer.concat(chunks).toString("utf8"),
      });
      if (req.url === "/health") {
        res.writeHead(200).end('{"status":"up"}');
        return;
      }
      res.writeHead(reply.status, { "content-type": "application/pdf" }).end(reply.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const make = (o: { enabled?: boolean; basic?: boolean } = {}) => {
  const storage = new MemoryStorage();
  return {
    storage,
    p: new GotenbergDocgen({
      baseUrl: base,
      storage,
      enabled: () => o.enabled ?? true,
      allowLoopbackHttp: true,
      ...(o.basic ? { basicAuth: async () => ({ username: "gb", password: "secret" }) } : {}),
    }),
  };
};
const html = `<!doctype html><html lang="hi"><body><p>मुख्य तथ्य विवरण ₹500</p></body></html>`;
const prefix = "tenant/tnt_a/kfs";

describe("gotenberg DOCGEN adapter (#120)", () => {
  it("posts one index.html to the Chromium route and stores the PDF with its hash", async () => {
    seen.length = 0;
    const { p, storage } = make({ basic: true });
    const r = await p.renderHtml({ html, format: "pdf", outputPrefix: prefix });
    const call = seen.at(-1)!;
    expect(call.url).toBe("/forms/chromium/convert/html");
    expect(call.auth).toBe(`Basic ${Buffer.from("gb:secret").toString("base64")}`);
    expect(call.body).toContain('filename="index.html"');
    expect(call.body).toContain("मुख्य तथ्य विवरण ₹500");
    for (const [k, v] of [
      ["paperWidth", "8.27"],
      ["paperHeight", "11.7"],
      ["preferCssPageSize", "true"],
      ["failOnConsoleExceptions", "true"],
    ])
      expect(call.body).toMatch(new RegExp(`name="${k}"\\r\\n\\r\\n${v}\\r\\n`));
    expect(call.body).not.toContain('name="pdfa"');
    expect(r).toMatchObject({
      format: "pdf",
      pageCount: 2,
      templateVersion: null,
      adapter: "gotenberg",
    });
    expect(r.file.storageKey).toMatch(/^tenant\/tnt_a\/kfs\/[0-9A-Z]{26}\.pdf$/);
    const stored = await storage.get(r.file.storageKey);
    expect(Buffer.from(stored.body).equals(PDF)).toBe(true);
    expect(stored.meta).toMatchObject({
      contentType: "application/pdf",
      bucketClass: "CONFIDENTIAL",
      sha256: r.file.sha256,
    });
  });

  it("asks for PDF/A-2b and PDF/UA when the format is pdfa", async () => {
    const { p } = make();
    await p.renderHtml({ html, format: "pdfa", outputPrefix: prefix });
    const body = seen.at(-1)!.body;
    expect(body).toMatch(/name="pdfa"\r\n\r\nPDF\/A-2b\r\n/);
    expect(body).toMatch(/name="pdfua"\r\n\r\ntrue\r\n/);
  });

  it("refuses when off, on a non-PDF answer or an error, and for the template methods", async () => {
    const code = (x: Promise<unknown>) =>
      x.then(
        () => null,
        (e: { code?: string; meta?: { reason?: string } }) =>
          `${e.code}${e.meta?.reason ? `:${e.meta.reason}` : ""}`,
      );
    expect(
      await code(
        make({ enabled: false }).p.renderHtml({ html, format: "pdf", outputPrefix: prefix }),
      ),
    ).toBe("IPB-PORT-001");
    reply = { status: 200, body: Buffer.from("<html>not a pdf</html>") };
    expect(await code(make().p.renderHtml({ html, format: "pdf", outputPrefix: prefix }))).toBe(
      "IPB-PORT-002",
    );
    reply = { status: 503, body: Buffer.from("busy") };
    expect(await code(make().p.renderHtml({ html, format: "pdf", outputPrefix: prefix }))).toBe(
      "IPB-PORT-002",
    );
    reply = { status: 200, body: PDF };
    const { p } = make();
    expect(await code(p.render())).toBe("IPB-PORT-001:unsupported");
    expect(await code(p.listTemplates())).toBe("IPB-PORT-001:unsupported");
    expect(p.descriptor.capabilities).toMatchObject({
      render: "unsupported",
      validateTemplate: "unsupported",
    });
    expect((await p.health()).status).toBe("up");
  });

  it("refuses a non-HTTPS host other than loopback (SSRF guard)", async () => {
    const p = new GotenbergDocgen({
      baseUrl: "http://gotenberg.internal:3000",
      storage: new MemoryStorage(),
      enabled: () => true,
    });
    await expect(p.renderHtml({ html, format: "pdf", outputPrefix: prefix })).rejects.toMatchObject(
      {
        code: "IPB-SEC-018",
      },
    );
  });

  it("reads the page count from the page tree", () => {
    expect(pageCount(PDF)).toBe(2);
    expect(pageCount(Buffer.from("%PDF-1.7 no tree"))).toBeNull();
  });
});
