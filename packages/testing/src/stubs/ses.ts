// Amazon SES v2 stub (PL2 plan §6.10 hermetic leg). moto 5.2.4 covers raw and simple sends and
// identities but not templated sends, suppression or the account call ([VERIFY] outcome,
// PL2-D-64), so this stub serves the SES v2 REST-JSON routes the `ses` adapter uses, from the
// SES v2 API reference. moto still checks raw send and identity parsing.
import { startStub, type StubReply, type VendorStub } from "./http.js";

export interface SesStubMessage {
  messageId: string;
  from?: string;
  to: string[];
  template?: string;
  templateData?: Record<string, unknown>;
  raw?: Buffer;
  configurationSet?: string;
  tags: Record<string, string>;
  attachments: Array<{ fileName: string; contentType?: string; bytes: number }>;
  suppressed: boolean;
}

export interface SesStub extends VendorStub {
  readonly messages: SesStubMessage[];
  readonly suppressed: Map<string, string>;
  templates: Set<string>;
  /** Domain identities: DKIM tokens and whether DKIM verified. */
  identities: Map<string, { tokens: string[]; verified: boolean }>;
  /** Simulate a paused account (reputation block). */
  paused: boolean;
}

const err = (status: number, type: string, message: string): StubReply => ({
  status,
  headers: { "x-amzn-errortype": type },
  body: { message },
});

let seq = 0;

export async function startSesStub(): Promise<SesStub> {
  const messages: SesStubMessage[] = [];
  const suppressed = new Map<string, string>();
  // Mutable test state, reachable as properties of the returned stub.
  const ref: { s?: SesStub } = {};
  const stub = await startStub((r) => {
    const state = ref.s!;
    if (!/^AWS4-HMAC-SHA256 /.test(r.headers.authorization ?? ""))
      return err(403, "UnrecognizedClientException", "missing SigV4");
    if (r.method === "POST" && r.path === "/v2/email/outbound-emails") {
      if (state.paused)
        return err(400, "SendingPausedException", "sending is paused for this account");
      const b = r.json<{
        FromEmailAddress?: string;
        Destination?: { ToAddresses?: string[]; CcAddresses?: string[] };
        Content?: {
          Template?: {
            TemplateName?: string;
            TemplateData?: string;
            Attachments?: Array<{ FileName: string; ContentType?: string; RawContent: string }>;
          };
          Raw?: { Data: string };
        };
        ConfigurationSetName?: string;
        EmailTags?: Array<{ Name: string; Value: string }>;
      }>();
      const t = b.Content?.Template;
      if (t && !state.templates.has(t.TemplateName ?? ""))
        return err(404, "NotFoundException", `template ${t.TemplateName} does not exist`);
      const raw = b.Content?.Raw ? Buffer.from(b.Content.Raw.Data, "base64") : undefined;
      const to = b.Destination?.ToAddresses ?? [];
      const messageId = `0109019${(++seq).toString(16).padStart(9, "0")}-stub-000000`;
      messages.push({
        messageId,
        ...(b.FromEmailAddress ? { from: b.FromEmailAddress } : {}),
        to,
        ...(t?.TemplateName ? { template: t.TemplateName } : {}),
        ...(t?.TemplateData
          ? { templateData: JSON.parse(t.TemplateData) as Record<string, unknown> }
          : {}),
        ...(raw ? { raw } : {}),
        ...(b.ConfigurationSetName ? { configurationSet: b.ConfigurationSetName } : {}),
        tags: Object.fromEntries((b.EmailTags ?? []).map((x) => [x.Name, x.Value])),
        attachments: (t?.Attachments ?? []).map((a) => ({
          fileName: a.FileName,
          ...(a.ContentType ? { contentType: a.ContentType } : {}),
          bytes: Buffer.from(a.RawContent, "base64").byteLength,
        })),
        // SES drops sends to suppressed addresses without an error (account-level list).
        suppressed: to.some((a) => suppressed.has(a.toLowerCase())),
      });
      return { status: 200, body: { MessageId: messageId } };
    }
    if (r.method === "PUT" && r.path === "/v2/email/suppression/addresses") {
      const b = r.json<{ EmailAddress: string; Reason: string }>();
      if (!["BOUNCE", "COMPLAINT"].includes(b.Reason))
        return err(400, "BadRequestException", "Reason must be BOUNCE or COMPLAINT");
      suppressed.set(b.EmailAddress.toLowerCase(), b.Reason);
      return { status: 200, body: {} };
    }
    const sup = /^\/v2\/email\/suppression\/addresses\/(.+)$/.exec(r.path);
    if (r.method === "GET" && sup) {
      const a = decodeURIComponent(sup[1]!).toLowerCase();
      const reason = suppressed.get(a);
      return reason
        ? {
            status: 200,
            body: {
              SuppressedDestination: {
                EmailAddress: a,
                Reason: reason,
                LastUpdateTime: Date.now() / 1000,
              },
            },
          }
        : err(404, "NotFoundException", "not suppressed");
    }
    if (r.method === "GET" && r.path === "/v2/email/account")
      return {
        status: 200,
        body: {
          SendingEnabled: !state.paused,
          EnforcementStatus: state.paused ? "SHUTDOWN" : "HEALTHY",
          ProductionAccessEnabled: false,
        },
      };
    if (r.method === "POST" && r.path === "/v2/email/identities") {
      const b = r.json<{ EmailIdentity: string }>();
      if (!state.identities.has(b.EmailIdentity))
        state.identities.set(b.EmailIdentity, {
          tokens: [1, 2, 3].map((i) => `stubtoken${i}${b.EmailIdentity.length}`),
          verified: false,
        });
      return { status: 200, body: { IdentityType: "DOMAIN", VerifiedForSendingStatus: false } };
    }
    const idm = /^\/v2\/email\/identities\/([^/]+)$/.exec(r.path);
    if (r.method === "GET" && idm) {
      const id = state.identities.get(decodeURIComponent(idm[1]!));
      if (!id) return err(404, "NotFoundException", "identity not found");
      return {
        status: 200,
        body: {
          IdentityType: "DOMAIN",
          VerifiedForSendingStatus: id.verified,
          DkimAttributes: {
            SigningEnabled: true,
            Status: id.verified ? "SUCCESS" : "PENDING",
            Tokens: id.tokens,
          },
        },
      };
    }
    return err(404, "NotFoundException", `no stub route ${r.method} ${r.path}`);
  });
  const state: SesStub = Object.assign(stub, {
    messages,
    suppressed,
    templates: new Set<string>(),
    identities: new Map<string, { tokens: string[]; verified: boolean }>(),
    paused: false,
  });
  ref.s = state;
  return state;
}
