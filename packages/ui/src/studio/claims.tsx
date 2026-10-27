// The Claims Register (IPB-04-100; IPB-04-07, 04-102): every factual claim a page may make, its
// evidence class and review date. An editor proposes; the legal reviewer (not the proposer)
// assigns the evidence class, which activates it; content lint refuses unregistered claims.
import { Button, Field, SelectField } from "../components/forms.js";
import { DataTable } from "../components/data.js";
import { oneOf, required, run, text, when } from "./form.js";
import { errorFor, Hidden, StatusBadge, StudioPage, StudioSectionBox } from "./layout.js";
import type { FormAction, ScreenProps, StudioResult } from "./types.js";

export interface StudioClaim {
  id: string;
  text: string;
  value: string | null;
  unit: string | null;
  asOf: Date;
  evidenceClass: string;
  kind: string;
  status: string;
  reviewDue: Date;
}

export interface ClaimReader<C> {
  claims(ctx: C, f?: { status?: string }): Promise<StudioClaim[]>;
}

export interface ClaimWriter<C> {
  proposeClaim(
    ctx: C,
    c: {
      text: string;
      value?: string;
      unit?: string;
      asOf: string;
      kind?: string;
      sourceUrl?: string;
      reviewDue: string;
    },
  ): Promise<{ id: string }>;
  assignClaim(
    ctx: C,
    claimId: string,
    a: { evidenceClass: string; evidenceDocId?: string },
  ): Promise<void>;
  withdrawClaim(ctx: C, claimId: string): Promise<void>;
}

const KINDS = ["figure", "certification", "audit", "permission", "category"] as const;
const CLASSES = ["E0", "E1", "E2", "E3", "E4"] as const;

export async function ClaimsScreen<C>(
  p: ScreenProps<C> & {
    cms: ClaimReader<C>;
    actions: { propose: FormAction; assign: FormAction; withdraw: FormAction };
  },
) {
  const claims = await p.cms.claims(p.ctx);
  const err = (id: string) => errorFor(p.errors, id);
  return (
    <StudioPage
      base={p.base}
      section="claims"
      title="Claims Register"
      flash={p.flash}
      errors={p.errors}
    >
      <DataTable
        caption={`Claims: ${claims.length}`}
        columns={[
          { key: "text", header: "Claim", rowHeader: true },
          { key: "value", header: "Value" },
          { key: "kind", header: "Kind" },
          { key: "evidence", header: "Evidence" },
          { key: "status", header: "Status" },
          { key: "due", header: "Review by" },
          { key: "action", header: "Action" },
        ]}
        rows={claims.map((c) => ({
          text: c.text,
          value: c.value ? `${c.value}${c.unit ? ` ${c.unit}` : ""} (as of ${when(c.asOf)})` : "—",
          kind: c.kind,
          evidence: c.evidenceClass,
          status: <StatusBadge status={c.status} />,
          due: when(c.reviewDue),
          action:
            c.status === "proposed" ? (
              <form method="post" action={p.actions.assign} noValidate>
                <Hidden values={{ claimId: c.id }} />
                <SelectField
                  id={`f-class-${c.id}`}
                  name="evidenceClass"
                  label="Evidence class"
                  helpKey="hlp.studio.claim_evidence"
                  options={CLASSES.map((x) => ({ value: x, label: x }))}
                />
                <Field
                  id={`f-doc-${c.id}`}
                  name="evidenceDocId"
                  label="Evidence document (vad_…)"
                  helpKey="hlp.studio.claim_evidence_doc"
                />
                <Button type="submit" variant="ghost">
                  Assign and activate
                </Button>
              </form>
            ) : c.status === "active" ? (
              <form method="post" action={p.actions.withdraw}>
                <Hidden values={{ claimId: c.id }} />
                <Button type="submit" variant="danger">
                  Withdraw
                </Button>
              </form>
            ) : (
              "—"
            ),
        }))}
      />
      <StudioSectionBox id="new-claim" title="Propose a claim">
        <form method="post" action={p.actions.propose} noValidate>
          <Field
            id="f-text"
            name="text"
            label="Claim"
            helpKey="hlp.studio.claim_text"
            required
            maxLength={500}
            error={err("f-text")}
          />
          <Field id="f-value" name="value" label="Value" helpKey="hlp.studio.claim_value" />
          <Field id="f-unit" name="unit" label="Unit" helpKey="hlp.studio.claim_unit" />
          <SelectField
            id="f-kind"
            name="kind"
            label="Kind"
            helpKey="hlp.studio.claim_kind"
            options={KINDS.map((x) => ({ value: x, label: x }))}
          />
          <Field
            id="f-asOf"
            name="asOf"
            type="date"
            label="True as of"
            helpKey="hlp.studio.claim_as_of"
            required
            error={err("f-asOf")}
          />
          <Field
            id="f-reviewDue"
            name="reviewDue"
            type="date"
            label="Review by"
            helpKey="hlp.studio.claim_review_due"
            required
            error={err("f-reviewDue")}
          />
          <Field
            id="f-sourceUrl"
            name="sourceUrl"
            type="url"
            label="Source (https)"
            helpKey="hlp.studio.claim_source"
            error={err("f-sourceUrl")}
          />
          <Button type="submit" variant="primary">
            Propose
          </Button>
        </form>
      </StudioSectionBox>
    </StudioPage>
  );
}

export function claimHandlers<C>(cms: ClaimWriter<C>) {
  return {
    async propose(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const opt = (k: string) => {
          const v = text(fd, k);
          return v ? { [k]: v } : {};
        };
        await cms.proposeClaim(ctx, {
          text: required(fd, "text", "the claim"),
          asOf: required(fd, "asOf", "the date it is true as of"),
          reviewDue: required(fd, "reviewDue", "the review date"),
          kind: oneOf(fd, "kind", KINDS),
          ...opt("value"),
          ...opt("unit"),
          ...opt("sourceUrl"),
        });
        return {
          flash: {
            tone: "success",
            title: "Claim proposed",
            detail: "The legal reviewer assigns its evidence class to activate it.",
          },
        };
      });
    },
    async assign(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const doc = text(fd, "evidenceDocId");
        await cms.assignClaim(ctx, required(fd, "claimId", "a claim"), {
          evidenceClass: oneOf(fd, "evidenceClass", CLASSES),
          ...(doc ? { evidenceDocId: doc } : {}),
        });
        return { flash: { tone: "success", title: "Claim active" } };
      });
    },
    async withdraw(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        await cms.withdrawClaim(ctx, required(fd, "claimId", "a claim"));
        return {
          flash: {
            tone: "success",
            title: "Claim withdrawn",
            detail: "Pages that use it fail content lint until they are changed.",
          },
        };
      });
    },
  };
}
