// Content screens (IPB-04-100 sections Pages and sections, Menus, Footer and contact; IPB-04
// §04.3.1, §04.4.3): the list of a pack's items of some types, and one item's editor with its
// workflow, revisions and preview links. The editor shows only the moves the state machine allows
// from the item's state (`transitions`, the `cms` table passed by the app); the service still
// checks every move, role and maker-checker rule.
import type { ReactNode } from "react";
import { Button, Field, SelectField } from "../components/forms.js";
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
import type { StudioSection } from "./layout.js";
import type { FormAction, ScreenProps } from "./types.js";

export interface StudioItem {
  id: string;
  type: string;
  packId: string;
  locale: string;
  slug: string | null;
  title: string;
  status: string;
  currentRevisionId: string;
  publishedRevisionId: string | null;
  publishedPath: string | null;
  publishAt: Date | null;
  unpublishAt: Date | null;
  needsLegal: boolean;
  lastReviewedAt: Date;
  deletedAt: Date | null;
}

export interface StudioRevision {
  id: string;
  seq: number;
  title: string;
  slug: string | null;
  body: Record<string, unknown>;
  seo: Record<string, unknown>;
  source: string;
  sanitiserReport: string[];
  createdBy: string;
  createdAt: Date;
}

/** What the content screens read (`CmsStudio` satisfies it). */
export interface ContentReader<C> {
  list(
    ctx: C,
    f?: { packId?: string; type?: string; status?: string; deleted?: boolean },
  ): Promise<StudioItem[]>;
  get(ctx: C, itemId: string): Promise<StudioItem>;
  revision(ctx: C, revisionId: string): Promise<StudioRevision>;
  revisions(ctx: C, itemId: string): Promise<StudioRevision[]>;
}

/** The state machine's moves and the states each starts from (`cms` `TRANSITIONS`). */
export type TransitionTable = Readonly<Record<string, { readonly from: readonly string[] }>>;

/** A pack to choose from (the Brand list). */
export interface PackOption {
  id: string;
  label: string;
}

const pretty = (v: unknown) => JSON.stringify(v ?? {}, null, 2);

/** A GET form that switches the pack the list shows. */
export function PackPicker({
  packs,
  packId,
  action,
}: {
  packs: readonly PackOption[];
  packId: string;
  action: string;
}) {
  return (
    <form method="get" action={action} className="ibx-studio__filter">
      <SelectField
        id="f-pack"
        name="pack"
        label="Brand pack"
        helpKey="hlp.studio.brand_pack"
        options={packs.map((p) => ({ value: p.id, label: p.label }))}
        defaultValue={packId}
      />
      <Button type="submit">Show</Button>
    </form>
  );
}

export async function ContentListScreen<C>(
  p: ScreenProps<C> & {
    cms: ContentReader<C>;
    section: StudioSection;
    title: string;
    packs: readonly PackOption[];
    packId: string;
    /** The content types this section lists and can create. */
    types: readonly string[];
    actions: { create: FormAction };
  },
) {
  const items = (
    await Promise.all(p.types.map((type) => p.cms.list(p.ctx, { packId: p.packId, type })))
  ).flat();
  return (
    <StudioPage
      sections={p.sections}
      base={p.base}
      section={p.section}
      title={p.title}
      flash={p.flash}
      errors={p.errors}
    >
      <PackPicker packs={p.packs} packId={p.packId} action={studioPath(p.base, p.section)} />
      <DataTable
        caption={`${p.title}: ${items.length} item${items.length === 1 ? "" : "s"}`}
        columns={[
          { key: "title", header: "Title", rowHeader: true },
          { key: "type", header: "Type" },
          { key: "status", header: "Status" },
          { key: "path", header: "Published at" },
          { key: "reviewed", header: "Last reviewed" },
        ]}
        rows={items.map((i) => ({
          title: <a href={studioPath(p.base, p.section, i.id)}>{i.title}</a>,
          type: i.type.replace(/_/g, " "),
          status: <StatusBadge status={i.status} />,
          path: i.publishedPath ?? "—",
          reviewed: when(i.lastReviewedAt),
        }))}
      />
      <StudioSectionBox id="new-item" title="New item">
        <form method="post" action={p.actions.create} noValidate>
          <Hidden values={{ packId: p.packId }} />
          <SelectField
            id="f-type"
            name="type"
            label="Type"
            helpKey="hlp.studio.content_type"
            options={p.types.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))}
            error={errorFor(p.errors, "f-type")}
          />
          <Field
            id="f-title"
            name="title"
            label="Title"
            helpKey="hlp.studio.title"
            required
            error={errorFor(p.errors, "f-title")}
          />
          <Field
            id="f-slug"
            name="slug"
            label="Slug"
            helpKey="hlp.studio.slug"
            hint="Lower-case words joined by hyphens. Leave empty for items without a page."
            error={errorFor(p.errors, "f-slug")}
          />
          <Field
            id="f-body"
            name="body"
            label="Body (JSON)"
            helpKey="hlp.studio.body_json"
            multiline
            defaultValue="{}"
            error={errorFor(p.errors, "f-body")}
          />
          <Button type="submit" variant="primary">
            Create draft
          </Button>
        </form>
      </StudioSectionBox>
    </StudioPage>
  );
}

const OPS = [
  { op: "submit", label: "Submit for review", variant: "primary" },
  { op: "legal_approve", label: "Approve as legal reviewer", variant: "primary" },
  { op: "approve", label: "Approve", variant: "primary" },
  { op: "publish_now", label: "Publish now", variant: "primary" },
  { op: "unschedule", label: "Cancel the schedule", variant: "secondary" },
] as const;

export async function ContentEditScreen<C>(
  p: ScreenProps<C> & {
    cms: ContentReader<C>;
    section: StudioSection;
    itemId: string;
    transitions: TransitionTable;
    actions: { save: FormAction; workflow: FormAction; preview: FormAction };
    reveal?: string | undefined;
    /** A type's own panel, shown before the revisions (a resource's versions). */
    extra?: ReactNode;
  },
) {
  const item = await p.cms.get(p.ctx, p.itemId);
  const [rev, history] = await Promise.all([
    p.cms.revision(p.ctx, item.currentRevisionId),
    p.cms.revisions(p.ctx, item.id),
  ]);
  const can = (move: string) => p.transitions[move]?.from.includes(item.status) ?? false;
  const err = (id: string) => errorFor(p.errors, id);
  const hidden = { itemId: item.id };
  return (
    <StudioPage
      sections={p.sections}
      base={p.base}
      section={p.section}
      title={item.title}
      flash={p.flash}
      errors={p.errors}
      reveal={p.reveal}
    >
      <p>
        <a href={studioPath(p.base, p.section)}>Back to the list</a>
      </p>
      <dl className="ibx-facts">
        <dt>Status</dt>
        <dd>
          <StatusBadge status={item.deletedAt ? "deleted" : item.status} />
        </dd>
        <dt>Type</dt>
        <dd>{item.type.replace(/_/g, " ")}</dd>
        <dt>Published at</dt>
        <dd>{item.publishedPath ?? "Not published"}</dd>
        <dt>Scheduled</dt>
        <dd>
          {item.publishAt ? `${when(item.publishAt, true)}` : "No"}
          {item.unpublishAt ? `, until ${when(item.unpublishAt, true)}` : ""}
        </dd>
        <dt>Legal review</dt>
        <dd>{item.needsLegal ? "Needed before approval" : "Not needed"}</dd>
        <dt>Last reviewed</dt>
        <dd>{when(item.lastReviewedAt)}</dd>
      </dl>

      {item.deletedAt ? null : (
        <StudioSectionBox id="edit" title="Edit">
          {item.status !== "draft" ? (
            <p>Saving changes moves the item back to draft and voids its approvals.</p>
          ) : null}
          <form method="post" action={p.actions.save} noValidate>
            <Hidden values={hidden} />
            <Field
              id="f-title"
              name="title"
              label="Title"
              helpKey="hlp.studio.title"
              required
              defaultValue={rev.title}
              error={err("f-title")}
            />
            <Field
              id="f-slug"
              name="slug"
              label="Slug"
              helpKey="hlp.studio.slug"
              defaultValue={rev.slug ?? ""}
              error={err("f-slug")}
            />
            <Field
              id="f-body"
              name="body"
              label="Body (JSON)"
              helpKey="hlp.studio.body_json"
              multiline
              defaultValue={pretty(rev.body)}
              error={err("f-body")}
            />
            <Field
              id="f-seo"
              name="seo"
              label="Search and sharing (JSON)"
              helpKey="hlp.studio.seo_json"
              multiline
              defaultValue={pretty(rev.seo)}
              error={err("f-seo")}
            />
            <Field
              id="f-summary"
              name="summary"
              label="Summary of changes"
              helpKey="hlp.studio.summary"
              error={err("f-summary")}
            />
            <Button type="submit" variant="primary">
              Save draft
            </Button>
          </form>
          {rev.sanitiserReport.length ? (
            <p>The sanitiser removed: {rev.sanitiserReport.join(", ")}.</p>
          ) : null}
        </StudioSectionBox>
      )}

      <StudioSectionBox id="workflow" title="Review and publishing">
        {OPS.filter((o) => can(o.op)).map((o) => (
          <form key={o.op} method="post" action={p.actions.workflow} className="ibx-studio__op">
            <Hidden values={{ ...hidden, op: o.op }} />
            <Button type="submit" variant={o.variant}>
              {o.label}
            </Button>
          </form>
        ))}
        {can("request_changes") ? (
          <form method="post" action={p.actions.workflow} noValidate>
            <Hidden values={{ ...hidden, op: "request_changes" }} />
            <Field
              id="f-reason"
              name="reason"
              label="What needs to change"
              helpKey="hlp.studio.reason"
              required
              error={err("f-reason")}
            />
            <Button type="submit">Request changes</Button>
          </form>
        ) : null}
        {can("schedule") ? (
          <form method="post" action={p.actions.workflow} noValidate>
            <Hidden values={{ ...hidden, op: "schedule" }} />
            <Field
              id="f-publishAt"
              name="publishAt"
              type="datetime-local"
              label="Publish at (UTC)"
              helpKey="hlp.studio.publish_at"
              required
              error={err("f-publishAt")}
            />
            <Field
              id="f-unpublishAt"
              name="unpublishAt"
              type="datetime-local"
              label="Unpublish at (UTC)"
              helpKey="hlp.studio.unpublish_at"
              error={err("f-unpublishAt")}
            />
            <Button type="submit">Schedule</Button>
          </form>
        ) : null}
        {can("unpublish") ? (
          <form method="post" action={p.actions.workflow} noValidate>
            <Hidden values={{ ...hidden, op: "unpublish" }} />
            <SelectField
              id="f-behaviour"
              name="behaviour"
              label="After unpublishing"
              helpKey="hlp.studio.unpublish_behaviour"
              options={[
                { value: "gone", label: "Show that the page is gone (410)" },
                { value: "redirect", label: "Redirect to another page" },
              ]}
            />
            <Field
              id="f-to"
              name="to"
              label="Redirect to"
              helpKey="hlp.studio.redirect_to"
              hint="A site path such as /about, for a redirect only."
              error={err("f-to")}
            />
            <Button type="submit" variant="danger">
              Unpublish
            </Button>
          </form>
        ) : null}
        {item.status === "published" && !item.deletedAt ? (
          <form method="post" action={p.actions.workflow}>
            <Hidden values={{ ...hidden, op: "mark_reviewed" }} />
            <Button type="submit">Mark as reviewed</Button>
          </form>
        ) : null}
        {item.deletedAt ? (
          <form method="post" action={p.actions.workflow}>
            <Hidden values={{ ...hidden, op: "restore" }} />
            <Button type="submit">Restore</Button>
          </form>
        ) : (
          <form method="post" action={p.actions.workflow} noValidate>
            <Hidden values={{ ...hidden, op: "delete" }} />
            <Field
              id="f-delete-reason"
              name="reason"
              label="Why delete it"
              helpKey="hlp.studio.reason"
              required
              error={err("f-delete-reason")}
            />
            <Button type="submit" variant="danger">
              Delete
            </Button>
          </form>
        )}
      </StudioSectionBox>

      <StudioSectionBox id="preview" title="Preview link">
        <p>A preview link shows the current draft to anyone who has it until it expires.</p>
        <form method="post" action={p.actions.preview} className="ibx-studio__op">
          <Hidden values={{ ...hidden, op: "create" }} />
          <Button type="submit">Create a preview link</Button>
        </form>
        <form method="post" action={p.actions.preview} className="ibx-studio__op">
          <Hidden values={{ ...hidden, op: "revoke" }} />
          <Button type="submit">Revoke all preview links</Button>
        </form>
      </StudioSectionBox>

      {p.extra}

      <StudioSectionBox id="history" title="Revisions">
        <DataTable
          caption={`Revisions of ${item.title}`}
          columns={[
            { key: "seq", header: "Revision", rowHeader: true, numeric: true },
            { key: "title", header: "Title" },
            { key: "by", header: "By" },
            { key: "at", header: "Saved" },
            { key: "action", header: "Action" },
          ]}
          rows={history.map((r) => ({
            seq: r.seq,
            title: r.title,
            by: r.createdBy,
            at: when(r.createdAt, true),
            action:
              r.id === item.currentRevisionId || item.deletedAt ? (
                "Current"
              ) : (
                <form method="post" action={p.actions.workflow}>
                  <Hidden values={{ ...hidden, op: "rollback", revisionId: r.id }} />
                  <Button type="submit" variant="ghost">
                    Roll back to revision {r.seq}
                  </Button>
                </form>
              ),
          }))}
        />
      </StudioSectionBox>
    </StudioPage>
  );
}
