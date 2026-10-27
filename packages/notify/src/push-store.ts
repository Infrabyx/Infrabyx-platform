// `PgPushTokenStore` (PL3 plan §6.7): device tokens sealed with FieldCrypto in
// `notify.device_token`, found again through a SHA-256 lookup digest. The PUSH adapters call it
// without a context, so it runs in the context NOTIFY sets (`notifyContext`), or one passed in.
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import type { PushPlatform, PushTokenStore } from "@infrabyx/contracts/ports";
import { newId, sha256Hex } from "@infrabyx/crypto";
import type { FieldCrypto } from "@infrabyx/tenancy";
import { notifyContext } from "./service.js";

export interface PgPushTokenStoreOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  fieldCrypto: FieldCrypto;
  /** Context outside NOTIFY deliveries (device registration from the API). */
  context?: () => KernelContext | undefined;
}

export class PgPushTokenStore implements PushTokenStore {
  constructor(private readonly o: PgPushTokenStoreOptions) {}

  private ctx(): KernelContext {
    const c = notifyContext.getStore() ?? this.o.context?.();
    if (!c)
      throw new Error("PgPushTokenStore needs a context (notifyContext.run or the context option)");
    return c;
  }

  async save(t: {
    userId: string;
    platform: PushPlatform;
    provider: string;
    token: string;
  }): Promise<{ tokenRef: string }> {
    const ctx = this.ctx();
    const digest = sha256Hex(`${t.provider}:${t.token}`);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const found = await tx.query<{ id: string }>(
          "update notify.device_token set last_seen_at = now(), user_ref = $3 where provider = $1 and token_digest = $2 returning id",
          [t.provider, digest, t.userId],
        );
        const existing = found.rows[0]?.id;
        const id = existing ?? newId("ptk");
        if (!existing) {
          const sealed = await this.o.fieldCrypto.encryptField(
            ctx.tenantId,
            "CONFIDENTIAL",
            t.token,
            {
              table: "notify.device_token",
              column: "token_enc",
              rowId: id,
            },
          );
          await tx.query(
            `insert into notify.device_token (id, tenant_id, user_ref, provider, platform, token_enc, token_key_id, token_digest)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              id,
              ctx.tenantId,
              t.userId,
              t.provider,
              t.platform,
              Buffer.from(sealed.enc),
              sealed.keyId,
              digest,
            ],
          );
        }
        await this.o.audit.record(tx, {
          action: existing ? "notify.device_token.seen" : "notify.device_token.register",
          resourceType: "device_token",
          resourceId: id,
          after: { provider: t.provider, platform: t.platform },
        });
        return { tokenRef: id };
      },
      { action: "notify.device_token.register" },
    );
  }

  async forUsers(userIds: readonly string[], provider: string) {
    const ctx = this.ctx();
    const rows = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<{
            id: string;
            user_ref: string;
            platform: PushPlatform;
            token_enc: Buffer;
            token_key_id: string;
          }>(
            "select id, user_ref, platform, token_enc, token_key_id from notify.device_token where provider = $1 and user_ref = any($2::text[]) order by created_at",
            [provider, [...userIds]],
          )
        ).rows,
    );
    const out = [];
    for (const r of rows)
      out.push({
        tokenRef: r.id,
        userId: r.user_ref,
        platform: r.platform,
        token: await this.o.fieldCrypto.decryptFieldText(
          ctx.tenantId,
          { enc: new Uint8Array(r.token_enc), keyId: r.token_key_id, alg: "aes-256-gcm" },
          { table: "notify.device_token", column: "token_enc", rowId: r.id },
        ),
      });
    return out;
  }

  async remove(tokenRef: string): Promise<void> {
    await this.o.kernel.mutate(
      this.ctx(),
      async (tx) => {
        await tx.query("delete from notify.device_token where id = $1", [tokenRef]);
        await this.o.audit.record(tx, {
          action: "notify.device_token.remove",
          resourceType: "device_token",
          resourceId: tokenRef,
        });
      },
      { action: "notify.device_token.remove" },
    );
  }
}
