// @infrabyx IPB ESLint rules — placeholders for the IPB-01 custom lint checks.
//
//   ipb/vendor-import    IPB-01-14  vendor SDK imports only inside packages/connectors/
//   ipb/schema-boundary  IPB-01-09  a module never imports another module's Drizzle schema
//   ipb/no-process-env   IPB-01-19  process.env is read only inside packages/config/
//
// These are PL0 placeholders: the detection is path/pattern based and will be tightened
// when modules, Drizzle schemas and the port catalogue land (PL1–PL2). Rules are never
// disabled inline (IPB-09 §09.4.12 item 9).
import path from "node:path";

/** Vendor SDK patterns (IPB-01 §01.4.2 rules; grows with the port catalogue in 01.4.4). */
export const VENDOR_SDK_PATTERNS = [
  /^@aws-sdk\//,
  /^aws-sdk$/,
  /^@azure\//,
  /^@google-cloud\//,
  /^@google\/genai$/,
  /^@anthropic-ai\//,
  /^openai$/,
  /^@mistralai\//,
  /^razorpay$/,
  /^stripe$/,
  /^@supabase\//,
  /^@sendgrid\//,
  /^@getbrevo\//,
  /^twilio$/,
  /^@keycloak\//,
  /^@cerbos\//,
  /^@temporalio\//,
  /^bullmq$/,
  /^ioredis$/,
  /^redis$/,
  /^minio$/,
  /^@opensearch-project\//,
  /^@elastic\//,
  /^unleash-client$/,
  /^@hyperverge\//,
  /^@digio\//,
  /^@signzy\//,
];

const toPosix = (p) => p.split(path.sep).join("/");

/** Returns the package name (`packages/<name>`) that a repo path belongs to, or null. */
export function packageOf(filePath) {
  const m = toPosix(filePath).match(/(?:^|\/)packages\/([^/]+)(?:\/|$)/);
  return m ? m[1] : null;
}

/** Returns the module name (`.../modules/<name>/`) that a path belongs to, or null. */
export function moduleOf(filePath) {
  const m = toPosix(filePath).match(/(?:^|\/)modules\/([^/]+)(?:\/|$)/);
  return m ? m[1] : null;
}

/** Names the "boundary" a path lives in: a NestJS module first, else a workspace package. */
export function boundaryOf(filePath) {
  const mod = moduleOf(filePath);
  if (mod) return `module:${mod}`;
  const pkg = packageOf(filePath);
  if (pkg) return `package:${pkg}`;
  return null;
}

const SCHEMA_PATH = /(^|\/)(schema|drizzle)(\/|\.[cm]?[jt]s$|$)|\.schema(\.[cm]?[jt]s)?$/;

function isSchemaImport(spec) {
  return SCHEMA_PATH.test(spec);
}

function resolveImportBoundary(importerFile, spec) {
  if (spec.startsWith("@infrabyx/")) {
    const name = spec.split("/")[1];
    return `package:${name}`;
  }
  if (spec.startsWith(".")) {
    const abs = path.posix.resolve(path.posix.dirname(toPosix(importerFile)), spec);
    return boundaryOf(abs);
  }
  return null; // bare third-party import: not a boundary question
}

function forEachImport(context, visit) {
  const onSource = (node, source) => {
    if (source && source.type === "Literal" && typeof source.value === "string") {
      visit(node, source.value);
    }
  };
  return {
    ImportDeclaration: (n) => onSource(n, n.source),
    ExportNamedDeclaration: (n) => onSource(n, n.source),
    ExportAllDeclaration: (n) => onSource(n, n.source),
    ImportExpression: (n) => onSource(n, n.source),
    CallExpression: (n) => {
      if (n.callee.type === "Identifier" && n.callee.name === "require" && n.arguments[0]) {
        onSource(n, n.arguments[0]);
      }
    },
  };
}

const vendorImport = {
  meta: {
    type: "problem",
    docs: {
      description:
        "IPB-01-14: vendor SDKs may be imported only inside packages/connectors/ (adapters).",
    },
    schema: [],
    messages: {
      vendor:
        "IPB-01-14: '{{spec}}' is a vendor SDK; import it only inside packages/connectors/ behind an IPB-01 port.",
    },
  },
  create(context) {
    const file = toPosix(context.filename ?? context.getFilename());
    if (packageOf(file) === "connectors") return {};
    return forEachImport(context, (node, spec) => {
      if (VENDOR_SDK_PATTERNS.some((re) => re.test(spec))) {
        context.report({ node, messageId: "vendor", data: { spec } });
      }
    });
  },
};

const schemaBoundary = {
  meta: {
    type: "problem",
    docs: {
      description:
        "IPB-01-09/11: a module (or package) never imports another module's schema; use its public service interface or events.",
    },
    schema: [],
    messages: {
      cross:
        "IPB-01-09: '{{spec}}' imports the schema of {{target}} from {{source}}. Modules access other modules only through their public service interface or events.",
    },
  },
  create(context) {
    const file = toPosix(context.filename ?? context.getFilename());
    const source = boundaryOf(file);
    if (!source) return {};
    return forEachImport(context, (node, spec) => {
      if (!isSchemaImport(spec)) return;
      const target = resolveImportBoundary(file, spec);
      if (target && target !== source) {
        context.report({ node, messageId: "cross", data: { spec, source, target } });
      }
    });
  },
};

const noProcessEnv = {
  meta: {
    type: "problem",
    docs: {
      description:
        "IPB-01-19: process.env is read only inside packages/config; adapters and modules read settings through @infrabyx/config and SECRETS_PORT.",
    },
    schema: [],
    messages: {
      env: "IPB-01-19: do not read process.env here; register the setting in packages/config and read it from there.",
    },
  },
  create(context) {
    const file = toPosix(context.filename ?? context.getFilename());
    if (packageOf(file) === "config") return {};
    return {
      MemberExpression(node) {
        const obj = node.object;
        const prop = node.property;
        const isProcess = obj.type === "Identifier" && obj.name === "process";
        const isEnv =
          (!node.computed && prop.type === "Identifier" && prop.name === "env") ||
          (node.computed && prop.type === "Literal" && prop.value === "env");
        if (isProcess && isEnv) context.report({ node, messageId: "env" });
      },
    };
  },
};

const plugin = {
  meta: { name: "@infrabyx/eslint-plugin-ipb", version: "0.0.0" },
  rules: {
    "vendor-import": vendorImport,
    "schema-boundary": schemaBoundary,
    "no-process-env": noProcessEnv,
  },
};

export default plugin;
