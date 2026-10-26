#!/usr/bin/env node
// infrabyx-env example --schema <module> [--export envSchema] [--out .env.example] [--product LDC] [--check]
// Generates .env.example from an env schema; --check fails on drift and names the variables (@IPB-11-AT-06).
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { exampleDrift, generateEnvExample } from "./example.js";
import type { EnvSchema } from "./schema.js";

export async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      schema: { type: "string" },
      export: { type: "string", default: "envSchema" },
      out: { type: "string", default: ".env.example" },
      product: { type: "string" },
      check: { type: "boolean", default: false },
    },
  });
  if (positionals[0] !== "example" || !values.schema) {
    process.stderr.write(
      "usage: infrabyx-env example --schema <module> [--export envSchema] [--out .env.example] [--product LDC] [--check]\n",
    );
    return 2;
  }
  const mod = (await import(pathToFileURL(resolve(values.schema)).href)) as Record<string, unknown>;
  const schema = mod[values.export] as EnvSchema | undefined;
  if (!schema || typeof (schema as { shape?: unknown }).shape !== "object") {
    process.stderr.write(`${values.schema} does not export a zod object named ${values.export}\n`);
    return 2;
  }
  const generated = generateEnvExample(schema, values.product ? { product: values.product } : {});
  if (values.check) {
    const committed = await readFile(values.out, "utf8").catch(() => "");
    const drift = exampleDrift(committed, generated);
    if (drift.length) {
      process.stderr.write(
        `${values.out} is out of date with ${values.schema}; regenerate with infrabyx-env example. Drift: ${drift.join(", ")}\n`,
      );
      return 1;
    }
    process.stdout.write(`${values.out} matches the schema\n`);
    return 0;
  }
  await writeFile(values.out, generated);
  process.stdout.write(`wrote ${values.out}\n`);
  return 0;
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
