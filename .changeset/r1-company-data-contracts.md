---
"@infrabyx/contracts": minor
---

The COMPANY_DATA port interface (IPB-01 §01.4.4.2): `CompanyDataPort` with `lookupCin`, `lookupLlpin`, `getDirectors` and `getCharges`; company master data, directors (DIN, designation, appointment and cessation dates) and charges (holder, amount in integer paise, open or satisfied, dates), each result labelled with the register date (`asOf`) and `stale`; `CIN`, `LLPIN` and `DIN` patterns and the INTERNAL lookup schemas. COMPANY_DATA is now `interfaceDefined` and listed in `R1_PORTS`. No adapter until the owner chooses a data source (PR-LDC-02, OWNER-QUESTIONS #102; R1-D-79).
