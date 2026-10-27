// Policies (IPB-04-100; IPB-05): a pack's policy set and parameters, every policy version, and one
// version's editor with its lint, approvals and the MAJOR-change notice (#55: the period counts
// from when users are notified). The services enforce the maker (PLT_LEGAL_REVIEWER), the DPO for
// privacy-class policies, and the checker.
import { Button, Field, SelectField } from "../components/forms.js";
import { DataTable } from "../components/data.js";
import { FieldProblem, json, oneOf, required, run, text, when } from "./form.js";
import { PackPicker, type PackOption } from "./content.js";
import { utc } from "./content-handlers.js";
import {
  errorFor,
  Hidden,
  StatusBadge,
  StudioPage,
  StudioSectionBox,
  studioPath,
} from "./layout.js";
import type { FormAction, ScreenProps, StudioResult } from "./types.js";

export interface StudioPolicySet {
  id: string;
  params: Record<string, unknown>;
  paramsVersion: number;
  pendingParams: Record<string, unknown> | null;
  pendingMakerId: string | null;
}

export interface StudioPolicy {
  id: string;
  setId: string;
  key: string;
  versionLabel: string;
  changeClass: string;
  title: string;
  body: string;
  hiSummary: string | null;
  summaryOfChanges: string;
  effectiveAt: Date;
  privacyClass: boolean;
  state: string;
  seededPlaceholder: boolean;
  makerId: string;
  checkerId: string | null;
  dpoId: string | null;
  lastReviewedAt: Date;
}

export interface StudioNoticeStatus {
  required: boolean;
  publishedAt: Date | null;
  sentAt: Date | null;
  notifiedAt: Date | null;
  noticeDays: number;
  effectiveFrom: Date | null;
}

/** What the Policies screens read (`PolicyStudio` satisfies it). */
export interface PolicyReader<C> {
  setFor(ctx: C, packId: string): Promise<StudioPolicySet | null>;
  instances(ctx: C, setId: string): Promise<StudioPolicy[]>;
  get(ctx: C, id: string): Promise<StudioPolicy>;
  lint(
    ctx: C,
    id: string,
  ): Promise<{ findings: readonly { code: string; location: string; message: string }[] }>;
  noticeStatus(ctx: C, id: string): Promise<StudioNoticeStatus>;
}

export interface PolicyWriter<C> {
  createSet(ctx: C, packId: string): Promise<{ id: string }>;
  proposeParams(
    ctx: C,
    setId: string,
    params: Record<string, string | number | boolean>,
  ): Promise<void>;
  approveParams(ctx: C, setId: string): Promise<void>;
  draft(
    ctx: C,
    input: {
      setId: string;
      key: string;
      changeClass?: "MAJOR" | "MINOR";
      body?: string;
      summaryOfChanges: string;
      effectiveAt: Date;
    },
  ): Promise<{ id: string }>;
  editDraft(
    ctx: C,
    id: string,
    patch: {
      body?: string;
      summaryOfChanges?: string;
      effectiveAt?: Date;
      hiSummary?: string | null;
    },
  ): Promise<unknown>;
  submit(ctx: C, id: string): Promise<unknown>;
  requestChanges(ctx: C, id: string, reason: string): Promise<unknown>;
  dpoApprove(ctx: C, id: string): Promise<unknown>;
  approve(ctx: C, id: string): Promise<unknown>;
  publishNotice(ctx: C, id: string): Promise<unknown>;
  recordNoticeSent(ctx: C, id: string, sentAt: Date): Promise<unknown>;
  markReviewed(ctx: C, id: string): Promise<void>;
}

export async function PoliciesScreen<C>(
  p: ScreenProps<C> & {
    policies: PolicyReader<C>;
    packs: readonly PackOption[];
    packId: string;
    /** The policies a set may hold (`cms` templates), for the new-version form. */
    templates: readonly { key: string; title: string }[];
    actions: { createSet: FormAction; params: FormAction; draft: FormAction };
  },
) {
  const set = await p.policies.setFor(p.ctx, p.packId);
  const versions = set ? await p.policies.instances(p.ctx, set.id) : [];
  const err = (id: string) => errorFor(p.errors, id);
  return (
    <StudioPage base={p.base} section="policies" title="Policies" flash={p.flash} errors={p.errors}>
      <PackPicker packs={p.packs} packId={p.packId} action={studioPath(p.base, "policies")} />
      {!set ? (
        <form method="post" action={p.actions.createSet}>
          <Hidden values={{ packId: p.packId }} />
          <p>This pack has no policy set yet.</p>
          <Button type="submit" variant="primary">
            Create the policy set
          </Button>
        </form>
      ) : (
        <>
          <DataTable
            caption={`Policy versions: ${versions.length}`}
            columns={[
              { key: "title", header: "Policy", rowHeader: true },
              { key: "version", header: "Version" },
              { key: "class", header: "Change" },
              { key: "state", header: "State" },
              { key: "effective", header: "Effective" },
            ]}
            rows={versions.map((v) => ({
              title: <a href={studioPath(p.base, "policies", v.id)}>{v.title}</a>,
              version: `${v.versionLabel}${v.seededPlaceholder ? " (placeholder)" : ""}`,
              class: v.changeClass,
              state: <StatusBadge status={v.state} />,
              effective: when(v.effectiveAt),
            }))}
          />
          <StudioSectionBox id="params" title="Parameters">
            <p>
              The entity, officers and addresses the policies quote. A change needs a second person
              to approve it.
            </p>
            {set.pendingParams ? (
              <form method="post" action={p.actions.params}>
                <Hidden values={{ setId: set.id, op: "approve" }} />
                <p>Proposed by {set.pendingMakerId}, waiting for approval.</p>
                <pre className="ibx-studio__json">{JSON.stringify(set.pendingParams, null, 2)}</pre>
                <Button type="submit" variant="primary">
                  Approve the parameters
                </Button>
              </form>
            ) : null}
            <form method="post" action={p.actions.params} noValidate>
              <Hidden values={{ setId: set.id, op: "propose" }} />
              <Field
                id="f-params"
                name="params"
                label="Parameters (JSON)"
                helpKey="hlp.studio.policy_params"
                multiline
                defaultValue={JSON.stringify(set.pendingParams ?? set.params, null, 2)}
                error={err("f-params")}
              />
              <Button type="submit">Propose these parameters</Button>
            </form>
          </StudioSectionBox>
          <StudioSectionBox id="new-version" title="New version">
            <form method="post" action={p.actions.draft} noValidate>
              <Hidden values={{ setId: set.id }} />
              <SelectField
                id="f-key"
                name="key"
                label="Policy"
                helpKey="hlp.studio.policy_key"
                options={p.templates.map((t) => ({ value: t.key, label: t.title }))}
              />
              <SelectField
                id="f-changeClass"
                name="changeClass"
                label="Change"
                helpKey="hlp.studio.policy_change_class"
                options={[
                  { value: "MINOR", label: "Minor (wording, no new duties)" },
                  { value: "MAJOR", label: "Major (users are notified first)" },
                ]}
              />
              <Field
                id="f-summary"
                name="summary"
                label="Summary of changes"
                helpKey="hlp.studio.summary"
                required
                error={err("f-summary")}
              />
              <Field
                id="f-effectiveAt"
                name="effectiveAt"
                type="date"
                label="Effective from"
                helpKey="hlp.studio.policy_effective"
                required
                error={err("f-effectiveAt")}
              />
              <Button type="submit" variant="primary">
                Draft the version
              </Button>
            </form>
          </StudioSectionBox>
        </>
      )}
    </StudioPage>
  );
}

export async function PolicyEditScreen<C>(
  p: ScreenProps<C> & {
    policies: PolicyReader<C>;
    id: string;
    actions: { edit: FormAction; workflow: FormAction };
  },
) {
  const v = await p.policies.get(p.ctx, p.id);
  const [lint, notice] = await Promise.all([
    p.policies.lint(p.ctx, v.id),
    p.policies.noticeStatus(p.ctx, v.id),
  ]);
  const err = (id: string) => errorFor(p.errors, id);
  const op = (name: string, label: string, variant: "primary" | "secondary" = "secondary") => (
    <form key={name} method="post" action={p.actions.workflow} className="ibx-studio__op">
      <Hidden values={{ id: v.id, op: name }} />
      <Button type="submit" variant={variant}>
        {label}
      </Button>
    </form>
  );
  return (
    <StudioPage
      base={p.base}
      section="policies"
      title={`${v.title} ${v.versionLabel}`}
      flash={p.flash}
      errors={p.errors}
    >
      <p>
        <a href={studioPath(p.base, "policies")}>Back to the policies</a>
      </p>
      <dl className="ibx-facts">
        <dt>State</dt>
        <dd>
          <StatusBadge status={v.state} />
        </dd>
        <dt>Change</dt>
        <dd>{v.changeClass}</dd>
        <dt>Effective</dt>
        <dd>{when(v.effectiveAt)}</dd>
        <dt>Privacy policy</dt>
        <dd>{v.privacyClass ? (v.dpoId ? "Yes, DPO approved" : "Yes, needs the DPO") : "No"}</dd>
        <dt>Last reviewed</dt>
        <dd>{when(v.lastReviewedAt)}</dd>
      </dl>

      <StudioSectionBox id="lint" title="Checks">
        {lint.findings.length ? (
          <ul>
            {lint.findings.map((f, i) => (
              <li key={i}>
                {f.code} at {f.location}: {f.message}
              </li>
            ))}
          </ul>
        ) : (
          <p>No findings.</p>
        )}
      </StudioSectionBox>

      {v.state === "draft" ? (
        <StudioSectionBox id="edit" title="Edit the draft">
          <form method="post" action={p.actions.edit} noValidate>
            <Hidden values={{ id: v.id }} />
            <Field
              id="f-body"
              name="body"
              label="Text (Markdown with [COUNSEL] markers)"
              helpKey="hlp.studio.policy_body"
              multiline
              defaultValue={v.body}
              error={err("f-body")}
            />
            <Field
              id="f-summary"
              name="summary"
              label="Summary of changes"
              helpKey="hlp.studio.summary"
              defaultValue={v.summaryOfChanges}
              error={err("f-summary")}
            />
            <Field
              id="f-effectiveAt"
              name="effectiveAt"
              type="date"
              label="Effective from"
              helpKey="hlp.studio.policy_effective"
              defaultValue={when(v.effectiveAt)}
              error={err("f-effectiveAt")}
            />
            <Field
              id="f-hiSummary"
              name="hiSummary"
              label="Summary in Hindi"
              helpKey="hlp.studio.policy_hi_summary"
              defaultValue={v.hiSummary ?? ""}
            />
            <Button type="submit" variant="primary">
              Save draft
            </Button>
          </form>
        </StudioSectionBox>
      ) : null}

      <StudioSectionBox id="workflow" title="Review and publishing">
        {v.state === "draft" ? op("submit", "Submit for approval", "primary") : null}
        {v.state === "submitted" && v.privacyClass && !v.dpoId
          ? op("dpo_approve", "Approve as DPO", "primary")
          : null}
        {v.state === "submitted" ? op("approve", "Approve", "primary") : null}
        {v.state === "submitted" ? (
          <form method="post" action={p.actions.workflow} noValidate>
            <Hidden values={{ id: v.id, op: "request_changes" }} />
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
        {v.state === "effective" ? op("mark_reviewed", "Mark as reviewed") : null}
      </StudioSectionBox>

      {notice.required ? (
        <StudioSectionBox id="notice" title="Notice to users">
          <p>
            This major change takes effect {notice.noticeDays} days after users are notified (the
            notice published and sent), and not before its effective date.
          </p>
          <dl className="ibx-facts">
            <dt>Notice published</dt>
            <dd>{when(notice.publishedAt, true)}</dd>
            <dt>Notice sent</dt>
            <dd>{when(notice.sentAt, true)}</dd>
            <dt>Takes effect from</dt>
            <dd>{notice.effectiveFrom ? when(notice.effectiveFrom, true) : "Not yet known"}</dd>
          </dl>
          {v.state === "approved" && !notice.publishedAt
            ? op("publish_notice", "Publish the notice", "primary")
            : null}
          {v.state === "approved" && !notice.sentAt ? (
            <form method="post" action={p.actions.workflow} noValidate>
              <Hidden values={{ id: v.id, op: "notice_sent" }} />
              <Field
                id="f-sentAt"
                name="sentAt"
                type="datetime-local"
                label="Notice sent at (UTC)"
                helpKey="hlp.studio.policy_notice_sent"
                required
                error={err("f-sentAt")}
              />
              <Button type="submit">Record when it was sent</Button>
            </form>
          ) : null}
        </StudioSectionBox>
      ) : null}
    </StudioPage>
  );
}

/** A `yyyy-mm-dd` date input as midnight IST (policy dates are Indian dates). */
function istDate(v: string, fieldId: string): Date {
  const d = /^\d{4}-\d\d-\d\d$/.test(v) ? new Date(`${v}T00:00:00+05:30`) : new Date(NaN);
  if (Number.isNaN(d.getTime())) throw new FieldProblem([{ fieldId, message: "Enter a date." }]);
  return d;
}

export function policyHandlers<C>(policies: PolicyWriter<C>, o: { base: string }) {
  const done = (title: string, detail?: string): StudioResult => ({
    flash: { tone: "success", title, ...(detail ? { detail } : {}) },
  });
  return {
    async createSet(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        await policies.createSet(ctx, required(fd, "packId", "a pack"));
        return done("Policy set created");
      });
    },
    async params(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const setId = required(fd, "setId", "a set");
        if (oneOf(fd, "op", ["propose", "approve"] as const) === "approve") {
          await policies.approveParams(ctx, setId);
          return done("Parameters approved");
        }
        const params = json(fd, "params", "The parameters");
        if (!params || typeof params !== "object" || Array.isArray(params))
          throw new FieldProblem([{ fieldId: "f-params", message: "Enter a JSON object." }]);
        await policies.proposeParams(
          ctx,
          setId,
          params as Record<string, string | number | boolean>,
        );
        return done("Parameters proposed", "A second person approves them.");
      });
    },
    async draft(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const r = await policies.draft(ctx, {
          setId: required(fd, "setId", "a set"),
          key: required(fd, "key", "a policy"),
          changeClass: oneOf(fd, "changeClass", ["MINOR", "MAJOR"] as const),
          summaryOfChanges: required(fd, "summary", "a summary of changes"),
          effectiveAt: istDate(required(fd, "effectiveAt", "the effective date"), "f-effectiveAt"),
        });
        return { ...done("Draft created"), redirectTo: studioPath(o.base, "policies", r.id) };
      });
    },
    async edit(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const body = text(fd, "body");
        const summary = text(fd, "summary");
        const eff = text(fd, "effectiveAt");
        await policies.editDraft(ctx, required(fd, "id", "a policy"), {
          ...(body ? { body } : {}),
          ...(summary ? { summaryOfChanges: summary } : {}),
          ...(eff ? { effectiveAt: istDate(eff, "f-effectiveAt") } : {}),
          hiSummary: text(fd, "hiSummary") ?? null,
        });
        return done("Draft saved");
      });
    },
    async workflow(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const id = required(fd, "id", "a policy");
        switch (
          oneOf(fd, "op", [
            "submit",
            "dpo_approve",
            "approve",
            "request_changes",
            "publish_notice",
            "notice_sent",
            "mark_reviewed",
          ] as const)
        ) {
          case "submit":
            await policies.submit(ctx, id);
            return done("Submitted for approval");
          case "dpo_approve":
            await policies.dpoApprove(ctx, id);
            return done("DPO approval recorded");
          case "approve":
            await policies.approve(ctx, id);
            return done("Approved");
          case "request_changes":
            await policies.requestChanges(ctx, id, required(fd, "reason", "what needs to change"));
            return done("Changes requested; the version is back in draft");
          case "publish_notice":
            await policies.publishNotice(ctx, id);
            return done("Notice published", "The change now shows on the legal page.");
          case "notice_sent":
            await policies.recordNoticeSent(
              ctx,
              id,
              utc(required(fd, "sentAt", "when it was sent"), "f-sentAt")!,
            );
            return done("Send time recorded");
          case "mark_reviewed":
            await policies.markReviewed(ctx, id);
            return done("Marked as reviewed");
        }
      });
    },
  };
}
