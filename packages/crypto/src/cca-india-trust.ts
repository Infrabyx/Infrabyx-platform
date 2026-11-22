// The pinned trust anchors of the PAdES/CMS verifier (C-28, owner answers #162 and #178;
// R1-D-246, R1-D-271, R1-D-272): the CCA India root certificates, as PEM with the SHA-256
// fingerprint of each DER, checked when `pades.ts` loads (`pinned()` refuses a mismatch). Changed
// only by a reviewed PR; never downloaded at run time.
//
// Source: the owner's upload of 21 Nov 2026 from the Controller of Certifying Authorities' "Root
// Certificate" page (cca.gov.in), kept unchanged under `docs/regulations/cca/` with its
// `SOURCES.md`. The two existing roots are pinned. Each PEM here is the canonical armour of its
// file's DER (64-character base64 lines, LF): CCAIndia2022SPL.cer is served with CRLF, a blank line
// before the footer and no final newline, so its base64 body was decoded to DER, the SHA-256
// checked, and the DER re-armoured; the files themselves are never altered. A test checks that each
// PEM is byte-identical DER to its file. The expired CCA India 2014 and CCA India 2015 SPL roots
// are kept for the record only and are NOT pinned. Out-of-band confirmation of the thumbprints from
// CCA (its Root CA FAQ) is the owner's to record later.
//
// Roots only (owner answer #178 (2), R1-D-271): the intermediates of CCA's licensed CAs are not
// pinned. The verifier accepts those carried in the signature's CMS certificate set when the whole
// path validates to a pinned root (`buildPath` in `pades.ts`). `CCA_INDIA_INTERMEDIATES` stays,
// empty, so one can be pinned later if ever needed.

export interface PinnedCertificate {
  /** A short label, e.g. "CCA India 2022" (no personal data). */
  label: string;
  /** Lowercase hex SHA-256 of the certificate's DER, as published. */
  sha256: string;
  pem: string;
}

export const CCA_INDIA_ROOTS: readonly PinnedCertificate[] = Object.freeze([
  {
    // CN=CCA India 2022, O=India PKI, C=IN; RSA 4096, self-signed; 2022-02-02 to 2042-02-02.
    label: "CCA India 2022",
    sha256: "9a3fd3176798e842ddcb12c262f11cfacca70a8b84c6ea6fda30842a95a94cd8",
    pem: `-----BEGIN CERTIFICATE-----
MIIFNDCCAxygAwIBAgIQdiQz69smdlqFYM0KqC/hFzANBgkqhkiG9w0BAQsFADA6
MQswCQYDVQQGEwJJTjESMBAGA1UEChMJSW5kaWEgUEtJMRcwFQYDVQQDEw5DQ0Eg
SW5kaWEgMjAyMjAeFw0yMjAyMDIxMjA0MzdaFw00MjAyMDIxMjA0MzdaMDoxCzAJ
BgNVBAYTAklOMRIwEAYDVQQKEwlJbmRpYSBQS0kxFzAVBgNVBAMTDkNDQSBJbmRp
YSAyMDIyMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAv3EBudWC8HY0
oSwtJZCqpjQTGpEewl3EdDqUORV0qoFp78mdR/vuATXI83G7nF9RLvmNjgQgKr/b
Mx6gPO4Y57bMjAsgwEzleFclZka/sqc68iN5rS3huhrCX6MEINLyDOQ71MRA7GJC
aNL6E3j1438eTu011mlikeZYBdkhvfpAVjCw90w8wcWDmqx66Y561T/RiXyz2uEh
BBZAD43gV58eXStOeOTwAzEZYMrmp232GfmQKabYRfdIRus1avyuGea2nICEsRHE
8M2tdzwpGP7oIy2qHBFJJ+3AwmwQA4DjmDkJtCD+58awohQavRNhqjsGD+ZifG3V
R4i6WrKv8OWqZzcZj3g3Elr5+fRMlz1GSqkWPBw1Ev8KWTHazSUKF7OMxm3XzyXx
Qnw7fZF9GOVtx3adpfRPqYGgtbOP34EVkz4wsHvNMrvUrYcKymdOrnkTjlX26fIH
UJpKGYkLk9q0jhMNKs4Rn8lj4pJ7YF33/ND4bjpV0ex1EAQz0iZvT37OnxNiuAZ/
+4Djf075UuNX2ecWnadOrN1r8NAParZIwUoSUnWhU8TqAWWRqzFURHUZuOMQcA0g
eg4c9zqtBoUPgtQksbIAEsEXmDuRpwSIFjEkK11f5Eemfmfdg37KyIjQ67TRTmBA
+kT9Q5JIm/e7m1ILg/HKckgLUOCnAMsCAwEAAaM2MDQwDwYDVR0TAQH/BAUwAwEB
/zARBgNVHQ4ECgQITjtINlziX30wDgYDVR0PAQH/BAQDAgEGMA0GCSqGSIb3DQEB
CwUAA4ICAQCdbE8d1c1DysKtrtYlApYIXTlY3N2XHNQ6gKoaVWsKa1TJ/ovrT+FV
3bmQLet3aSoEG6pTe/vLZSg8WiF7cn7WuF4XlQS3yA2Uu8/cg/S4owqhQJp6K/Xg
6UoSBad9Kog1H8deOfV8Nmb8a89zB4Yf8/AepId+Lr/3I6O7iub+PUT2QBXnksa+
cf0yf+49GhyMCILZvctNSQd4Vxr9EgRvBARTrAgNQ9sEOJ6myOz4iTFR7T2pIFP8
Cp15e8jEVI1q4IuHu3XlwJNk9f5k3gbwrzoy9P5rP8voQU3u9wh62JZa9U63b+u/
Ur1tsKb5Lx0YUedtHvpIiIRurEPxumW0twjrx8TrAcXRrViSL7dsXAoYC0dXo154
EE8jBAzgIIur7tJizxgXDEn4i2pu8Yd615YML9ii5BooEJ2j6fQ0nzyPRmx1Egw2
Fjlgzzceai4TUOcaCKab86yyu5MZIp+BiPR840nw5MggbRgYH2nFRBA70toVm4VF
lbZs3reGmaICm4ST6R395OxYS1iYBm5kXm9tLb4pkIhUxrkgyuiwE+DsWceBjHAY
aXnCgUGKtiG9tfBMUw3fChoPb9L1yKdNof3zXDdTloMqEpO4BFrmjco8kt1v0LUQ
PhNZmQP4nqd4Hqx2384nPmWDXbQ+eePyxRteYGY0hJeDLVpyeYG8VQ==
-----END CERTIFICATE-----
`,
  },
  {
    // CN=CCA India 2022 SPL, O=India PKI, C=IN; RSA 4096, self-signed; 2022-09-20 to 2042-09-20.
    label: "CCA India 2022 SPL",
    sha256: "b724689b79b2ef9421ef8f5cc733eb093851b170ee715177005a09f226d8c91a",
    pem: `-----BEGIN CERTIFICATE-----
MIIFPDCCAySgAwIBAgIQYoKBxu6+xz94CH5f9Y9J9DANBgkqhkiG9w0BAQsFADA+
MQswCQYDVQQGEwJJTjESMBAGA1UEChMJSW5kaWEgUEtJMRswGQYDVQQDExJDQ0Eg
SW5kaWEgMjAyMiBTUEwwHhcNMjIwOTIwMDkxODE5WhcNNDIwOTIwMDkxODE5WjA+
MQswCQYDVQQGEwJJTjESMBAGA1UEChMJSW5kaWEgUEtJMRswGQYDVQQDExJDQ0Eg
SW5kaWEgMjAyMiBTUEwwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQDM
A++VJxEXN+coznBAEf0dz+8DBj9SpEQGoehjxoDnD+WYEBAXnap2lh5yE7/wlpHU
Q7hJ54JsqLBZQGkM0pk35bkvvcf2wAGSdK0KRilNeFDmVdduqAUJUlmNeL0ufIuf
sSBEusOWKK6VvQHxiZ0qoyoeqV+CpnDm8I2IE0WBSbaotXtGWSyBLNDCEH3lRA9G
QDOZ5Utc8soR2YVwbQSicGoyAC1PiPah7LY6nZCbBjc63r22dE+Cm1TGeqEb0ZUd
hHl051WqEGXXmtQNfytdNP+VdKU1nrYEcQ5BeGMaWA5bHkO2ERldI5F55pX06hUx
wjL39H6JVX5/0I+bBiPsZiCpea2gKozNBg+MBWLqyBUzFRVhLfdCPB6tm9EKHgrl
P6rsWrjgZ5FcREmerCYs7HIYeemiI0UO4X8rqpobT3rL7mWALB2plyFaBdiUWW1r
87eZQDEeYWavOhNITYNc31FG3Kn8DANF3IhNeYmUDzG7/M1XyGycqBmXG7tVVXez
O1GbgfM0SYlkVFRDOD6u9Tf0lR1MfjrJpMB+JdIJlimMM5G6LGia7+3Nlll8SJ0D
hW49FdKlLB92iXuOok4iwPzyFKg8Eax/9iN9TxMadYxbpKkePL9DpL/ymRvpGDkP
aurqUP77smtB8Jlf7bx8SB9DWVjVqsgvemN+DZfNawIDAQABozYwNDAPBgNVHRMB
Af8EBTADAQH/MBEGA1UdDgQKBAhIEoydvDOh6jAOBgNVHQ8BAf8EBAMCAQYwDQYJ
KoZIhvcNAQELBQADggIBADYv91JbnwU+Ih5gNzZSJY0yJkYk4tbBBsCZDivmZknC
TbM8B9j/hEZcfXZCTbP6GCGkrxVx8aDl7E1s5DGmdO7x5R+dxrLD2B4+ORhDetlM
Yd22mopVnzqY5UdaQ8u16JNEp/m75UqT5NvcgtE+/s1Hr+3lhWKKvN7u9PxDSIoM
T/I0/sje9fWwjeX29nzqHTw7hYTLCIeQv8c9+wGBFAAFArUq0MaI6jxIav10DKeH
ptycUHwMNyzP9hh7G4nHo+lEIT0/jWIrjv53+aVFLdAvBKQ2jyAKd/OhuQFCue3z
MVMoTQ7Zl9HZk72CkBecaZhHnEzqjpOzueCweK0h27IvwED7scudpOPnY7ml6fEF
dpHXZXcVz8TZbqirkHTLepfAOUBcyuadAKkOR+m5uU1UKkESexaY2yVEdWcVAeCM
6p6FXlFeRMEebMbppkPeSFUPMRA9mhsUTOk5sbnGN2TVkSfUpcUMoQgz2bSqvGyR
7sAZ9Un457swjwEEEnzijdMvd9YDj1wRq+tsq38zq5IaE50VMMXeBoVz2/2Bn8Mr
p8kN7XIkrCui8wjclnG9BB1SbwjXPhE+7zE6GKh+oIRZua2RkamTpjwe+2oSihGV
FeD7pSMh/Pgyxg1lxSVDKvbBdxNrBpot2OQN35+DkAU2exJMtUYAvzdPVx9d2elo
-----END CERTIFICATE-----
`,
  },
]);

export const CCA_INDIA_INTERMEDIATES: readonly PinnedCertificate[] = Object.freeze([]);
