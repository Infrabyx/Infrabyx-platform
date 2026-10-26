// @infrabyx IPB ESLint rules — placeholders for the IPB-01 custom lint checks.
//
//   ipb/vendor-import    IPB-01-14  vendor SDK imports only inside packages/connectors/
//   ipb/schema-boundary  IPB-01-09  a module never imports another module's Drizzle schema
//   ipb/no-process-env   IPB-01-19  process.env is read only inside packages/config/
//   ipb/no-direct-crypto IPB-12-05  cryptography only through packages/crypto (PL1-C-01)
//   ipb/port-data-class  IPB-01-16  a port call never states a class below the port default, and
//                                   port payload schemas annotate every field (PL2-D-03)
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

const CRYPTO_MODULES = new Set(["crypto", "node:crypto"]);

const noDirectCrypto = {
  meta: {
    type: "problem",
    docs: {
      description:
        "IPB-12-05: every signature, hash, key and random value is created through @infrabyx/crypto; no direct node:crypto or Web Crypto use elsewhere.",
    },
    schema: [],
    messages: {
      module:
        "IPB-12-05: '{{spec}}' is imported outside packages/crypto; use @infrabyx/crypto instead.",
      global:
        "IPB-12-05: global '{{name}}' is used outside packages/crypto; use @infrabyx/crypto instead.",
    },
  },
  create(context) {
    const file = toPosix(context.filename ?? context.getFilename());
    if (packageOf(file) === "crypto") return {};
    const isGlobalCrypto = (node) => {
      const scope = context.sourceCode.getScope(node);
      let s = scope;
      while (s) {
        if (s.set && s.set.has("crypto") && s.set.get("crypto").defs.length > 0) return false;
        s = s.upper;
      }
      return true;
    };
    return {
      ...forEachImport(context, (node, spec) => {
        if (CRYPTO_MODULES.has(spec)) context.report({ node, messageId: "module", data: { spec } });
      }),
      MemberExpression(node) {
        const obj = node.object;
        if (obj.type === "Identifier" && obj.name === "crypto" && isGlobalCrypto(node)) {
          context.report({ node, messageId: "global", data: { name: "crypto" } });
        }
        if (
          obj.type === "Identifier" &&
          (obj.name === "globalThis" || obj.name === "window" || obj.name === "self") &&
          !node.computed &&
          node.property.type === "Identifier" &&
          node.property.name === "crypto"
        ) {
          context.report({ node, messageId: "global", data: { name: `${obj.name}.crypto` } });
        }
      },
    };
  },
};

/** Port default data classes; kept equal to PORT_DEFAULT_DATA_CLASS in @infrabyx/contracts (tested). */
export const PORT_DEFAULTS = {
  EMAIL: "INTERNAL",
  SMS: "INTERNAL",
  WHATSAPP: "INTERNAL",
  QUEUE: "INTERNAL",
  FEATURE_FLAG: "INTERNAL",
  OBSERVABILITY: "INTERNAL",
  PAYMENTS: "REGULATED",
};
export const DATA_CLASS_ORDER = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "REGULATED", "SECRET"];
const PORT_NAME_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const CLASS_WRAPPERS = new Set(["classed", "recipient", "internal", "regulated", "confidential"]);
const PAYLOAD_NAME_RE = /(Message|Spec|Data|Payload)$/;

/** The UPPER_SNAKE port named in a callee chain such as `ports.EMAIL.send`, or null. */
function portInCallee(node) {
  let n = node;
  while (n && n.type === "MemberExpression") {
    const prop = n.property;
    if (
      !n.computed &&
      prop.type === "Identifier" &&
      PORT_NAME_RE.test(prop.name) &&
      prop.name.length > 1
    )
      return prop.name;
    if (
      n.computed &&
      prop.type === "Literal" &&
      typeof prop.value === "string" &&
      PORT_NAME_RE.test(prop.value)
    )
      return prop.value;
    n = n.object;
  }
  return null;
}

function callsWrapper(node) {
  let found = false;
  const walk = (n) => {
    if (!n || typeof n !== "object" || found) return;
    if (
      n.type === "CallExpression" &&
      n.callee.type === "Identifier" &&
      CLASS_WRAPPERS.has(n.callee.name)
    ) {
      found = true;
      return;
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === "parent") continue;
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === "string") walk(v);
    }
  };
  walk(node);
  return found;
}

const portDataClass = {
  meta: {
    type: "problem",
    docs: {
      description:
        "IPB-01-16, PL2-D-03: a port call may raise the data class but never state one below the port default; port payload schemas annotate every field.",
    },
    schema: [],
    messages: {
      lowered:
        "PL2-D-03: dataClass {{cls}} is below the {{port}} default {{dflt}}; lower a call only through fully annotated payload schemas.",
      unannotated:
        "PL2-D-03: payload field '{{field}}' of {{schema}} has no data-class annotation (classed/recipient).",
    },
  },
  create(context) {
    const file = toPosix(context.filename ?? context.getFilename());
    const isPortContract =
      /packages\/contracts\/src\/ports\/[^/]+\.ts$/.test(file) && !file.endsWith(".test.ts");
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") return;
        const port = portInCallee(node.callee);
        if (!port) return;
        const dflt = PORT_DEFAULTS[port] ?? "CONFIDENTIAL";
        for (const arg of node.arguments) {
          if (arg.type !== "ObjectExpression") continue;
          for (const prop of arg.properties) {
            if (prop.type !== "Property" || prop.computed) continue;
            const key = prop.key.type === "Identifier" ? prop.key.name : prop.key.value;
            if (key !== "dataClass" || prop.value.type !== "Literal") continue;
            const cls = prop.value.value;
            if (
              DATA_CLASS_ORDER.indexOf(cls) >= 0 &&
              DATA_CLASS_ORDER.indexOf(cls) < DATA_CLASS_ORDER.indexOf(dflt)
            )
              context.report({ node: prop, messageId: "lowered", data: { cls, port, dflt } });
          }
        }
      },
      VariableDeclarator(node) {
        if (!isPortContract || node.id.type !== "Identifier" || !PAYLOAD_NAME_RE.test(node.id.name))
          return;
        const init = node.init;
        if (!init || init.type !== "CallExpression" || init.callee.type !== "MemberExpression")
          return;
        if (init.callee.property.name !== "object") return;
        const shape = init.arguments[0];
        if (!shape || shape.type !== "ObjectExpression") return;
        for (const prop of shape.properties) {
          if (prop.type !== "Property") continue;
          if (!callsWrapper(prop.value)) {
            const field = prop.key.type === "Identifier" ? prop.key.name : String(prop.key.value);
            context.report({
              node: prop,
              messageId: "unannotated",
              data: { field, schema: node.id.name },
            });
          }
        }
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
    "no-direct-crypto": noDirectCrypto,
    "port-data-class": portDataClass,
  },
};

export default plugin;
