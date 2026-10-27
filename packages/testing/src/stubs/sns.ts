// Amazon SNS test signer (C-13 hermetic tests): a throwaway self-signed certificate generated per
// run with the openssl CLI, and SignatureVersion 2 signatures over SNS's string to sign. No key
// material is committed; the adapter under test is given the certificate instead of fetching it.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SnsEnvelope {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
}

export interface SnsSigner {
  certPem: string;
  certUrl: string;
  sign(m: Omit<SnsEnvelope, "Signature" | "SignatureVersion" | "SigningCertURL">): SnsEnvelope;
  close(): void;
}

export function createSnsSigner(region = "ap-south-1"): SnsSigner {
  const dir = mkdtempSync(join(tmpdir(), "ipb-sns-"));
  const key = join(dir, "k.pem");
  const cert = join(dir, "c.pem");
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2"].concat([
      "-subj",
      `/CN=sns.${region}.amazonaws.com`,
      "-keyout",
      key,
      "-out",
      cert,
    ]),
    { stdio: "ignore" },
  );
  const certPem = readFileSync(cert, "utf8");
  const certUrl = `https://sns.${region}.amazonaws.com/SimpleNotificationService-0123456789abcdef.pem`;
  return {
    certPem,
    certUrl,
    sign(m) {
      const full = { ...m, SignatureVersion: "2", SigningCertURL: certUrl };
      const fields =
        m.Type === "Notification"
          ? [
              "Message",
              "MessageId",
              ...(m.Subject ? ["Subject"] : []),
              "Timestamp",
              "TopicArn",
              "Type",
            ]
          : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
      const toSign = fields
        .map((k) => `${k}\n${(full as unknown as Record<string, string>)[k]}\n`)
        .join("");
      const input = join(dir, "msg");
      writeFileSync(input, toSign);
      const sig = execFileSync("openssl", ["dgst", "-sha256", "-sign", key, input]);
      return { ...full, Signature: sig.toString("base64") };
    },
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}
