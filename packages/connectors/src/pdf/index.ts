// PDF adapters (IPB-01 PDF; PR-LDC-39, R1-D-160): `pdf-text` (text per page from an AV-clean upload,
// parsed in a worker thread under limits; no dependency). The file-operation adapters (pdf-lib,
// pdfcpu, Gotenberg) follow when a product needs them.
export * from "./text.js";
