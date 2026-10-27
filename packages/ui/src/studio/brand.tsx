// Brand screens (IPB-04-100 section Brand; IPB-04 §04.3.2): the packs and one pack's revisions.
// A revision is drafted, submitted, legally reviewed when the service says so, and approved by a
// checker who is not the maker; the contrast guard and the SVG sanitiser run in the service.
import { Button, CheckboxField, Field, SelectField } from "../components/forms.js";
import { DataTable } from "../components/data.js";
import { when } from "./form.js";
import {
  errorFor,
  Hidden,
  StatusBadge,
  StudioPage,
  StudioSectionBox,
  studioPath,
} from "./layout.js";
import type { FormAction, ScreenProps } from "./types.js";

export interface StudioPack {
  id: string;
  product: string;
  label: string;
  isDefault: boolean;
  status: string;
  publishedRevisionId: string | null;
  updatedAt: Date;
}

export interface StudioBrandRevision {
  id: string;
  packId: string;
  body: object;
  hosts: readonly unknown[];
  status: string;
  contrastGuardPassed: boolean;
  svgSanitised: boolean;
  legalReviewRequired: boolean;
  rollbackOf: string | null;
  makerId: string;
  checkerId: string | null;
  legalReviewerId: string | null;
}

/** What the Brand screens read (`BrandStudio` satisfies it). */
export interface BrandReader<C> {
  packs(ctx: C, f?: { product?: string }): Promise<StudioPack[]>;
  revisions(ctx: C, packId: string): Promise<StudioBrandRevision[]>;
}

export async function BrandListScreen<C>(
  p: ScreenProps<C> & {
    brand: BrandReader<C>;
    /** The products this app may create packs for. */
    products: readonly string[];
    actions: { create: FormAction };
  },
) {
  const packs = await p.brand.packs(p.ctx);
  return (
    <StudioPage
      sections={p.sections}
      base={p.base}
      section="brand"
      title="Brand"
      flash={p.flash}
      errors={p.errors}
    >
      <DataTable
        caption={`Brand packs: ${packs.length}`}
        columns={[
          { key: "label", header: "Pack", rowHeader: true },
          { key: "product", header: "Product" },
          { key: "default", header: "Default" },
          { key: "status", header: "Status" },
          { key: "updated", header: "Updated" },
        ]}
        rows={packs.map((k) => ({
          label: <a href={studioPath(p.base, "brand", k.id)}>{k.label}</a>,
          product: k.product,
          default: k.isDefault ? "Yes" : "No",
          status: <StatusBadge status={k.status} />,
          updated: when(k.updatedAt),
        }))}
      />
      <StudioSectionBox id="new-pack" title="New pack">
        <form method="post" action={p.actions.create} noValidate>
          <SelectField
            id="f-product"
            name="product"
            label="Product"
            helpKey="hlp.studio.brand_product"
            options={p.products.map((x) => ({ value: x, label: x }))}
            error={errorFor(p.errors, "f-product")}
          />
          <Field
            id="f-label"
            name="label"
            label="Name"
            helpKey="hlp.studio.brand_label"
            required
            error={errorFor(p.errors, "f-label")}
          />
          <CheckboxField
            id="f-isDefault"
            name="isDefault"
            label="The product's default pack (served to hosts that are not mapped)"
            helpKey="hlp.studio.brand_default"
          />
          <Button type="submit" variant="primary">
            Create pack
          </Button>
        </form>
      </StudioSectionBox>
    </StudioPage>
  );
}

const pretty = (v: unknown) => JSON.stringify(v ?? {}, null, 2);

export async function BrandEditScreen<C>(
  p: ScreenProps<C> & {
    brand: BrandReader<C>;
    packId: string;
    actions: { save: FormAction; logo: FormAction; workflow: FormAction };
  },
) {
  const [packs, revisions] = await Promise.all([
    p.brand.packs(p.ctx),
    p.brand.revisions(p.ctx, p.packId),
  ]);
  const pack = packs.find((k) => k.id === p.packId);
  const latest = revisions[0];
  const err = (id: string) => errorFor(p.errors, id);
  const pending = latest?.status === "pending_approval";
  return (
    <StudioPage
      sections={p.sections}
      base={p.base}
      section="brand"
      title={pack ? `${pack.label} (${pack.product})` : "Brand pack"}
      flash={p.flash}
      errors={p.errors}
    >
      <p>
        <a href={studioPath(p.base, "brand")}>Back to the packs</a>
      </p>
      {latest ? (
        <dl className="ibx-facts">
          <dt>Latest revision</dt>
          <dd>
            <StatusBadge status={latest.status} />
          </dd>
          <dt>Contrast guard</dt>
          <dd>{latest.contrastGuardPassed ? "Passed" : "Not passed"}</dd>
          <dt>Logo sanitised</dt>
          <dd>{latest.svgSanitised ? "Yes" : "No"}</dd>
          <dt>Legal review</dt>
          <dd>
            {latest.legalReviewRequired
              ? latest.legalReviewerId
                ? "Done"
                : "Needed before approval"
              : "Not needed"}
          </dd>
        </dl>
      ) : (
        <p>No revision yet. Save a draft to start.</p>
      )}

      <StudioSectionBox id="edit" title="Edit the draft">
        <form method="post" action={p.actions.save} noValidate>
          <Hidden values={{ packId: p.packId }} />
          <Field
            id="f-body"
            name="body"
            label="Pack (JSON)"
            helpKey="hlp.studio.brand_body"
            multiline
            defaultValue={pretty(latest?.body)}
            error={err("f-body")}
          />
          <Field
            id="f-hosts"
            name="hosts"
            label="Hosts (JSON)"
            helpKey="hlp.studio.brand_hosts"
            multiline
            defaultValue={pretty(latest?.hosts ?? [])}
            error={err("f-hosts")}
          />
          <Button type="submit" variant="primary">
            Save draft
          </Button>
        </form>
        <form method="post" action={p.actions.logo} encType="multipart/form-data" noValidate>
          <Hidden values={{ packId: p.packId }} />
          <div className="ibx-field">
            <label className="ibx-field__label" htmlFor="f-logo">
              Logo (SVG)
            </label>
            <input
              className="ibx-field__input"
              id="f-logo"
              name="logo"
              type="file"
              accept="image/svg+xml"
              data-help-key="hlp.studio.brand_logo"
            />
          </div>
          <Button type="submit">Upload logo</Button>
        </form>
      </StudioSectionBox>

      {latest ? (
        <StudioSectionBox id="workflow" title="Review and publishing">
          {latest.status === "draft" || latest.status === "rejected" ? (
            <form method="post" action={p.actions.workflow} className="ibx-studio__op">
              <Hidden values={{ revisionId: latest.id, op: "submit" }} />
              <Button type="submit" variant="primary">
                Submit for approval
              </Button>
            </form>
          ) : null}
          {pending && latest.legalReviewRequired && !latest.legalReviewerId ? (
            <form method="post" action={p.actions.workflow} className="ibx-studio__op">
              <Hidden values={{ revisionId: latest.id, op: "legal_review" }} />
              <Button type="submit" variant="primary">
                Record legal review
              </Button>
            </form>
          ) : null}
          {pending ? (
            <>
              <form method="post" action={p.actions.workflow} className="ibx-studio__op">
                <Hidden values={{ revisionId: latest.id, op: "approve" }} />
                <Button type="submit" variant="primary">
                  Approve and publish
                </Button>
              </form>
              <form method="post" action={p.actions.workflow} noValidate>
                <Hidden values={{ revisionId: latest.id, op: "reject" }} />
                <Field
                  id="f-reason"
                  name="reason"
                  label="Why reject it"
                  helpKey="hlp.studio.reason"
                  required
                  error={err("f-reason")}
                />
                <Button type="submit" variant="danger">
                  Reject
                </Button>
              </form>
            </>
          ) : null}
        </StudioSectionBox>
      ) : null}

      <StudioSectionBox id="history" title="Revisions">
        <DataTable
          caption="Revisions, newest first"
          columns={[
            { key: "id", header: "Revision", rowHeader: true },
            { key: "status", header: "Status" },
            { key: "maker", header: "Made by" },
            { key: "checker", header: "Approved by" },
            { key: "action", header: "Action" },
          ]}
          rows={revisions.map((r) => ({
            id: r.id,
            status: <StatusBadge status={r.status} />,
            maker: r.makerId,
            checker: r.checkerId ?? "—",
            action:
              r.status === "superseded" ? (
                <form method="post" action={p.actions.workflow}>
                  <Hidden values={{ packId: p.packId, revisionId: r.id, op: "rollback" }} />
                  <Button type="submit" variant="ghost">
                    Roll back to this revision
                  </Button>
                </form>
              ) : (
                "—"
              ),
          }))}
        />
      </StudioSectionBox>
    </StudioPage>
  );
}
