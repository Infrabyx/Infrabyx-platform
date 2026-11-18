// Fakes and fixtures for the PL5 website ports (PL5 plan §8): CONSENT, CRM, HR, SUPPORT, BACKLOG,
// TRUST, BILLING (catalogue), TAG_MANAGER, ANALYTICS, EGRESS, CLAIMS, LAW_REGISTER and MEDIA. Every fake
// records what it received so tests can assert minimisation; none calls a network. The fixture
// catalogue carries no real price (the repository is public) and the fixture trust feed no real
// certificate: only a sub-processor list and an accessibility statement.
export {
  type FakePurposeConsent,
  FakeConsentLedger,
  FakeCrm,
  FakeHr,
  FakeOhDesk,
  fixtureTrustDocuments,
  FakeTrustFeed,
  fixtureCatalogue,
  FakeCatalogue,
  NoneTagManager,
  NoneAnalytics,
  FakeMedia,
  FakeEgress,
  FakeClaimsGate,
  FakeLawRegister,
} from "@infrabyx/fakes";
