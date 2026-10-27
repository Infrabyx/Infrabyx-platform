// seed:credentials (IPB-11 §11.3.E, §11.4.6, §11.4.7). Generates one password per human persona,
// stores it in the seed vault (SECRETS) and on the IdP (IDENTITY), writes SEED_CREDENTIALS.md with
// mode 0600 and registers it in .git/info/exclude, and prints exactly one line. A password is never
// printed, logged or returned. Agents and services get no password (IPB-11-39).
import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  PRODUCT_EMAIL_LABEL,
  SEED_REFUSED_ENVS,
  type AppEnv,
  type ProductCode,
} from "@infrabyx/contracts/env";
import { IpbError } from "@infrabyx/contracts/errors";
import type { IdentityProvisioning, SecretsPort } from "@infrabyx/contracts/ports";
import {
  SecretKey,
  fromHex,
  generateSeedPassword,
  hmacSha256Hex,
  isValidSeedPassword,
  randomBytes,
  toHex,
} from "@infrabyx/crypto";
import { seedPersonas } from "./platform.js";
import { serviceAccountsFor, type Persona } from "./personas/index.js";
import { SEED_TENANT_IDS } from "./framework.js";

export interface CredentialsOptions {
  env: { APP_ENV: AppEnv; SEED_ENABLED?: boolean };
  product: ProductCode;
  /** AUTH_SUPER_ADMIN_EMAIL; the placeholder when unset. */
  superAdminEmail?: string;
  secrets: SecretsPort;
  identity: IdentityProvisioning;
  /** SEED_VAULT_PREFIX, e.g. secret://env/infrabyx/ldc/local/seed */
  vaultPrefix: string;
  /** Vault path of the cross-product salted hash list (IPB-11 §11.4.7), e.g. infrabyx/_seed/password-hashes. */
  hashListPath: string;
  /** SEED_CREDENTIALS_PATH */
  filePath: string;
  runId: string;
  noFile?: boolean;
  rotate?: boolean;
  /** Repository root holding .git (for .git/info/exclude). */
  repoRoot?: string;
  now?: Date;
  out?: (line: string) => void;
  onGenerated?: (data: { run_id: string; count: number; rotated: boolean }) => void;
}

const ENV_LIST = "local, dev, test, demo, staging";
const FORCE_CHANGE_ENVS: readonly AppEnv[] = ["staging", "demo"];
const MFA_ENVS: readonly AppEnv[] = ["staging", "demo", "prod"];

function vaultPath(prefix: string): string {
  const m = /^secret:\/\/[a-z][a-z0-9_-]*\/(.+)$/.exec(prefix);
  return (m?.[1] ?? prefix).replace(/\/+$/, "");
}

interface HashList {
  salt: string;
  hashes: string[];
}

async function loadHashList(secrets: SecretsPort, path: string): Promise<HashList> {
  try {
    return JSON.parse((await secrets.get(path)).value) as HashList;
  } catch {
    return { salt: toHex(randomBytes(32)), hashes: [] };
  }
}

function render(
  o: CredentialsOptions,
  rows: Array<{ p: Persona & { email: string }; password: string }>,
  at: string,
): string {
  const label = PRODUCT_EMAIL_LABEL[o.product];
  const tenant = (p: Persona) => p.tenant;
  const envs = (p: Persona) =>
    p.role === "PLT_SUPER_ADMIN" ? `${ENV_LIST} (prod: invitation link, not seeded)` : ENV_LIST;
  const lines = [
    `# SEED_CREDENTIALS — ${o.product} — generated ${at} by pnpm seed:credentials (run id ${o.runId})`,
    "",
    "> Gitignored and blocked by repository ruleset. Do not paste into chats, tickets or wikis.",
    "> Valid for environments: local, dev, test, demo, staging. Production never uses this file.",
    `> All passwords: 24+ chars, CSPRNG, unique per app and persona. Also stored at ${o.vaultPrefix}.`,
    "> On first login in staging/demo/prod: password change + MFA enrolment are forced.",
    "",
    "| Persona | Role | Email | Password | Tenant | Environments |",
    "|---|---|---|---|---|---|",
    ...rows.map(
      ({ p, password }) =>
        `| ${p.label} | ${p.role} | ${p.email} | ${password} | ${tenant(p)} | ${envs(p)} |`,
    ),
    "",
    "## Service accounts (no passwords; client credentials in vault only)",
    "| Identity | Role | Client ID | Vault path |",
    "|---|---|---|---|",
    ...serviceAccountsFor(o.product).map(
      (s) => `| ${s.label} | ${s.role} | ${label}-${s.clientSuffix} | ${o.vaultPrefix}/${s.key} |`,
    ),
    "",
    "## Rotation log",
    "| Date | Run id | Rotated by | Reason |",
    "|---|---|---|---|",
    `| ${at} | ${o.runId} | pnpm seed:credentials | ${o.rotate ? "rotation" : "initial generation"} |`,
    "",
  ];
  return lines.join("\n");
}

async function excludeFromGit(repoRoot: string, filePath: string): Promise<void> {
  const exclude = join(repoRoot, ".git", "info", "exclude");
  const entry = filePath.replace(/^\.\//, "");
  let current = "";
  try {
    current = await readFile(exclude, "utf8");
  } catch {
    await mkdir(dirname(exclude), { recursive: true }).catch(() => undefined);
  }
  if (!current.split("\n").includes(entry))
    await appendFile(exclude, `${current.endsWith("\n") || current === "" ? "" : "\n"}${entry}\n`);
}

export async function generateCredentials(
  o: CredentialsOptions,
): Promise<{ count: number; path: string | null }> {
  if (SEED_REFUSED_ENVS.includes(o.env.APP_ENV) || o.env.SEED_ENABLED !== true) {
    throw new IpbError("IPB-SEED-001", {
      detail: `seed credentials are refused in ${o.env.APP_ENV} or without SEED_ENABLED=true`,
    });
  }
  const out = o.out ?? ((l: string) => process.stdout.write(`${l}\n`));
  const label = PRODUCT_EMAIL_LABEL[o.product];
  const personas = seedPersonas(o);
  const list = await loadHashList(o.secrets, o.hashListPath);
  const salt = new SecretKey("seed-password-salt", "hmac-sha-256", fromHex(list.salt));
  const known = new Set(list.hashes);
  const rows: Array<{ p: (typeof personas)[number]; password: string }> = [];
  const fresh: string[] = [];
  for (const p of personas) {
    const forbidden = [p.key, ...p.key.split(/[._]/), label, o.product.toLowerCase()].filter(
      (s) => s.length >= 3,
    );
    let password = "";
    for (let i = 0; i < 20; i++) {
      password = generateSeedPassword({ forbidden });
      const h = hmacSha256Hex(salt, password);
      if (!known.has(h) && !fresh.includes(h)) {
        fresh.push(h);
        break;
      }
      password = "";
    }
    if (!password || !isValidSeedPassword(password, forbidden))
      throw new IpbError("IPB-SEED-005", {
        detail: `could not generate a unique password for ${p.key}`,
      });
    rows.push({ p, password });
  }
  const prefix = vaultPath(o.vaultPrefix);
  try {
    for (const { p, password } of rows) {
      await o.secrets.put(`${prefix}/${p.key}`, password, { owner: "seed", dataClass: "SECRET" });
    }
    await o.secrets.put(
      o.hashListPath,
      JSON.stringify({ salt: list.salt, hashes: [...list.hashes, ...fresh] }),
      { owner: "seed", dataClass: "SECRET" },
    );
  } catch {
    throw new IpbError("IPB-SEED-006", {
      detail: "seed vault write failed; no credentials file written",
    });
  }
  for (const { p, password } of rows) {
    await o.identity.provisionUser({
      email: p.email,
      displayName: p.label,
      tenantId: SEED_TENANT_IDS[p.tenant],
      roles: [p.role],
      password: { value: password, temporary: FORCE_CHANGE_ENVS.includes(o.env.APP_ENV) },
      mfaRequired: p.mfaAlways === true || MFA_ENVS.includes(o.env.APP_ENV),
    });
  }
  const runShort = o.runId;
  const onGenerated = { run_id: o.runId, count: rows.length, rotated: o.rotate === true };
  if (o.noFile) {
    out(
      `Stored ${rows.length} credentials in the seed vault at ${o.vaultPrefix} (run ${runShort})`,
    );
    o.onGenerated?.(onGenerated);
    return { count: rows.length, path: null };
  }
  const at = (o.now ?? new Date()).toISOString();
  await writeFile(o.filePath, render(o, rows, at), { mode: 0o600 });
  await chmod(o.filePath, 0o600);
  if (o.repoRoot) await excludeFromGit(o.repoRoot, o.filePath);
  out(`Wrote ${rows.length} credentials to ${o.filePath} (run ${runShort})`);
  o.onGenerated?.(onGenerated);
  return { count: rows.length, path: o.filePath };
}

/** IPB-11-27 / IPB-SEED-003: the credentials file lists exactly the product's personas (email, role, tenant). */
export function checkCredentialsFile(
  text: string,
  product: ProductCode,
  superAdminEmail?: string,
): string[] {
  const rows = text
    .split("\n")
    .filter((l) => /^\| [^|]+ \| [A-Z][A-Z0-9_]+ \| [^|]+@[^|]+ \|/.test(l))
    .map((l) => l.split("|").map((c) => c.trim()))
    .map((c) => ({ role: c[2], email: c[3], tenant: c[5] }));
  const want = seedPersonas({ product, superAdminEmail }).map((p) => ({
    role: p.role,
    email: p.email,
    tenant: p.tenant,
  }));
  const key = (r: {
    role: string | undefined;
    email: string | undefined;
    tenant: string | undefined;
  }) => `${r.email}|${r.role}|${r.tenant}`;
  const have = new Set(rows.map(key));
  const need = new Set(want.map(key));
  return [
    ...[...need].filter((k) => !have.has(k)).map((k) => `missing ${k}`),
    ...[...have].filter((k) => !need.has(k)).map((k) => `unexpected ${k}`),
  ];
}
