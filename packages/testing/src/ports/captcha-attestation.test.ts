// The fakes pass their own contract cases (Udofin PR-UDF-028 and PR-UDF-029; R1-D-50).
import { defineContractSuite } from "../contract.js";
import { captchaContractCases, FakeCaptcha } from "./captcha.js";
import { deviceAttestationContractCases, FakeDeviceAttestation } from "./device-attestation.js";

const captcha = new FakeCaptcha();
defineContractSuite("CAPTCHA", () => captcha, captchaContractCases(captcha));
const attestation = new FakeDeviceAttestation();
defineContractSuite(
  "DEVICE_ATTESTATION",
  () => attestation,
  deviceAttestationContractCases(attestation),
);
