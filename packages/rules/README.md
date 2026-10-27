# @infrabyx/rules

The RULES_PORT service: rule sets as versioned decision tables, published through maker-checker, evaluated with a decision log, simulated and explained.

**Specified by:** `docs/ipb/` — IPB-01 (RULES), IPB-07-16 ("Why this?"), IPB-02 §02.4.2 (maker-checker). Plan: `docs/phases/PL3-plan.md` §4; as built: PL3-D-18.

## Use

```ts
import { RulesService } from "@infrabyx/rules";

const rules = new RulesService({
  kernel,
  audit,
  approvals,
  product: "FBX",
  outbox,
  fieldCrypto,
  humanQueue,
  engine: settings.get("rules.engine"),
  celMaxCost: settings.get("rules.cel.max_cost"),
  evalTimeoutMs: settings.get("rules.eval.timeout_ms"),
});

const { ruleSetId } = await rules.createRuleSet(ctx, {
  key: "fbx.los.nba",
  ownerModule: "los",
  dataClass: "CONFIDENTIAL",
});
const { version } = await rules.saveDraft(ctx, ruleSetId, body); // ipb.decision_table.v1
await rules.publish(ctx, ruleSetId, version); // R4 request rules.ruleset.publish
const decision = await rules.evaluate(ctx, { ruleSetId }, input);
const why = await rules.explain(ctx, decision.id);
```

- **Tables** are `ipb.decision_table.v1` (`@infrabyx/contracts/ports`): typed inputs and outputs, `first` or `collect`, and rows `{ id, when, then, help_key?, citation?, verify? }`. `when` is CEL within the platform subset (see `@infrabyx/connectors/rules`); a draft that any engine cannot compile, or whose inputs exceed the set's data class, is `IPB-RULE-001`.
- **Versions** move `draft → pending_approval → published → retired`; the body is immutable once it leaves `draft`. `publish` creates an R4 approval request (1 h minimum delay; the checker is never the maker; agents never make or check it). When the request executes, the version is published, the previous one retired and `in.<product>.rules.RuleSetPublished.v1` emitted. `reopen` returns a rejected, cancelled or expired submission to draft. Editing a pending version is `IPB-RULE-003`.
- **Evaluation** uses the version effective now (or a pinned published or retired one; none is `IPB-RULE-002`). An invalid input, an engine error or timeout, or a matched `verify` row driving a `statutory` output is `UNDETERMINED`, never allow, and raises a Work Inbox task through `HumanQueue`. Every decision writes a `dcs_` row in `rules.decision_log` and a ledger entry; inputs above INTERNAL are sealed with FieldCrypto.
- **Platform rule sets** live in `tnt_platform`: created and published in a platform context, readable and evaluated by every tenant.
- **`simulate`** runs up to 1 000 inputs on a version and on the published one and reports the changes; inputs are not stored. **`explain`** returns the matched rows, their conditions, the help keys and the input names (values only for PUBLIC and INTERNAL inputs), with `source: "rules"`.

## Migration

`migrations/0001_init.sql` (schema `rules`), applied by `infrabyx-migrate` when this package is installed (after `@infrabyx/connectors`); run `infrabyx-rls-lint` afterwards.
