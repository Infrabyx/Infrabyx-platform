// IDfy KYC stub (R1-plan M25, owner answer #91), from the request and response shapes the
// `idfy-kyc` adapter documents as stub-shaped [VERIFY]: IDfy's task API (`account-id` and `api-key`
// headers; `POST /v3/tasks/sync/<action>/<type>` with `{ task_id, group_id, data }`, answered with
// `{ request_id, status, result }`). Proves adapter logic only; the sandbox leg proves the vendor
// once the owner's IDfy sandbox exists. Test identities only.
import { stubCredential, startStub, type VendorStub } from "./http.js";

export interface IdfyKycStub extends VendorStub {
  accountId: string;
  apiKey: string;
  /** The PAN the stub knows, and the name on it. */
  pan: { pan: string; name: string; unknownPan: string };
  /** Face images: `a` and `same` are one person, `other` another; frames read as live. */
  faces: { a: Buffer; same: Buffer; other: Buffer };
  frames: Buffer[];
}

let seq = 0;
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .split(/\s+/)
    .filter(Boolean);

export async function startIdfyKycStub(): Promise<IdfyKycStub> {
  const ref: { s?: IdfyKycStub } = {};
  const stub = await startStub((r) => {
    const s = ref.s!;
    if (r.headers["account-id"] !== s.accountId || r.headers["api-key"] !== s.apiKey)
      return { status: 401, body: { error: "UNAUTHORIZED" } };
    const m = /^\/v3\/tasks\/sync\/([a-z_]+)\/([a-z_]+)$/.exec(r.path);
    if (r.method !== "POST" || !m) return { status: 404, body: { error: "NOT_FOUND" } };
    const b = r.json<{ task_id?: string; group_id?: string; data?: Record<string, string> }>();
    if (!b.task_id || !b.group_id || !b.data)
      return { status: 400, body: { error: "BAD_REQUEST" } };
    const done = (result: Record<string, unknown>) => ({
      status: 200,
      body: {
        request_id: `REQ${String(++seq).padStart(10, "0")}`,
        task_id: b.task_id,
        group_id: b.group_id,
        status: "completed",
        result,
      },
    });
    const img = (k: string) => Buffer.from(b.data?.[k] ?? "", "base64");
    const task = `${m[1]}/${m[2]}`;
    if (task === "verify_with_source/ind_pan") {
      const pan = b.data.id_number ?? "";
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan))
        return { status: 422, body: { error: "INVALID_ID" } };
      if (pan !== s.pan.pan) return done({ source_output: { status: "id_not_found" } });
      const want = tokens(s.pan.name);
      const got = tokens(b.data.full_name ?? "");
      const score = got.filter((t) => want.includes(t)).length / Math.max(want.length, got.length);
      return done({
        source_output: {
          status: "id_found",
          name_match_score: score,
          dob_match: b.data.dob ? b.data.dob === "1990-01-01" : undefined,
          aadhaar_seeding_status: "Y",
        },
      });
    }
    if (task === "compare/face") {
      const one = img("document1");
      const two = img("document2");
      const person = (x: Buffer) => x.equals(s.faces.a) || x.equals(s.faces.same);
      return done({
        match_score: person(one) && person(two) ? 0.94 : 0.18,
        model_version: "face-compare-stub-1",
      });
    }
    if (task === "check_photo_liveness/face") {
      const live = s.frames.some((f) => f.equals(img("document1")));
      return done({ liveness_score: live ? 0.91 : 0.3, model_version: "liveness-stub-1" });
    }
    return { status: 404, body: { error: "NOT_FOUND" } };
  });
  ref.s = Object.assign(stub, {
    accountId: `acc-${stubCredential().slice(0, 12)}`,
    apiKey: stubCredential(),
    pan: { pan: "AAAPZ1234C", name: "Asha Rao", unknownPan: "ZZZPZ9999Z" },
    faces: {
      a: Buffer.from("idfy-stub-face-a"),
      same: Buffer.from("idfy-stub-face-a-2"),
      other: Buffer.from("idfy-stub-face-b"),
    },
    frames: [1, 2, 3].map((i) => Buffer.from(`idfy-stub-frame-${i}`)),
  });
  return ref.s;
}
