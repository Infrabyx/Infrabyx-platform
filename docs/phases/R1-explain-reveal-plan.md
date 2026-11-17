# R1 plan: an entitled reveal of CONFIDENTIAL inputs in `explain` (PR-LDC-59, #130, wave 15)

Status: drafted 17 Nov 2026 (sixteenth session); to build in wave 15 after the PR-LDC-60 Terraform inputs. Decision of record: R1-D-157 (1), the owner's narrow yes to OWNER-QUESTIONS #130 (M109).

## 1. What the owner allowed (R1-D-157 (1)), and nothing more

- `RulesService.explain` may return a **CONFIDENTIAL** input value. It never returns a REGULATED or SECRET one.
- It does so only when the caller passes an **explicit entitlement** that the product's own access rule granted **for that decision and that input**. The platform checks that the entitlement names the decision id and the input, and that the product's registered rule issued it. Anything wider is refused.
- Every reveal is **ledgered in the same transaction**: who, which decision, which input and the purpose, never the value.
- The value is returned **to the caller only** and is never written back unsealed.
- The **default stays name-only**.
- A **contract test** proves that an unentitled caller still gets names only.
- Never for an **agent** or a **platform context**.

## 2. Interface (`@infrabyx/rules` minor, `@infrabyx/contracts` minor for the types and error codes)

```ts
// RulesServiceOptions
revealRule?: {
  /** Stable id of the product's access rule, recorded in each grant and ledger entry. */
  id: string; // ^[a-z][a-z0-9_.-]{2,63}$
  /** The product's own check: may this principal see this input of this decision, for this purpose? */
  allows(ctx: KernelContext, req: RevealRequest): Promise<boolean>;
};

interface RevealRequest { decisionId: string; input: string; purpose: string } // purpose 3..200 chars

/** Step 1: ask the product's rule for a grant. Returns an opaque, single-use entitlement or refuses. */
entitleReveal(ctx: KernelContext, req: RevealRequest): Promise<RevealEntitlement>;

/** Step 2: explain with the grant; everything else about explain is unchanged. */
explain(ctx: KernelContext, decisionId: string, opts?: { reveal?: RevealEntitlement }): Promise<Explanation>;
```

- **Unforgeable without new cryptography.** A `RevealEntitlement` is a frozen object that the service records in a private `WeakMap` when it issues it. The record holds the rule id, the tenant, the principal id, the decision id, the input, the purpose and an expiry 60 seconds after issue. `explain` accepts only an object found in that map. The entry is deleted on first use, so a grant works once. A grant that was serialised, copied, built by hand, issued by another `RulesService` instance, used by another principal or tenant, or used after it expired, is refused. No token, signature or key is involved, so this adds nothing to the approved cryptography list. Grants are in-process only: a product that explains on another instance asks that instance for the grant.
- **`entitleReveal` refuses**, before it calls the product's rule, when:
  - no `revealRule` is registered;
  - the context is an agent (`principal.type` `agent`), a platform context (`scope: "platform"`), a break-glass session (`principal.type` `breakglass` or a `breakGlassGrantId`) or an impersonation (an `act` claim); `user`, `service` and `external` principals go on to the product's rule;
  - the decision is not in the caller's tenant (it is read under RLS, so it is simply not found);
  - the input is not one of the decision's rule-set version inputs;
  - the input's data class is not `CONFIDENTIAL`;
  - the decision's inputs were not recorded (`input_invalid`);
  - the purpose is empty or too long.

  It then calls `allows`, and a `false` or a throw is a refusal. Each refusal is `IPB-RULE-004` ("reveal refused"), with `meta.reason` naming one of the cases above and never a value.

- **`explain` with `reveal`:**
  1. It runs in `kernel.mutate`, not `read`, because it writes the ledger.
  2. It checks the grant against the record (same principal, tenant, decision and input; not expired; not used).
  3. It unseals `inputs_enc` with `FieldCrypto` (the existing decrypt path) and takes the one named input.
  4. It writes the audit entry `rules.decision.input_revealed`, with the decision id, input, purpose, rule id and grant id, without the value.
  5. It returns the explanation, with `value` and `revealed: true` set on that input only.

  If the ledger write fails, nothing is returned. Every other sealed input stays name-only.

- **What is written back:** nothing. The audit entry holds no value, the decision log is not updated, and no outbox event is sent.

## 3. Data model and migrations

No table changes. The ledger entry uses the existing audit ledger (`audit.ledger`, through `AuditSink`). The action `rules.decision.input_revealed` is registered in the rules module's action list, classed R1 (a read of the actor's own tenant data, ledgered).

## 4. Tests (by ID)

- `@IPB-07-AT-…` (explain, IPB-07-16) and `@IPB-02-AT-…` (data classes):
  - (a) with no entitlement, `explain` returns names only for CONFIDENTIAL, REGULATED and SECRET inputs (the contract case in `@infrabyx/testing`, run against the in-memory and PostgreSQL rules services);
  - (b) an entitled reveal returns exactly the one CONFIDENTIAL value, and the ledger entry carries no value;
  - (c) a REGULATED or SECRET input is refused at `entitleReveal`, even when the product's rule says yes;
  - (d) a grant for another decision, another input, another principal or another tenant is refused, and so are an expired or reused grant and a forged look-alike object;
  - (e) agent, platform, break-glass and impersonation contexts are refused;
  - (f) a ledger failure returns nothing;
  - (g) `allows` returning `false`, or throwing, is a refusal.
- Integration (PostgreSQL 18): (b) and (d) through the real decision log and `FieldCrypto` envelope.

## 5. Threat model

A new §3.130 covers:

- **I:** a value shown to the wrong person. Mitigations: product rule, single-use grant bound to the principal, CONFIDENTIAL only.
- **E:** an agent or a platform user reading tenant inputs. Mitigation: refused before the rule runs.
- **R:** every reveal is ledgered.
- **T:** forging or replaying a grant. Mitigation: an in-process WeakMap, single use, 60-second expiry.
- **Residual:** the product's `allows` is the product's own policy, and the platform cannot judge whether that policy is right.

## 6. Exit gate

- [ ] §4 tests pass locally (`pnpm check:full`) and at the wave 15 gate.
- [ ] Product guide section on `entitleReveal` and the purpose text; LawDocsComply adoption note.
- [ ] Threat model §3.130, DECISIONS entry, STATUS.
- [ ] Changesets: `rules` minor, `contracts` minor (types, `IPB-RULE-004`), `testing` minor (contract case).

## 7. Owner decisions needed

None to build. The owner's answer to #130 sets every limit above. Two small choices sit inside it, both the stricter option and both reversible, and both will be logged as assumptions:

- the 60-second grant lifetime;
- single use.
