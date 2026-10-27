// The approvals queue and the preview links (IPB-04-100): what waits for a checker or the legal
// reviewer across content, brand packs and redirects, and the drafts that can be previewed.
import { Button } from "../components/forms.js";
import { DataTable } from "../components/data.js";
import type { BrandReader, StudioBrandRevision } from "./brand.js";
import type { ContentReader, PackOption } from "./content.js";
import { Hidden, StatusBadge, StudioPage, studioPath, type StudioSection } from "./layout.js";
import type { RedirectReader } from "./redirects.js";
import type { FormAction, ScreenProps } from "./types.js";

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
  },
) {
  const [inReview, inLegal, brandPending, redirects] = await Promise.all([
    p.cms.list(p.ctx, { status: "in_review" }),
    p.cms.list(p.ctx, { status: "legal_review" }),
    p.brand.pending(p.ctx),
    Promise.all(
      p.packs.map(async (k) =>
        (await p.cms.redirects(p.ctx, k.id, { state: "pending" })).map((r) => ({ ...r, pack: k })),
      ),
    ).then((x) => x.flat()),
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
