// Regulated messages (Ecosystem Spec v1.2 §3.6): events that carry RFC 9421 in transit and a
// detached JWS over the CloudEvent, stored with it (`signRegulatedMessage` in @infrabyx/crypto,
// G5, R1-D-08). The names are the Spec's, in its order: v1.0, then v1.1, then v1.2.
import { ECOSYSTEM_TYPE_REGEX } from "./envelope.js";

export const REGULATED_MESSAGE_EVENTS = Object.freeze([
  "DecisionMade",
  "KFSIssued",
  "SanctionLetterIssued",
  "ESignCompleted",
  "EStampCompleted",
  "LoanDisbursed",
  "CollateralPledgeCreated",
  "MarginCallRaised",
  "CollateralInvoked",
  "CollateralReleased",
  "ClassificationSynced",
  "SettlementApproved",
  "SettlementOfferIssued",
  "LegalNoticeIssued",
  "ADRReferralCreated",
  "ADRConsentRecorded",
  "ADROutcomeRecorded",
  "OrderRecorded",
  "RecoveryReceiptPosted",
  // v1.1
  "ReturnApproved",
  "ReturnFiled",
  "BureauFileSubmitted",
  "FinancialStatementsApproved",
  "InterestCertificateIssued",
  "CapitalRatioComputed",
  "LimitBreached",
  "ExternalAccessGranted",
  "ExternalAccessRevoked",
  "ResolutionPassed",
  "ShareCapitalPosted",
  "GroupCollectionPosted",
  "AssetAcquired",
  "SecurityReceiptIssued",
  "ServicerRemittanceMade",
  "ExportCompleted",
  "EntitlementChanged",
  "InvoiceIssued",
  "SubscriptionPaymentReceived",
  "LenderDealApproved",
  "LenderDealActivated",
  "LenderDealSuspended",
  "LenderDealTerminated",
  "TenantProvisioned",
  "PolicyIssued",
  // v1.2
  "AgreementExecuted",
  "CourtOrderRecorded",
  "SigningRequestCompleted",
  "StampInstrumentVerified",
  "SystemOfRecordSwitched",
  "TenantRegistered",
  "MarketplacePayoutSettled",
  "MarketplaceTransferInstructed",
  "ServiceCreditIssued",
  "WhiteLabelTenantProvisioned",
  "WhiteLabelTenantExited",
] as const);
export type RegulatedMessageEvent = (typeof REGULATED_MESSAGE_EVENTS)[number];

const NAMES: ReadonlySet<string> = new Set(REGULATED_MESSAGE_EVENTS);

/** True when an Ecosystem `type` (`in.infrabyx.<domain>.<Event>.v<n>`) names a regulated message. */
export function isRegulatedMessage(type: string): boolean {
  if (!ECOSYSTEM_TYPE_REGEX.test(type)) return false;
  return NAMES.has(type.split(".")[3] as string);
}
