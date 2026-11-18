# Runbook — the TallyPrime agent (`infrabyx-tally-agent`)

For the tenant's IT staff and the product's support team. The agent runs next to TallyPrime on the tenant's machine, dials out to the product's API, and posts journal batches into TallyPrime (PR-FBX-46; R1-D-137, R1-D-178). This runbook covers how the agent keeps its key and how the key is rotated (owner answer #136 (4); R1-D-184).

## 1. Install

- **Windows (the usual case):** run the agent as a Windows service under **its own dedicated account** (not `LocalSystem`, not a person's account). The agent keeps its private key under DPAPI for that account (`DataProtectionScope.CurrentUser`), so only that account on that machine can use it. The account's profile must load, which a service under its own account does. Leave `keyProtection` at `auto` in the configuration.
- **Linux or a container:** DPAPI does not exist there, so the key is kept in `<stateDir>/agent.json` with mode 0600. The enrolment record and the console show the warning `key_unencrypted`. Give the state directory to the agent's user alone.
- `powershellPath` overrides the path of Windows PowerShell 5.1 (default `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`) if Windows is installed elsewhere.

## 2. Enrol

1. A tenant admin asks for an agent in the product (maker-checker); a checker approves it.
2. An admin issues the one-time code (valid 30 minutes) and places it in `<stateDir>/enrol-code`.
3. The agent generates its key, tests DPAPI (protect, unprotect, compare), and enrols. It reports `keyProtection: dpapi`, or `file` with a warning in its log and on the platform's record.

Enrolling a new agent revokes the tenant's previous one.

## 3. Rotate the key every 90 days

- A key is valid **90 days** from its enrolment. From **day 80** the agent's record shows `rotationDue` and the console warns.
- From **day 90** the platform refuses the agent's requests (`agent key expired`), and postings wait (they expire after `int.accounting.tally.job_expiry_days`).
- To rotate, enrol a new agent (section 2) on the same machine, before day 90. The new enrolment revokes the old key.

## 4. Revoke at once if the machine is lost or compromised

If the machine that runs the agent is lost, stolen, or may be compromised, or its account's password or profile may be exposed:

1. **Revoke the agent at once** in the product (`TallyAgentService.revoke`, an ORG_ADMIN or ORG_OWNER, or the platform's security officer). A revoked agent is final: its proofs are refused from that moment.
2. Check the TallyPrime company for vouchers the platform did not post (the agent never alters or deletes; anything else came from elsewhere).
3. Enrol a new agent from a clean machine and a new service account.
4. Record the incident under the product's incident process (IPB-02 §02.4.8).

## 5. Troubleshooting

| Symptom in the agent's log                                    | What it means and what to do                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `DPAPI is not available for this account`                     | The service account's profile did not load, or PowerShell is missing or blocked. Fix the service account and enrol again. |
| `the agent's key is under DPAPI, which is not available here` | The state file was copied to another machine or account. Do not copy it: enrol a new agent on the new machine.            |
| `the platform answered HTTP 403` after day 90                 | The key expired. Enrol a new agent (section 3).                                                                           |
