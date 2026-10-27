// Redirects (IPB-04-100; IPB-04-08, `@IPB-04-AT-08`): a pack's map, a manual rule (active once a
// checker and the legal reviewer approve it), and the legacy CSV import with its dry run.
import { Button, Field, SelectField } from "../components/forms.js";
import { DataTable } from "../components/data.js";
import { oneOf, required, run } from "./form.js";
import { PackPicker, type PackOption } from "./content.js";
import {
  errorFor,
  Hidden,
  StatusBadge,
  StudioPage,
  StudioSectionBox,
  studioPath,
} from "./layout.js";
import type { FormAction, ScreenProps, StudioResult } from "./types.js";

export interface StudioRedirect {
  id: string;
  from: string;
  to: string | null;
  status: number;
  source: string;
  state: string;
  checkerId: string | null;
  legalReviewerId: string | null;
  hits: number;
}

export interface RedirectReader<C> {
  redirects(ctx: C, packId: string, f?: { state?: string }): Promise<StudioRedirect[]>;
}

export interface RedirectWriter<C> {
  addRedirect(
    ctx: C,
    packId: string,
    rule: { from: string; to: string | null; status: 301 | 302 | 410 },
  ): Promise<{ id: string }>;
  reviewRedirect(ctx: C, redirectId: string, as: "checker" | "legal"): Promise<{ active: boolean }>;
  importRedirects(
    ctx: C,
    packId: string,
    csv: string,
    o?: { commit?: boolean },
  ): Promise<{
    accepted: readonly unknown[];
    conflicts: readonly { line: number; reason: string }[];
    loops: readonly { line: number; reason: string }[];
    chains: readonly { line: number; reason: string }[];
    invalid: readonly { line: number; reason: string }[];
    committed: number;
  }>;
}

export async function RedirectsScreen<C>(
  p: ScreenProps<C> & {
    cms: RedirectReader<C>;
    packs: readonly PackOption[];
    packId: string;
    actions: { add: FormAction; review: FormAction; import: FormAction };
  },
) {
  const rules = await p.cms.redirects(p.ctx, p.packId);
  const err = (id: string) => errorFor(p.errors, id);
  return (
    <StudioPage
      base={p.base}
      section="redirects"
      title="Redirects"
      flash={p.flash}
      errors={p.errors}
    >
      <PackPicker packs={p.packs} packId={p.packId} action={studioPath(p.base, "redirects")} />
      <DataTable
        caption={`Redirects: ${rules.length}`}
        columns={[
          { key: "from", header: "From", rowHeader: true },
          { key: "to", header: "To" },
          { key: "code", header: "Code", numeric: true },
          { key: "state", header: "State" },
          { key: "hits", header: "Hits", numeric: true },
          { key: "action", header: "Action" },
        ]}
        rows={rules.map((r) => ({
          from: r.from,
          to: r.to ?? "Gone",
          code: r.status,
          state: <StatusBadge status={r.state} />,
          hits: r.hits,
          action:
            r.state === "pending" ? (
              <>
                {r.checkerId ? null : (
                  <form method="post" action={p.actions.review}>
                    <Hidden values={{ redirectId: r.id, as: "checker" }} />
                    <Button type="submit" variant="ghost">
                      Approve {r.from} as checker
                    </Button>
                  </form>
                )}
                {r.legalReviewerId ? null : (
                  <form method="post" action={p.actions.review}>
                    <Hidden values={{ redirectId: r.id, as: "legal" }} />
                    <Button type="submit" variant="ghost">
                      Approve {r.from} as legal reviewer
                    </Button>
                  </form>
                )}
              </>
            ) : (
              "—"
            ),
        }))}
      />
      <StudioSectionBox id="new-redirect" title="New redirect">
        <form method="post" action={p.actions.add} noValidate>
          <Hidden values={{ packId: p.packId }} />
          <Field
            id="f-from"
            name="from"
            label="From"
            helpKey="hlp.studio.redirect_from"
            hint="A site path such as /old-page."
            required
            error={err("f-from")}
          />
          <SelectField
            id="f-status"
            name="status"
            label="Kind"
            helpKey="hlp.studio.redirect_status"
            options={[
              { value: "301", label: "Moved for good (301)" },
              { value: "302", label: "Moved for now (302)" },
              { value: "410", label: "Gone (410)" },
            ]}
          />
          <Field
            id="f-to"
            name="to"
            label="To"
            helpKey="hlp.studio.redirect_to"
            hint="A site path or an https address. Leave empty for Gone."
            error={err("f-to")}
          />
          <Button type="submit" variant="primary">
            Add redirect
          </Button>
        </form>
      </StudioSectionBox>
      <StudioSectionBox id="import" title="Import from a CSV file">
        <form method="post" action={p.actions.import} noValidate>
          <Hidden values={{ packId: p.packId }} />
          <Field
            id="f-csv"
            name="csv"
            label="Rows (from,to,status)"
            helpKey="hlp.studio.redirect_csv"
            multiline
            required
            error={err("f-csv")}
          />
          <Button type="submit" name="op" value="dry_run">
            Check the rows
          </Button>{" "}
          <Button type="submit" name="op" value="commit" variant="primary">
            Import the accepted rows
          </Button>
        </form>
      </StudioSectionBox>
    </StudioPage>
  );
}

export function redirectHandlers<C>(cms: RedirectWriter<C>) {
  return {
    async add(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const status = Number(oneOf(fd, "status", ["301", "302", "410"] as const)) as
          301 | 302 | 410;
        await cms.addRedirect(ctx, required(fd, "packId", "a pack"), {
          from: required(fd, "from", "the old path"),
          to: status === 410 ? null : required(fd, "to", "where it goes"),
          status,
        });
        return {
          flash: {
            tone: "success",
            title: "Redirect added",
            detail: "It is active once a checker and the legal reviewer approve it.",
          },
        };
      });
    },
    async review(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const r = await cms.reviewRedirect(
          ctx,
          required(fd, "redirectId", "a redirect"),
          oneOf(fd, "as", ["checker", "legal"] as const),
        );
        return {
          flash: {
            tone: "success",
            title: r.active ? "Approved; the redirect is active" : "Approved",
          },
        };
      });
    },
    async import(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const commit = oneOf(fd, "op", ["dry_run", "commit"] as const) === "commit";
        const r = await cms.importRedirects(
          ctx,
          required(fd, "packId", "a pack"),
          required(fd, "csv", "the rows"),
          { commit },
        );
        const problems = [...r.invalid, ...r.conflicts, ...r.loops, ...r.chains];
        const detail = [
          `${r.accepted.length} accepted, ${r.invalid.length} invalid, ${r.conflicts.length} conflicts, ${r.loops.length} loops, ${r.chains.length} chains.`,
          ...problems.slice(0, 5).map((x) => `Line ${x.line}: ${x.reason}.`),
        ].join(" ");
        return {
          flash: {
            tone: problems.length ? "warning" : "success",
            title: commit ? `${r.committed} redirect(s) imported, waiting for approval` : "Dry run",
            detail,
          },
        };
      });
    },
  };
}
