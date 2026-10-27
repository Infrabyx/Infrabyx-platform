// Read-only Studio sections: the feedback queue (triage happens in Operations Hub; IPB-04 §04.3.11,
// IPB-06-62), the trust documents mirror (written only by the OH feed, IPB-08) and the pricing
// catalogue (prices come from BILLING_PORT, never typed in Studio; IPB-04-33). Pricing copy is
// content, edited through the content screens.
import type { Catalogue } from "@infrabyx/contracts/ports";
import { isIpbError } from "@infrabyx/contracts/errors";
import { Button, SelectField } from "../components/forms.js";
import { DataTable } from "../components/data.js";
import { Notice } from "../components/status.js";
import { formatAmountInr } from "../i18n/format.js";
import { required, run, when } from "./form.js";
import { PackPicker, type ContentReader, type PackOption } from "./content.js";
import { Hidden, StatusBadge, StudioPage, StudioSectionBox, studioPath } from "./layout.js";
import type { FormAction, ScreenProps, StudioResult } from "./types.js";

export interface StudioFeedbackItem {
  id: string;
  type: string;
  category: string;
  summary: string;
  route: string | null;
  severity: string | null;
  status: string;
  ohRef: string | null;
  priority: string | null;
  regulatedStep: boolean;
  ackDueAt: Date | null;
  fixDueAt: Date | null;
  slaBreaches: readonly string[];
  submittedAt: Date;
}

export interface FeedbackQueueReader<C> {
  queue(ctx: C, f?: { type?: string; open?: boolean }): Promise<StudioFeedbackItem[]>;
}

const TYPES = ["bug", "idea", "praise", "nps", "accessibility", "help_content"] as const;

export async function FeedbackScreen<C>(
  p: ScreenProps<C> & {
    feedback: FeedbackQueueReader<C>;
    type?: string | undefined;
    open?: boolean | undefined;
  },
) {
  const type = TYPES.find((t) => t === p.type);
  const items = await p.feedback.queue(p.ctx, {
    ...(type ? { type } : {}),
    ...(p.open ? { open: true } : {}),
  });
  return (
    <StudioPage
      sections={p.sections}
      base={p.base}
      section="feedback"
      title="Feedback"
      flash={p.flash}
      errors={p.errors}
    >
      <p>Triage and replies happen in Operations Hub; this list follows its status.</p>
      <form method="get" action={studioPath(p.base, "feedback")} className="ibx-studio__filter">
        <SelectField
          id="f-type"
          name="type"
          label="Type"
          helpKey="hlp.studio.feedback_type"
          options={[
            { value: "", label: "All types" },
            ...TYPES.map((t) => ({ value: t, label: t })),
          ]}
          defaultValue={type ?? ""}
        />
        <SelectField
          id="f-open"
          name="open"
          label="Show"
          helpKey="hlp.studio.feedback_open"
          options={[
            { value: "", label: "All items" },
            { value: "1", label: "Open items only" },
          ]}
          defaultValue={p.open ? "1" : ""}
        />
        <Button type="submit">Show</Button>
      </form>
      <DataTable
        caption={`Feedback: ${items.length}`}
        columns={[
          { key: "summary", header: "Summary", rowHeader: true },
          { key: "type", header: "Type" },
          { key: "status", header: "Status" },
          { key: "ref", header: "OH reference" },
          { key: "sla", header: "Accessibility timers" },
          { key: "at", header: "Received" },
        ]}
        rows={items.map((i) => ({
          summary: i.summary,
          type: `${i.type}${i.route ? ` on ${i.route}` : ""}`,
          status: <StatusBadge status={i.status} />,
          ref: i.ohRef ?? "Not handed off yet",
          sla:
            i.type === "accessibility"
              ? [
                  i.priority ? `${i.priority}${i.regulatedStep ? ", regulated step" : ""}` : null,
                  i.ackDueAt ? `acknowledge by ${when(i.ackDueAt, true)}` : null,
                  i.fixDueAt ? `fix by ${when(i.fixDueAt)}` : null,
                  i.slaBreaches.length ? `missed: ${i.slaBreaches.join(", ")}` : null,
                ]
                  .filter(Boolean)
                  .join("; ")
              : "—",
          at: when(i.submittedAt, true),
        }))}
      />
    </StudioPage>
  );
}

export interface StudioMirrorRow {
  vad_id: string;
  version: number;
  title: string;
  category: string;
  visibility: string;
  nda_required: boolean;
  valid_from: string;
  valid_until: string | null;
  mirror_state: string;
  digest_mismatch_at: Date | null;
  synced_at: Date;
}

export interface TrustMirrorReader {
  rows(): Promise<StudioMirrorRow[]>;
  staleness(): Promise<{ asOf: string | null; stale: boolean }>;
}

export async function TrustDocumentsScreen<C>(p: ScreenProps<C> & { trust: TrustMirrorReader }) {
  const [rows, s] = await Promise.all([p.trust.rows(), p.trust.staleness()]);
  return (
    <StudioPage
      sections={p.sections}
      base={p.base}
      section="trust"
      title="Trust documents"
      flash={p.flash}
      errors={p.errors}
    >
      <p>
        A read-only copy of the documents Operations Hub publishes. Change them in Operations Hub.
      </p>
      {s.stale ? (
        <Notice tone="warning" title="The copy is out of date">
          <p>Last synced {s.asOf ? when(s.asOf, true) : "never"}.</p>
        </Notice>
      ) : (
        <p>Last synced {s.asOf ? when(s.asOf, true) : "never"}.</p>
      )}
      <DataTable
        caption={`Trust documents: ${rows.length}`}
        columns={[
          { key: "title", header: "Document", rowHeader: true },
          { key: "version", header: "Version", numeric: true },
          { key: "visibility", header: "Who can see it" },
          { key: "valid", header: "Valid" },
          { key: "state", header: "State" },
        ]}
        rows={rows.map((r) => ({
          title: `${r.title} (${r.category})`,
          version: r.version,
          visibility: `${r.visibility}${r.nda_required ? ", under NDA" : ""}`,
          valid: `${r.valid_from}${r.valid_until ? ` to ${r.valid_until}` : ""}`,
          state: (
            <>
              <StatusBadge status={r.mirror_state} />
              {r.digest_mismatch_at ? " Digest mismatch" : ""}
            </>
          ),
        }))}
      />
    </StudioPage>
  );
}

const price = (x: Catalogue["plans"][number]["prices"][number]) =>
  `${x.currency === "INR" ? formatAmountInr(x.amount_minor) : `${x.currency} ${(x.amount_minor / 100).toFixed(2)}`} per ${x.period.replace("_", " ")}${x.gst_rate_bp !== null ? `, GST ${x.gst_rate_bp / 100}% ${x.tax_inclusive ? "included" : "extra"}` : ""}`;

export async function PricingScreen<C>(
  p: ScreenProps<C> & {
    catalogue: (packId: string) => Promise<Catalogue>;
    cms: ContentReader<C>;
    packs: readonly PackOption[];
    packId: string;
  },
) {
  let cat: Catalogue | null = null;
  let unavailable: string | null = null;
  try {
    cat = await p.catalogue(p.packId);
  } catch (e) {
    if (!isIpbError(e)) throw e;
    unavailable = e.detail ?? e.def.title;
  }
  const copy = await p.cms.list(p.ctx, { packId: p.packId, type: "pricing_copy" });
  return (
    <StudioPage
      sections={p.sections}
      base={p.base}
      section="pricing"
      title="Pricing"
      flash={p.flash}
      errors={p.errors}
    >
      <PackPicker packs={p.packs} packId={p.packId} action={studioPath(p.base, "pricing")} />
      <p>Prices come from billing and cannot be typed here. Edit the words around them below.</p>
      {unavailable ? (
        <Notice tone="warning" title="The price list is unavailable">
          <p>{unavailable}</p>
        </Notice>
      ) : cat ? (
        <DataTable
          caption={`Plans (price list ${cat.catalogue_version}, fetched ${when(cat.fetched_at, true)})`}
          columns={[
            { key: "plan", header: "Plan", rowHeader: true },
            { key: "prices", header: "Prices" },
            { key: "trial", header: "Trial" },
          ]}
          rows={cat.plans.map((pl) => ({
            plan: pl.name,
            prices: pl.prices.map(price).join("; ") || "—",
            trial: pl.trial_days ? `${pl.trial_days} days` : "None",
          }))}
        />
      ) : null}
      <StudioSectionBox id="copy" title="Pricing copy">
        {copy.length ? (
          <ul>
            {copy.map((i) => (
              <li key={i.id}>
                <a href={studioPath(p.base, "pricing", i.id)}>{i.title}</a> (
                <StatusBadge status={i.status} />)
              </li>
            ))}
          </ul>
        ) : (
          <p>No pricing copy yet.</p>
        )}
      </StudioSectionBox>
    </StudioPage>
  );
}

export interface ResourceVersionsReader {
  view(
    packId: string,
    resourceId: string,
  ): Promise<{
    current: string;
    versions: readonly { version: string; publishedAt: string; withdrawn: boolean }[];
  }>;
}

export interface ResourceVersionsWriter<C> {
  withdrawVersion(ctx: C, resourceId: string, version: string): Promise<void>;
}

/** A published resource's file versions, shown inside its editor (`ContentEditScreen` `extra`). */
export async function ResourceVersionsPanel(p: {
  resources: ResourceVersionsReader;
  packId: string;
  itemId: string;
  actions: { withdraw: FormAction };
}) {
  let v: Awaited<ReturnType<ResourceVersionsReader["view"]>> | null = null;
  try {
    v = await p.resources.view(p.packId, p.itemId);
  } catch (e) {
    if (!isIpbError(e) && !(e instanceof Error && e.name === "NotFoundError")) throw e;
  }
  return (
    <StudioSectionBox id="versions" title="File versions">
      {!v ? (
        <p>File versions appear once the resource is published.</p>
      ) : (
        <DataTable
          caption={`Versions (current ${v.current})`}
          columns={[
            { key: "version", header: "Version", rowHeader: true },
            { key: "at", header: "Published" },
            { key: "action", header: "Action" },
          ]}
          rows={v.versions.map((x) => ({
            version: x.version,
            at: when(x.publishedAt),
            action: x.withdrawn ? (
              "Withdrawn"
            ) : (
              <form method="post" action={p.actions.withdraw}>
                <Hidden values={{ resourceId: p.itemId, version: x.version }} />
                <Button type="submit" variant="danger">
                  Withdraw version {x.version}
                </Button>
              </form>
            ),
          }))}
        />
      )}
    </StudioSectionBox>
  );
}

export function resourceHandlers<C>(resources: ResourceVersionsWriter<C>) {
  return {
    async withdraw(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const version = required(fd, "version", "a version");
        await resources.withdrawVersion(ctx, required(fd, "resourceId", "a resource"), version);
        return {
          flash: {
            tone: "success",
            title: `Version ${version} withdrawn`,
            detail: "Its download links stop working.",
          },
        };
      });
    },
  };
}
