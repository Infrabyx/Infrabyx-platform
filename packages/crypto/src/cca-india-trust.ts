// The pinned trust anchors of the PAdES/CMS verifier (C-28, owner answer #162, R1-D-246): the
// CCA India root certificate(s) and the intermediates CCA publishes for its licensed CAs, as PEM
// with their SHA-256 fingerprints (of the DER), checked when `pades.ts` loads. Changed only by a
// reviewed PR; never downloaded at run time; no trust is taken from a PDF beyond its chain.
//
// EMPTY ON PURPOSE (owner question #178): CCA's repository (cca.gov.in) is not reachable from the
// build environment, and no certificate is pinned from a second-hand copy. With no pin, every
// chain is `chain_untrusted`, so nothing verifies as trusted until the owner supplies the
// certificates from CCA's published repository and a PR adds them here.

export interface PinnedCertificate {
  /** A short label, e.g. "CCA India 2022" (no personal data). */
  label: string;
  /** Lowercase hex SHA-256 of the certificate's DER, as published. */
  sha256: string;
  pem: string;
}

export const CCA_INDIA_ROOTS: readonly PinnedCertificate[] = Object.freeze([]);

export const CCA_INDIA_INTERMEDIATES: readonly PinnedCertificate[] = Object.freeze([]);
