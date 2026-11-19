// Pennyless bank account checks shared by the Digio and IDfy stubs (PR-UDF-043), from the shapes the
// adapters document as [VERIFY]. Test accounts only: each number has a leading 0, so none reads as
// an Aadhaar number (first digit 2 to 9) and the contract's no-Aadhaar sweep stays meaningful. The
// stub counts the checks it answers, so a contract case can show a retry made no second check; it
// answers pennyless checks only and refuses a penny drop (the platform's adapters never ask one).

export interface BankAccountStubFixtures {
  ifsc: string;
  /** An open account whose holder is `name`. */
  accountNumber: string;
  name: string;
  /** An account the bank does not know. */
  unknownAccountNumber: string;
  /** A closed account. */
  closedAccountNumber: string;
}

export interface BankAccountStubState {
  fixtures: BankAccountStubFixtures;
  /** The checks answered so far (a refused penny drop is not one). */
  checks(): number;
  check(
    ifsc: string,
    accountNumber: string,
  ): { status: "valid" | "closed" | "not_found"; nameAtBank?: string };
}

export function bankAccountStub(): BankAccountStubState {
  const fixtures: BankAccountStubFixtures = {
    ifsc: "SBIN0000691",
    accountNumber: "00112233445",
    name: "Asha Rao",
    unknownAccountNumber: "00999888777",
    closedAccountNumber: "00555444333",
  };
  let n = 0;
  return {
    fixtures,
    checks: () => n,
    check(ifsc, accountNumber) {
      n++;
      if (ifsc === fixtures.ifsc && accountNumber === fixtures.accountNumber)
        return { status: "valid", nameAtBank: fixtures.name.toUpperCase() };
      if (ifsc === fixtures.ifsc && accountNumber === fixtures.closedAccountNumber)
        return { status: "closed", nameAtBank: fixtures.name.toUpperCase() };
      return { status: "not_found" };
    },
  };
}
