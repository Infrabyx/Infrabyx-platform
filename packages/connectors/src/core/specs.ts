// What the router needs to know about each port method (plan §3.1, §3.5, §5.2): whether it reads or
// writes, where its PortCall and payload are, and whether it is a side effect with an idempotency
// key. Methods not listed are writes with the port default class and no idempotency handling.
import type { z } from "zod";
import {
  EmailMessage,
  OrderSpec,
  QueueJobData,
  RefundSpec,
  SmsMessage,
  WhatsappSessionMessage,
  WhatsappTemplateMessage,
} from "@infrabyx/contracts/ports";

export interface MethodSpec {
  kind: "read" | "write";
  /** Index of the optional trailing PortCall argument. */
  callArg?: number;
  /** Index and schema of the payload whose data-class annotations apply. */
  payload?: { arg: number; schema: z.ZodType };
  /** Side effect with an idempotency key: where the key is, and whether money moves (P-05). */
  idempotent?: { keyArg: number | "call"; money?: boolean };
}

const read: MethodSpec = { kind: "read" };

export const PORT_METHODS: Readonly<Record<string, Readonly<Record<string, MethodSpec>>>> = {
  SECRETS: {
    get: read,
    list: read,
    audit: read,
    lease: read,
    put: { kind: "write" },
    rotate: { kind: "write" },
  },
  KMS: {
    encrypt: { kind: "write" },
    decrypt: { kind: "read" },
    generateDataKey: { kind: "write" },
    sign: { kind: "write" },
    verify: read,
    getPublicKey: read,
    listAlgorithms: read,
    createTenantKey: { kind: "write" },
    scheduleKeyDeletion: { kind: "write" },
  },
  OBSERVABILITY: {},
  FEATURE_FLAG: {
    getBooleanValue: read,
    getStringValue: read,
    getNumberValue: read,
    getObjectValue: read,
    snapshot: read,
  },
  IDENTITY: { getUser: read, verifyToken: read },
  AUTHZ: { check: read, checkBatch: read, planResources: read, explain: read },
  STORAGE: { get: read, list: read, presign: read, assertImmutable: read },
  QUEUE: {
    enqueue: {
      kind: "write",
      callArg: 2,
      payload: { arg: 1, schema: QueueJobData },
      idempotent: { keyArg: "call" },
    },
    stats: read,
  },
  WORKFLOW: { query: read, listOpen: read, describe: read },
  EMAIL: {
    send: {
      kind: "write",
      callArg: 1,
      payload: { arg: 0, schema: EmailMessage },
      idempotent: { keyArg: "call" },
    },
    getStatus: read,
  },
  SMS: {
    send: {
      kind: "write",
      callArg: 1,
      payload: { arg: 0, schema: SmsMessage },
      idempotent: { keyArg: "call" },
    },
    getStatus: read,
  },
  WHATSAPP: {
    sendTemplate: {
      kind: "write",
      callArg: 1,
      payload: { arg: 0, schema: WhatsappTemplateMessage },
      idempotent: { keyArg: "call" },
    },
    sendSession: {
      kind: "write",
      callArg: 1,
      payload: { arg: 0, schema: WhatsappSessionMessage },
      idempotent: { keyArg: "call" },
    },
    getTemplateStatus: read,
    getConversationCost: read,
  },
  PAYMENTS: {
    createOrder: {
      kind: "write",
      callArg: 2,
      payload: { arg: 0, schema: OrderSpec },
      idempotent: { keyArg: 1, money: true },
    },
    refund: {
      kind: "write",
      callArg: 2,
      payload: { arg: 0, schema: RefundSpec },
      idempotent: { keyArg: 1, money: true },
    },
    createMandate: { kind: "write", callArg: 2, idempotent: { keyArg: 1, money: true } },
    reconcile: read,
    lookup: read,
  },
  // Provisional until PL4 (`ai`) defines the LLM interface; lets @IPB-01-AT-06 run at the router.
  LLM: {
    complete: { kind: "write", callArg: 1 },
    stream: { kind: "write", callArg: 1 },
    listModels: read,
  },
};

/** Methods that are never routed: verification of inbound payloads and health stay on the adapter. */
export const LOCAL_METHODS = new Set(["health", "verifyWebhook", "descriptor"]);

export function methodSpec(port: string, method: string): MethodSpec {
  return PORT_METHODS[port]?.[method] ?? { kind: "write" };
}
