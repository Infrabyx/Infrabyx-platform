---
"@infrabyx/connectors": patch
---

Telemetry scrubber (PR-UDF-007, IPB-02-23): masks a bank account number under `account_number` and the other usual spellings of the IPB-02 masked fields (`accountNumber`, `bank_account_no`, `aadhaar_number`, `pan_no`, `card_number`, `phone`, `mobile_number`, `email_address`, `passport_number`, and keys ending in one of them such as `borrower_pan`); redacts one-time codes and card security codes under any key that contains `otp`, `totp`, `mpin`, `cvv`, `cvc` or `passcode`; and in free text redacts a code written next to its label (`otp=123456`, "OTP is 123456", "123456 is your OTP", `"otp":"123456"`), masks account numbers of 9 to 18 digits named as one ("A/c no. 1234 5678 901") and any other run of 9 to 11 digits, mobile numbers written as `98765 43210`, and passport numbers.
