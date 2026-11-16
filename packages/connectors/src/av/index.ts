// AV adapters (IPB-01 AV; IPB-02-44; PR-LDC-41, R1-D-117): `clamav` (clamd in the cluster, the
// reference), off behind `int.av.clamav.enabled`. The IPB-01 alternatives (hash-only lookups, a
// cloud-native scanner) need an external account and stay unproven until the owner chooses one.
export * from "./clamav.js";
