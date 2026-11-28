// DOCGEN adapters (IPB-01 DOCGEN; R1-D-52 interfaces; OWNER-QUESTIONS #120, R1-D-100): `gotenberg`
// (in-cluster HTML to PDF and PDF/A, the reference for vernacular PDFs, and `.docx` to PDF through
// its LibreOffice route), off behind `int.docgen.gotenberg.enabled`; and `docxtemplater` (a
// product's tagged `.docx` templates filled in-process, `{field}` and loops only; R1-D-314).
export * from "./gotenberg.js";
export * from "./docxtemplater.js";
