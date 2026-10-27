// The approvals queue and the preview links (IPB-04-100): what waits for a checker or the legal
// reviewer across content, brand packs and redirects, and the drafts that can be previewed.
import { Button } from "../components/forms.js";
import { DataTable } from "../components/data.js";
import type { BrandReader, StudioBrandRevision } from "./brand.js";
import type { ContentReader, PackOption } from "./content.js";
import { Hidden, StatusBadge, StudioPage, studioPath, type StudioSection } from "./layout.js";
import type { RedirectReader } from "./redirects.js";
import { isIpbError } from "@infrabyx/contracts/errors";
import type { StudioConsentText } from "./consent.js";
import type { PolicyReader } from "./policies.js";
import type { FormAction, ScreenProps } from "./types.js";

/** A queue the viewer's roles do not cover is left out (the service refuses it with IPB-UX-011). */
async function ifAllowed<T>(p: Promise<T[]>): Promise<T[]> {
  try {
    return await p;
  } catch (e) {
    if (isIpbError(e) && e.code === "IPB-UX-011") return [];
    throw e;
  }
}

/** Which section edits each content type (the reference console's layout). */
export const CONTENT_SECTION_TYPES = {
  pages: [
    "page",
    "section",
    "group_company",
    "job",
    "faq",
    "glossary_term",
    "team_member",
    "press_item",
  ],
  menus: ["nav_menu"],
  footer: ["footer", "office"],
  pricing: ["pricing_copy"],
  resources: ["resource"],
  forms: ["form"],
} as const satisfies Partial<Record<StudioSection, readonly string[]>>;

export const sectionOfType = (type: string): StudioSection =>
  (Object.entries(CONTENT_SECTION_TYPES).find(([, types]) =>
    (types as readonly string[]).includes(type),
  )?.[0] as StudioSection | undefined) ?? "pages";

export interface BrandQueueReader<C> extends BrandReader<C> {
  pending(ctx: C): Promise<StudioBrandRevision[]>;
}

export async function ApprovalsScreen<C>(
  p: ScreenProps<C> & {
    cms: ContentReader<C> & RedirectReader<C>;
    brand: BrandQueueReader<C>;
    packs: readonly PackOption[];
    /** Policy versions waiting for the DPO or a checker. */
    policies?: Pick<PolicyReader<C>, "setFor" | "instances">;
    /** Consent texts waiting for the legal reviewer. */
    texts?: { drafts(ctx: C): Promise<StudioConsentText[]> };
  },
) {
  const policySets = p.policies
    ? (
        await Promise.all(
          p.packs.map(async (k) => ({ pack: k, set: await p.policies!.setFor(p.ctx, k.id) })),
        )
      ).filter((x) => x.set)
    : [];
  const [inReview, inLegal, brandPending, redirects, submittedPolicies, textDrafts] =
    await Promise.all([
      p.cms.list(p.ctx, { status: "in_review" }),
      p.cms.list(p.ctx, { status: "legal_review" }),
      p.brand.pending(p.ctx),
      Promise.all(
        p.packs.map(async (k) =>
          (await p.cms.redirects(p.ctx, k.id, { state: "pending" })).map((r) => ({
            ...r,
            pack: k,
          })),
        ),
      ).then((x) => x.flat()),
      Promise.all(
        policySets.map(async ({ pack, set }) =>
          (await p.policies!.instances(p.ctx, set!.id))
            .filter((v) => v.state === "submitted")
            .map((v) => ({ ...v, pack })),
        ),
      ).then((x) => x.flat()),
      p.texts ? ifAllowed(p.texts.drafts(p.ctx)) : Promise.resolve([]),
    ]);
  const packLabel = (id: string) => p.packs.find((k) => k.id === id)?.label ?? id;
  const rows = [
    ...[...inLegal, ...inReview].map((i) => ({
      what: (
        <a href={studioPath(p.base, sectionOfType(i.type), i.id)}>
          {i.title} ({i.type.replace(/_/g, " ")})
        </a>
      ),
      pack: packLabel(i.packId),
      waits: i.status === "legal_review" ? "Legal reviewer" : "Checker",
      status: <StatusBadge status={i.status} />,
    })),
    ...brandPending.map((r) => ({
      what: <a href={studioPath(p.base, "brand", r.packId)}>Brand pack revision {r.id}</a>,
      pack: packLabel(r.packId),
      waits: r.legalReviewRequired && !r.legalReviewerId ? "Legal reviewer and checker" : "Checker",
      status: <StatusBadge status={r.status} />,
    })),
    ...redirects.map((r) => ({
      what: (
        <a href={`${studioPath(p.base, "redirects")}?pack=${encodeURIComponent(r.pack.id)}`}>
          Redirect {r.from}
        </a>
      ),
      pack: r.pack.label,
      waits: [r.checkerId ? null : "Checker", r.legalReviewerId ? null : "Legal reviewer"]
        .filter(Boolean)
        .join(" and "),
      status: <StatusBadge status={r.state} />,
    })),
    ...submittedPolicies.map((v) => ({
      what: (
        <a href={studioPath(p.base, "policies", v.id)}>
          {v.title} {v.versionLabel}
        </a>
      ),
      pack: v.pack.label,
      waits: v.privacyClass && !v.dpoId ? "DPO and checker" : "Checker",
      status: <StatusBadge status={v.state} />,
    })),
    ...textDrafts.map((t) => ({
      what: (
        <a href={studioPath(p.base, "consent")}>
          Consent text {t.key} {t.version} ({t.region})
        </a>
      ),
      pack: "All packs",
      waits: "Legal reviewer",
      status: <StatusBadge status={t.state} />,
    })),
  ];
  return (
    <StudioPage
      base={p.base}
      section="approvals"
      title="Approvals"
      flash={p.flash}
      errors={p.errors}
    >
      {rows.length ? (
        <DataTable
          caption={`Waiting for approval: ${rows.length}`}
          columns={[
            { key: "what", header: "Item", rowHeader: true },
            { key: "pack", header: "Pack" },
            { key: "waits", header: "Waiting for" },
            { key: "status", header: "Status" },
          ]}
          rows={rows}
        />
      ) : (
        <p>Nothing is waiting for approval.</p>
      )}
    </StudioPage>
  );
}

const PREVIEWABLE = ["draft", "in_review", "legal_review", "approved", "scheduled"] as const;

export async function PreviewsScreen<C>(
  p: ScreenProps<C> & {
    cms: ContentReader<C>;
    packs: readonly PackOption[];
    actions: { preview: FormAction };
    reveal?: string | undefined;
  },
) {
  const items = (
    await Promise.all(PREVIEWABLE.map((status) => p.cms.list(p.ctx, { status })))
  ).flat();
  const packLabel = (id: string) => p.packs.find((k) => k.id === id)?.label ?? id;
  return (
    <StudioPage
      base={p.base}
      section="previews"
      title="Preview links"
      flash={p.flash}
      errors={p.errors}
      reveal={p.reveal}
    >
      <p>
        A preview link shows an unpublished item to anyone who has it, until it expires. Revoke
        links you no longer need.
      </p>
      <DataTable
        caption={`Unpublished items: ${items.length}`}
        columns={[
          { key: "title", header: "Item", rowHeader: true },
          { key: "pack", header: "Pack" },
          { key: "status", header: "Status" },
          { key: "action", header: "Action" },
        ]}
        rows={items.map((i) => ({
          title: <a href={studioPath(p.base, sectionOfType(i.type), i.id)}>{i.title}</a>,
          pack: packLabel(i.packId),
          status: <StatusBadge status={i.status} />,
          action: (
            <>
              <form method="post" action={p.actions.preview}>
                <Hidden values={{ itemId: i.id, op: "create" }} />
                <Button type="submit" variant="ghost">
                  Create a link for {i.title}
                </Button>
              </form>
              <form method="post" action={p.actions.preview}>
                <Hidden values={{ itemId: i.id, op: "revoke" }} />
                <Button type="submit" variant="ghost">
                  Revoke links for {i.title}
                </Button>
              </form>
            </>
          ),
        }))}
      />
    </StudioPage>
  );
}
