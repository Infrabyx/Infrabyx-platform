// Port catalogue as metadata (IPB-01 §01.4.4.2, §01.4.4.3). Interfaces for the thirteen PL2 ports and
// the four PL3 ports (RULES, NOTIFY, PUSH, ESIGN) and the five PL4 AI ports (LLM, EMBEDDING, IMAGE_GEN,
// SPEECH, RERANK, in `ai.ts`), the twelve PL5 website ports (`web.ts`) and MEDIA (`media.ts`, #53) are in this folder; the rest land with the phase
// that builds their adapters (PL1-D-02, PL2 plan §1, PL3 plan §10).

export type PortTier = 0 | 1 | 2 | 3;

export interface PortInfo {
  /** Exit-RTO tier (IPB-01 §01.4.13). */
  tier: PortTier;
  /** Settings prefix for routing and behaviour keys. */
  configPrefix: string;
  ownerFile: string;
  /** True when the interface is defined in @infrabyx/contracts already. */
  interfaceDefined: boolean;
}

export const PORT_CATALOGUE = {
  IDENTITY: { tier: 0, configPrefix: "int.identity.", ownerFile: "IPB-01", interfaceDefined: true },
  AUTHZ: { tier: 0, configPrefix: "int.authz.", ownerFile: "IPB-01", interfaceDefined: true },
  STORAGE: { tier: 1, configPrefix: "int.storage.", ownerFile: "IPB-01", interfaceDefined: true },
  QUEUE: { tier: 1, configPrefix: "int.queue.", ownerFile: "IPB-01", interfaceDefined: true },
  WORKFLOW: {
    tier: 1,
    configPrefix: "int.workflow.",
    ownerFile: "IPB-01",
    interfaceDefined: true,
  },
  CACHE: { tier: 3, configPrefix: "int.cache.", ownerFile: "IPB-01", interfaceDefined: false },
  SEARCH: { tier: 2, configPrefix: "int.search.", ownerFile: "IPB-01", interfaceDefined: false },
  VECTOR: { tier: 2, configPrefix: "int.vector.", ownerFile: "IPB-01", interfaceDefined: false },
  SECRETS: { tier: 1, configPrefix: "int.secrets.", ownerFile: "IPB-01", interfaceDefined: true },
  KMS: { tier: 0, configPrefix: "int.kms.", ownerFile: "IPB-01", interfaceDefined: true },
  EMAIL: { tier: 2, configPrefix: "int.email.", ownerFile: "IPB-01", interfaceDefined: true },
  SMS: { tier: 2, configPrefix: "int.sms.", ownerFile: "IPB-01", interfaceDefined: true },
  WHATSAPP: {
    tier: 2,
    configPrefix: "int.whatsapp.",
    ownerFile: "IPB-01",
    interfaceDefined: true,
  },
  PUSH: { tier: 2, configPrefix: "int.push.", ownerFile: "IPB-01", interfaceDefined: true },
  VOICE: { tier: 2, configPrefix: "int.voice.", ownerFile: "IPB-01", interfaceDefined: false },
  PAYMENTS: {
    tier: 1,
    configPrefix: "int.payments.",
    ownerFile: "IPB-01",
    interfaceDefined: true,
  },
  PAYOUTS: { tier: 1, configPrefix: "int.payouts.", ownerFile: "IPB-01", interfaceDefined: false },
  ESIGN: { tier: 2, configPrefix: "int.esign.", ownerFile: "IPB-01", interfaceDefined: true },
  ESTAMP: { tier: 2, configPrefix: "int.estamp.", ownerFile: "IPB-01", interfaceDefined: false },
  KYC: { tier: 2, configPrefix: "int.kyc.", ownerFile: "IPB-01", interfaceDefined: false },
  COMPANY_DATA: {
    tier: 3,
    configPrefix: "int.company_data.",
    ownerFile: "IPB-01",
    interfaceDefined: false,
  },
  LLM: { tier: 2, configPrefix: "ai.llm.", ownerFile: "IPB-01, IPB-03", interfaceDefined: true },
  EMBEDDING: {
    tier: 2,
    configPrefix: "ai.embedding.",
    ownerFile: "IPB-01, IPB-03",
    interfaceDefined: true,
  },
  IMAGE_GEN: {
    tier: 2,
    configPrefix: "ai.image_gen.",
    ownerFile: "IPB-01, IPB-03",
    interfaceDefined: true,
  },
  SPEECH: {
    tier: 2,
    configPrefix: "ai.speech.",
    ownerFile: "IPB-01, IPB-03",
    interfaceDefined: true,
  },
  TRANSLATE: {
    tier: 2,
    configPrefix: "ai.translate.",
    ownerFile: "IPB-01",
    interfaceDefined: false,
  },
  OCR: { tier: 2, configPrefix: "ai.ocr.", ownerFile: "IPB-01", interfaceDefined: false },
  DOCGEN: { tier: 2, configPrefix: "int.docgen.", ownerFile: "IPB-01", interfaceDefined: false },
  PDF: { tier: 2, configPrefix: "int.pdf.", ownerFile: "IPB-01", interfaceDefined: false },
  VIDEO_MEET: {
    tier: 2,
    configPrefix: "int.video_meet.",
    ownerFile: "IPB-01",
    interfaceDefined: false,
  },
  CALENDAR: {
    tier: 3,
    configPrefix: "int.calendar.",
    ownerFile: "IPB-01",
    interfaceDefined: false,
  },
  WORKSPACE: {
    tier: 3,
    configPrefix: "int.workspace.",
    ownerFile: "IPB-01",
    interfaceDefined: false,
  },
  ANALYTICS: {
    tier: 3,
    configPrefix: "mkt.analytics.",
    ownerFile: "IPB-01",
    interfaceDefined: true,
  },
  TAG_MANAGER: {
    tier: 3,
    configPrefix: "mkt.tag_manager.",
    ownerFile: "IPB-01",
    interfaceDefined: true,
  },
  FEATURE_FLAG: {
    tier: 3,
    configPrefix: "eng.flags.",
    ownerFile: "IPB-01",
    interfaceDefined: true,
  },
  OBSERVABILITY: {
    tier: 2,
    configPrefix: "eng.otel.",
    ownerFile: "IPB-01",
    interfaceDefined: true,
  },
  ERROR_TRACKING: {
    tier: 3,
    configPrefix: "eng.errors.",
    ownerFile: "IPB-01",
    interfaceDefined: false,
  },
  DNS_CDN: { tier: 1, configPrefix: "int.dns_cdn.", ownerFile: "IPB-01", interfaceDefined: false },
  GEO_MAPS: { tier: 3, configPrefix: "int.geo.", ownerFile: "IPB-01", interfaceDefined: false },
  RULES: { tier: 2, configPrefix: "rules.", ownerFile: "IPB-01", interfaceDefined: true },
  BILLING: { tier: 1, configPrefix: "int.billing.", ownerFile: "IPB-01", interfaceDefined: true },
  CRM: { tier: 2, configPrefix: "int.crm.", ownerFile: "IPB-01", interfaceDefined: true },
  // Supplementary ports (IPB-01 §01.4.4.3)
  RERANK: { tier: 2, configPrefix: "ai.rerank.", ownerFile: "IPB-03", interfaceDefined: true },
  INTERPRETER: {
    tier: 3,
    configPrefix: "int.interpreter.",
    ownerFile: "IPB-06",
    interfaceDefined: false,
  },
  NOTIFY: { tier: 2, configPrefix: "int.notify.", ownerFile: "IPB-07", interfaceDefined: true },
  TRUST: { tier: 2, configPrefix: "int.trust.", ownerFile: "IPB-08", interfaceDefined: true },
  SUPPORT: { tier: 3, configPrefix: "int.support.", ownerFile: "IPB-04", interfaceDefined: true },
  BACKLOG: { tier: 3, configPrefix: "int.backlog.", ownerFile: "IPB-04", interfaceDefined: true },
  CONSENT: {
    tier: 1,
    configPrefix: "int.consent.",
    ownerFile: "IPB-04, IPB-05",
    interfaceDefined: true,
  },
  MEDIA: { tier: 2, configPrefix: "int.media.", ownerFile: "IPB-04", interfaceDefined: true },
  AV: { tier: 2, configPrefix: "int.av.", ownerFile: "IPB-02, IPB-04", interfaceDefined: false },
  PLAGIARISM: {
    tier: 3,
    configPrefix: "int.plagiarism.",
    ownerFile: "IPB-04",
    interfaceDefined: false,
  },
  EGRESS: {
    tier: 1,
    configPrefix: "int.egress.",
    ownerFile: "IPB-02, IPB-04",
    interfaceDefined: true,
  },
  LAW_REGISTER: {
    tier: 3,
    configPrefix: "int.law_register.",
    ownerFile: "IPB-05, IPB-07",
    interfaceDefined: true,
  },
  HR: { tier: 3, configPrefix: "int.hr.", ownerFile: "IPB-04", interfaceDefined: true },
  /** OH14 claims gate (Ecosystem §6.29); the local Claims Register answers until it exists. */
  CLAIMS: {
    tier: 3,
    configPrefix: "int.claims.",
    ownerFile: "IPB-04, IPB-08",
    interfaceDefined: true,
  },
  SOCIAL_PUBLISHER: {
    tier: 3,
    configPrefix: "int.social.",
    ownerFile: "OH v1.1",
    interfaceDefined: false,
  },
  ADS: { tier: 3, configPrefix: "int.ads.", ownerFile: "OH v1.1", interfaceDefined: false },
  CRM_MARKETING: {
    tier: 3,
    configPrefix: "int.crm_marketing.",
    ownerFile: "OH v1.1",
    interfaceDefined: false,
  },
  ACCOUNTING: {
    tier: 2,
    configPrefix: "int.accounting.",
    ownerFile: "OH v1.1",
    interfaceDefined: false,
  },
  PAYROLL: { tier: 2, configPrefix: "int.payroll.", ownerFile: "OH v1.1", interfaceDefined: false },
} as const satisfies Record<string, PortInfo>;

export type PortName = keyof typeof PORT_CATALOGUE;
export const PORT_NAMES = Object.keys(PORT_CATALOGUE) as [PortName, ...PortName[]];
