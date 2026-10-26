// SECRETS reference adapter `aws-sm` (PL2 plan §6.1): AWS Secrets Manager in ap-south-1 (or the
// ap-south-2 DR region). Secrets are created with the platform CMK, never the AWS-managed key
// (C-18). `lease` is emulated (current value, expiry = cache TTL); `audit` reads CloudTrail
// LookupEvents. Credentials come from workload identity (IRSA, GitHub OIDC); none are stored.
// The SDK is loaded only when this adapter is created (plan §3.10).
import type {
  AdapterDescriptor,
  PortHealth,
  SecretMeta,
  SecretsPort,
  SecretValue,
} from "@infrabyx/contracts/ports";
import { PortError } from "@infrabyx/contracts/errors";
import { checkPath, metaToTags, notFound, tagsToMeta } from "./common.js";

type SM = typeof import("@aws-sdk/client-secrets-manager");
type CT = typeof import("@aws-sdk/client-cloudtrail");

export interface AwsSecretsOptions {
  region: string;
  /** Platform CMK for new secrets (C-18). */
  kmsKeyId: string;
  /** Every path must start with this (`secrets/<env>/`). */
  pathPrefix?: string;
  /** Secret read by health(); defaults to a one-item ListSecrets. */
  canaryPath?: string;
  /** Expiry reported by the emulated `lease`. */
  cacheSeconds?: number;
  /** Tests only: endpoint and static credentials for moto or LocalStack. */
  endpoint?: string;
  /** Tests only: CloudTrail endpoint (moto lacks LookupEvents; a stub stands in, PL2-D-45). */
  cloudTrailEndpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

const REGIONS = new Set(["ap-south-1", "ap-south-2"]);

export class AwsSecretsManager implements SecretsPort {
  readonly descriptor: AdapterDescriptor = {
    port: "SECRETS",
    adapter: "aws-sm",
    residency: "IN",
    maxDataClass: "SECRET",
    capabilities: { lease: "emulated" },
  };

  private constructor(
    private readonly o: AwsSecretsOptions,
    private readonly sm: SM,
    private readonly client: InstanceType<SM["SecretsManagerClient"]>,
    private readonly ct: CT,
    private readonly trail: InstanceType<CT["CloudTrailClient"]>,
  ) {}

  static async create(o: AwsSecretsOptions): Promise<AwsSecretsManager> {
    if (!REGIONS.has(o.region))
      throw new PortError("IPB-PORT-005", "SECRETS", {
        adapter: "aws-sm",
        detail: `region ${o.region} is not an India region (residency IN)`,
      });
    if (!o.kmsKeyId)
      throw new PortError("IPB-PORT-005", "SECRETS", {
        adapter: "aws-sm",
        detail: "kmsKeyId (platform CMK) is required (C-18)",
      });
    const [sm, ct] = await Promise.all([
      import("@aws-sdk/client-secrets-manager"),
      import("@aws-sdk/client-cloudtrail"),
    ]);
    const cfg = {
      region: o.region,
      ...(o.endpoint ? { endpoint: o.endpoint } : {}),
      ...(o.credentials ? { credentials: o.credentials } : {}),
      maxAttempts: 3,
    };
    return new AwsSecretsManager(
      o,
      sm,
      new sm.SecretsManagerClient(cfg),
      ct,
      new ct.CloudTrailClient(
        o.cloudTrailEndpoint ? { ...cfg, endpoint: o.cloudTrailEndpoint } : cfg,
      ),
    );
  }

  private missing(e: unknown): boolean {
    return (e as { name?: string })?.name === "ResourceNotFoundException";
  }

  async get(path: string, version?: string): Promise<SecretValue> {
    checkPath("aws-sm", path, this.o.pathPrefix);
    try {
      const [v, d] = await Promise.all([
        this.client.send(
          new this.sm.GetSecretValueCommand({
            SecretId: path,
            ...(version ? { VersionId: version } : {}),
          }),
        ),
        this.client.send(new this.sm.DescribeSecretCommand({ SecretId: path })),
      ]);
      if (typeof v.SecretString !== "string" || !v.VersionId) throw notFound("aws-sm", path);
      const tags = Object.fromEntries((d.Tags ?? []).map((t) => [t.Key ?? "", t.Value]));
      const last = d.LastRotatedDate ?? d.LastChangedDate;
      return {
        value: v.SecretString,
        version: v.VersionId,
        meta: tagsToMeta(tags, last?.toISOString()),
      };
    } catch (e) {
      if (this.missing(e)) throw notFound("aws-sm", path);
      throw e;
    }
  }

  async put(path: string, value: string, meta?: SecretMeta): Promise<{ version: string }> {
    checkPath("aws-sm", path, this.o.pathPrefix);
    const Tags = Object.entries(metaToTags(meta)).map(([Key, Value]) => ({ Key, Value }));
    try {
      const r = await this.client.send(
        new this.sm.PutSecretValueCommand({ SecretId: path, SecretString: value }),
      );
      if (meta) await this.client.send(new this.sm.TagResourceCommand({ SecretId: path, Tags }));
      return { version: r.VersionId as string };
    } catch (e) {
      if (!this.missing(e)) throw e;
      const r = await this.client.send(
        new this.sm.CreateSecretCommand({
          Name: path,
          SecretString: value,
          KmsKeyId: this.o.kmsKeyId,
          Tags,
        }),
      );
      return { version: r.VersionId as string };
    }
  }

  /** New value becomes AWSCURRENT; the previous stays readable by version (AWSPREVIOUS) for overlap. */
  async rotate(
    path: string,
    rotator: (current: SecretValue) => Promise<string>,
  ): Promise<{ version: string }> {
    const current = await this.get(path);
    const next = await rotator(current);
    const r = await this.client.send(
      new this.sm.PutSecretValueCommand({ SecretId: path, SecretString: next }),
    );
    return { version: r.VersionId as string };
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let NextToken: string | undefined;
    do {
      const r = await this.client.send(
        new this.sm.ListSecretsCommand({
          Filters: [{ Key: "name", Values: [prefix] }],
          MaxResults: 100,
          ...(NextToken ? { NextToken } : {}),
        }),
      );
      for (const s of r.SecretList ?? []) if (s.Name?.startsWith(prefix)) out.push(s.Name);
      NextToken = r.NextToken;
    } while (NextToken);
    return out.sort();
  }

  async lease(path: string, ttlSeconds: number): Promise<SecretValue & { expiresAt: string }> {
    const v = await this.get(path);
    const secs = Math.min(ttlSeconds, this.o.cacheSeconds ?? 900);
    return { ...v, expiresAt: new Date(Date.now() + secs * 1000).toISOString() };
  }

  async audit(path: string): Promise<Array<{ at: string; actor: string; op: string }>> {
    checkPath("aws-sm", path, this.o.pathPrefix);
    const d = await this.client.send(new this.sm.DescribeSecretCommand({ SecretId: path }));
    const r = await this.trail.send(
      new this.ct.LookupEventsCommand({
        LookupAttributes: [{ AttributeKey: "ResourceName", AttributeValue: d.ARN ?? path }],
        MaxResults: 50,
      }),
    );
    return (r.Events ?? []).map((e) => ({
      at: (e.EventTime ?? new Date(0)).toISOString(),
      actor: e.Username ?? "unknown",
      op: e.EventName ?? "unknown",
    }));
  }

  async health(): Promise<PortHealth> {
    const t = Date.now();
    try {
      if (this.o.canaryPath)
        await this.client.send(new this.sm.GetSecretValueCommand({ SecretId: this.o.canaryPath }));
      else await this.client.send(new this.sm.ListSecretsCommand({ MaxResults: 1 }));
      return { status: "up", latency_ms: Date.now() - t, checked_at: new Date().toISOString() };
    } catch {
      return { status: "down", latency_ms: Date.now() - t, checked_at: new Date().toISOString() };
    }
  }
}
