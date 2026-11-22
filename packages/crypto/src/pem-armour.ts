// PEM armour for test certificates (internal; not in the package's exports). Lines of 64 base64
// characters and no blank line before the END line, whatever the DER length (RFC 7468 §2): a
// strict reader (OpenSSL) refuses a blank line there.
export const pemCertificate = (der: Uint8Array): string =>
  `-----BEGIN CERTIFICATE-----\n${(
    Buffer.from(der)
      .toString("base64")
      .match(/.{1,64}/g) ?? []
  ).join("\n")}\n-----END CERTIFICATE-----\n`;
