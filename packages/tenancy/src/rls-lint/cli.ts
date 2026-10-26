#!/usr/bin/env node
// infrabyx-rls-lint --db <url> [--schema s]... [--allow-definer schema.fn]... [--allow-role name]...
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { DEFAULT_ALLOWED_DEFINERS, lintRls } from "./index.js";

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      db: { type: "string" },
      schema: { type: "string", multiple: true },
      "allow-definer": { type: "string", multiple: true },
      "allow-role": { type: "string", multiple: true },
    },
  });
  if (!values.db) {
    process.stderr.write(
      "usage: infrabyx-rls-lint --db <postgres url> [--schema s] [--allow-definer schema.fn] [--allow-role r]\n",
    );
    return 2;
  }
  const client = new pg.Client({ connectionString: values.db });
  await client.connect();
  try {
    const findings = await lintRls(client, {
      ...(values.schema ? { schemas: values.schema } : {}),
      allowDefiners: [...DEFAULT_ALLOWED_DEFINERS, ...(values["allow-definer"] ?? [])],
      allowPrivilegedRoles: values["allow-role"] ?? [],
    });
    for (const f of findings) process.stdout.write(`${f.rule} ${f.object}: ${f.message}\n`);
    process.stdout.write(
      findings.length ? `rls-lint: ${findings.length} finding(s)\n` : "rls-lint: clean\n",
    );
    return findings.length ? 1 : 0;
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exit(1);
    },
  );
}
