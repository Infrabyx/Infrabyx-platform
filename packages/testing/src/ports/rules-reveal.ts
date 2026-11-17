// RULES explain reveal contract (PR-LDC-59, #130, R1-D-157 (1), R1-D-173): by default `explain`
// returns names only above INTERNAL; an entitled reveal returns exactly one CONFIDENTIAL value, is
// ledgered without the value, and is refused for every caller and grant the owner's answer rules
// out. Run with `defineRulesRevealContract(name, setup)` against any `RulesPort` that implements
// `entitleReveal` (the PostgreSQL `RulesService` runs it in `@infrabyx/rules`).
import { describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { RevealEntitlement, RevealRequest, RulesPort } from "@infrabyx/contracts/ports";
import { agentContext, platformContext } from "../context.js";

/** What the contract needs: one recorded decision with clear, CONFIDENTIAL and REGULATED inputs. */
export interface RulesRevealFixture {
  rules: RulesPort & {
    entitleReveal(ctx: KernelContext, req: RevealRequest): Promise<RevealEntitlement>;
  };
  /** A user in the decision's tenant whom the product's reveal rule allows. */
  allowed: KernelContext;
  /** Another user in the same tenant whom the product's reveal rule refuses. */
  refused: KernelContext;
  /** A user of another tenant whom the product's reveal rule would allow. */
  otherTenant: KernelContext;
  /** A decision whose inputs are `clear` (INTERNAL), `confidential` and `regulated`. */
  decisionId: string;
  /** A second decision of the same tenant and rule set. */
  otherDecisionId: string;
  inputs: { clear: string; confidential: string; regulated: string };
  /**
   * The values the decision was evaluated with. The CONFIDENTIAL one must be distinctive (at least
   * five characters serialised, such as `73519`) so the ledger can be searched for it.
   */
  values: { clear: unknown; confidential: unknown; regulated: unknown };
  /** Every ledger entry the store wrote for the decision, serialised, to search for a value. */
  ledgerFor(decisionId: string): Promise<{ actions: string[]; text: string }>;
}

const PURPOSE = "board review of the classification";

const reason = (r: string) => ({ code: "IPB-RULE-004", meta: { reason: r } });

export function defineRulesRevealContract(
  name: string,
  setup: () => Promise<RulesRevealFixture>,
): void {
  describe(`RULES explain reveal contract (PR-LDC-59): ${name}`, () => {
    const req = (f: RulesRevealFixture, input?: string): RevealRequest => ({
      decisionId: f.decisionId,
      input: input ?? f.inputs.confidential,
      purpose: PURPOSE,
    });

    it("without a grant, explain returns names only above INTERNAL", async () => {
      const f = await setup();
      for (const ctx of [f.allowed, f.refused]) {
        const x = await f.rules.explain(ctx, f.decisionId);
        expect(x.inputs).toEqual([
          { name: f.inputs.clear, value: f.values.clear },
          { name: f.inputs.confidential },
          { name: f.inputs.regulated },
        ]);
      }
    });

    it("an entitled reveal returns exactly the one CONFIDENTIAL value; the ledger has no value", async () => {
      const f = await setup();
      expect(JSON.stringify(f.values.confidential).length).toBeGreaterThanOrEqual(5);
      const before = (await f.ledgerFor(f.decisionId)).actions.length;
      const grant = await f.rules.entitleReveal(f.allowed, req(f));
      expect(grant).toMatchObject({ decisionId: f.decisionId, input: f.inputs.confidential });
      expect(grant.id).toMatch(/^rvg_/);
      const x = await f.rules.explain(f.allowed, f.decisionId, { reveal: grant });
      expect(x.inputs).toEqual([
        { name: f.inputs.clear, value: f.values.clear },
        { name: f.inputs.confidential, value: f.values.confidential, revealed: true },
        { name: f.inputs.regulated },
      ]);
      const after = await f.ledgerFor(f.decisionId);
      expect(after.actions.slice(before)).toEqual(["rules.decision.input_revealed"]);
      expect(after.text).not.toContain(JSON.stringify(f.values.confidential));
      // The next explain is name-only again: nothing was written back unsealed.
      expect((await f.rules.explain(f.allowed, f.decisionId)).inputs[1]).toEqual({
        name: f.inputs.confidential,
      });
    });

    it("a REGULATED input, an INTERNAL input or an undeclared one is refused even when the rule allows", async () => {
      const f = await setup();
      await expect(
        f.rules.entitleReveal(f.allowed, req(f, f.inputs.regulated)),
      ).rejects.toMatchObject(reason("class_not_revealable"));
      await expect(f.rules.entitleReveal(f.allowed, req(f, f.inputs.clear))).rejects.toMatchObject(
        reason("class_not_revealable"),
      );
      await expect(f.rules.entitleReveal(f.allowed, req(f, "nope"))).rejects.toMatchObject(
        reason("unknown_input"),
      );
    });

    it("the product's rule saying no is a refusal", async () => {
      const f = await setup();
      await expect(f.rules.entitleReveal(f.refused, req(f))).rejects.toMatchObject(
        reason("rule_refused"),
      );
    });

    it("agents, platform contexts, break-glass and impersonation are refused before the rule runs", async () => {
      const f = await setup();
      const t = f.allowed.tenantId;
      const contexts: KernelContext[] = [
        agentContext(t),
        platformContext(),
        { ...f.allowed, breakGlassGrantId: "bgg_01JA0000000000000000000000" },
        { ...f.allowed, principal: { ...f.allowed.principal, type: "breakglass" } },
        { ...f.allowed, act: { sub: "usr_support", sessionId: "ses_1" } },
        { ...f.allowed, principal: { ...f.allowed.principal, roles: ["PLT_SUPPORT_L2"] } },
      ];
      for (const ctx of contexts)
        await expect(f.rules.entitleReveal(ctx, req(f))).rejects.toMatchObject(
          reason("context_not_allowed"),
        );
    });

    it("a decision of another tenant is not found", async () => {
      const f = await setup();
      await expect(f.rules.entitleReveal(f.otherTenant, req(f))).rejects.toMatchObject(
        reason("decision_not_found"),
      );
    });

    it("a grant works once, for its own decision and principal only; a look-alike is refused", async () => {
      const f = await setup();
      const once = await f.rules.entitleReveal(f.allowed, req(f));
      await f.rules.explain(f.allowed, f.decisionId, { reveal: once });
      await expect(
        f.rules.explain(f.allowed, f.decisionId, { reveal: once }),
      ).rejects.toMatchObject(reason("grant_used"));

      const forDecision = await f.rules.entitleReveal(f.allowed, req(f));
      await expect(
        f.rules.explain(f.allowed, f.otherDecisionId, { reveal: forDecision }),
      ).rejects.toMatchObject(reason("grant_mismatch"));

      const forPrincipal = await f.rules.entitleReveal(f.allowed, req(f));
      await expect(
        f.rules.explain(f.refused, f.decisionId, { reveal: forPrincipal }),
      ).rejects.toMatchObject(reason("grant_mismatch"));

      const real = await f.rules.entitleReveal(f.allowed, req(f));
      for (const fake of [
        { ...real },
        JSON.parse(JSON.stringify(real)) as RevealEntitlement,
        Object.freeze({ ...real }),
      ])
        await expect(
          f.rules.explain(f.allowed, f.decisionId, { reveal: fake }),
        ).rejects.toMatchObject(reason("grant_invalid"));
      // The look-alikes did not use up the real grant.
      const x = await f.rules.explain(f.allowed, f.decisionId, { reveal: real });
      expect(x.inputs[1]).toMatchObject({ revealed: true });
    });

    it("an empty, too long or control-character purpose is refused", async () => {
      const f = await setup();
      for (const purpose of ["", "  ", "x".repeat(201), "line\nbreak"])
        await expect(
          f.rules.entitleReveal(f.allowed, { ...req(f), purpose }),
        ).rejects.toMatchObject(reason("purpose_invalid"));
    });
  });
}
