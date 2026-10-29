// Saved table views and column layouts (IPB-07-13, @IPB-07-AT-08; Finbyx PR-FBX-09, R1-D-32).
// A view is one table's filters, sort and columns, kept for its owner (personal) or shared with a
// team, a set of roles or the tenant. Sharing follows `ux.tables.saved_views_shared`; a roles or
// tenant view, and the tenant default, are an ORG_ADMIN's or ORG_OWNER's to make. Only the owner
// edits a view (an ORG_ADMIN or ORG_OWNER also a roles or tenant one). Filter values that search
// refuses (IPB-07-17) are refused here too, so no shared view stores an Aadhaar number, a card
// number or a PAN. Every change goes through the mutation kernel and writes the ledger
// (`config/0002`, forced RLS: personal views and layouts are their owner's alone).
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { isPlatformRole } from "@infrabyx/contracts/roles";
import { searchRefusal } from "@infrabyx/contracts/search-refusal";
import { newId } from "@infrabyx/crypto";

export const SAVED_VIEW_ACTIONS = {
  create: "ux.saved_view.create",
  update: "ux.saved_view.update",
  delete: "ux.saved_view.delete",
  layout: "ux.table_layout.change",
} as const;

/** Who may share a view with roles or the whole tenant, and set the tenant default. */
export const VIEW_SHARE_ROLES: readonly string[] = ["ORG_OWNER", "ORG_ADMIN"];
/** Views one person may keep for one table. */
export const MAX_VIEWS_PER_TABLE = 50;
export const MAX_FILTERS = 50;
export const MAX_COLUMNS = 100;

export type ViewAudience =
  | { kind: "personal" }
  | { kind: "team"; teamId: string }
  | { kind: "roles"; roles: readonly string[] }
  | { kind: "tenant" };

export interface ViewState {
  filters: Readonly<Record<string, string>>;
  sort?: { column: string; direction: "ascending" | "descending" };
  /** Visible columns in order; absent means the table's own default. */
  columns?: readonly string[];
}

export interface SavedView extends ViewState {
  id: string;
  table: string;
  name: string;
  audience: ViewAudience;
  ownerId: string;
  isDefault: boolean;
  /** Whether the caller may change or delete it. */
  editable: boolean;
  version: number;
  updatedAt: string;
}

/** What the verified session says about the caller beyond the kernel context. */
export interface Viewer {
  /** Teams the caller belongs to, from the product's membership model. */
  teamIds?: readonly string[];
}

export interface TableLayout {
  table: string;
  columns: readonly string[];
  density: "compact" | "comfortable";
}

export interface SavedViewsOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** Reads `ux.tables.saved_views_shared` (default true when absent). */
  settings?: { get(ctx: KernelContext, key: "ux.tables.saved_views_shared"): Promise<boolean> };
}

export class SavedViewNotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super("saved view not found");
    this.name = "NotFoundError";
  }
}

export class SavedViewConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

const TABLE = /^[a-z0-9][a-z0-9_.-]{0,99}$/;
const FIELD = /^[A-Za-z0-9_.-]{1,64}$/;
const TEAM = /^[A-Za-z0-9_.:-]{1,64}$/;

interface Row {
  id: string;
  table_key: string;
  name: string;
  owner_id: string;
  audience: ViewAudience["kind"];
  team_id: string | null;
  roles: string[] | null;
  is_default: boolean;
  state: ViewState;
  version: number;
  updated_at: Date;
}

const COLS = `id, table_key, name, owner_id, audience, team_id, roles, is_default, state, version, updated_at`;

export class SavedViews {
  constructor(private readonly o: SavedViewsOptions) {}

  /** The caller's own views, then the shared views they are in the audience of. */
  async list(
    ctx: KernelContext,
    table: string,
    viewer: Viewer = {},
  ): Promise<{ personal: SavedView[]; shared: SavedView[] }> {
    assertUser(ctx);
    assertTable(table);
    const shared = await this.sharedEnabled(ctx);
    const rows = await this.o.kernel.read(ctx, (tx) =>
      tx.query<Row>(
        `select ${COLS} from config.saved_view where table_key = $1 order by is_default desc, name`,
        [table],
      ),
    );
    const views = rows.rows
      .filter((r) => r.owner_id === ctx.principal.id || (shared && inAudience(r, ctx, viewer)))
      .map((r) => toView(r, ctx));
    return {
      personal: views.filter((v) => v.ownerId === ctx.principal.id),
      shared: views.filter((v) => v.ownerId !== ctx.principal.id),
    };
  }

  /** The view a table opens with: the caller's default, else the tenant default, else none. */
  async defaultView(
    ctx: KernelContext,
    table: string,
    viewer: Viewer = {},
  ): Promise<SavedView | null> {
    const { personal, shared } = await this.list(ctx, table, viewer);
    return (
      personal.find((v) => v.isDefault && v.audience.kind === "personal") ??
      [...personal, ...shared].find((v) => v.isDefault && v.audience.kind === "tenant") ??
      null
    );
  }

  async get(ctx: KernelContext, id: string, viewer: Viewer = {}): Promise<SavedView> {
    assertUser(ctx);
    const shared = await this.sharedEnabled(ctx);
    const r = await this.o.kernel.read(ctx, (tx) =>
      tx.query<Row>(`select ${COLS} from config.saved_view where id = $1`, [id]),
    );
    const row = r.rows[0];
    if (!row || (row.owner_id !== ctx.principal.id && !(shared && inAudience(row, ctx, viewer))))
      throw new SavedViewNotFoundError();
    return toView(row, ctx);
  }

  async save(
    ctx: KernelContext,
    input: {
      table: string;
      name: string;
      audience?: ViewAudience;
      state: ViewState;
      isDefault?: boolean;
    },
    viewer: Viewer = {},
  ): Promise<SavedView> {
    assertUser(ctx);
    assertTable(input.table);
    const name = assertName(input.name);
    const audience = input.audience ?? { kind: "personal" };
    const state = assertState(input.state);
    await this.assertAudience(ctx, audience, viewer);
    const isDefault = input.isDefault ?? false;
    assertDefault(ctx, audience, isDefault);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const n = await tx.query<{ n: number }>(
          "select count(*)::int as n from config.saved_view where table_key = $1 and owner_id = $2",
          [input.table, ctx.principal.id],
        );
        if ((n.rows[0]?.n ?? 0) >= MAX_VIEWS_PER_TABLE)
          throw new RangeError(`at most ${MAX_VIEWS_PER_TABLE} saved views per table`);
        if (isDefault)
          await clearDefault(tx, this.o.audit, input.table, audience.kind, ctx.principal.id);
        const r = await tx
          .query<Row>(
            `insert into config.saved_view
               (id, tenant_id, table_key, name, owner_id, audience, team_id, roles, is_default, state, updated_by)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $5)
             returning ${COLS}`,
            [
              newId("svw"),
              ctx.tenantId,
              input.table,
              name,
              ctx.principal.id,
              audience.kind,
              audience.kind === "team" ? audience.teamId : null,
              audience.kind === "roles" ? [...new Set(audience.roles)] : null,
              isDefault,
              JSON.stringify(state),
            ],
          )
          .catch(uniqueName);
        const view = toView(r.rows[0]!, ctx);
        await this.o.audit.record(tx, {
          action: SAVED_VIEW_ACTIONS.create,
          resourceType: "saved_view",
          resourceId: view.id,
          after: ledgerForm(view),
        });
        return view;
      },
      { action: SAVED_VIEW_ACTIONS.create },
    );
  }

  /** Rename, change the state or the default; `version` must be the one the caller read. */
  async update(
    ctx: KernelContext,
    id: string,
    patch: { version: number; name?: string; state?: ViewState; isDefault?: boolean },
  ): Promise<SavedView> {
    assertUser(ctx);
    const name = patch.name === undefined ? undefined : assertName(patch.name);
    const state = patch.state === undefined ? undefined : assertState(patch.state);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const before = await this.editableRow(tx, ctx, id);
        if (before.version !== patch.version)
          throw new SavedViewConflictError(`saved view ${id} changed since it was read`);
        const audience = audienceOf(before);
        const isDefault = patch.isDefault ?? before.is_default;
        assertDefault(ctx, audience, isDefault);
        if (isDefault && !before.is_default)
          await clearDefault(tx, this.o.audit, before.table_key, audience.kind, before.owner_id);
        const r = await tx
          .query<Row>(
            `update config.saved_view
                set name = $2, state = $3::jsonb, is_default = $4, version = version + 1,
                    updated_at = now(), updated_by = $5
              where id = $1
              returning ${COLS}`,
            [
              id,
              name ?? before.name,
              JSON.stringify(state ?? before.state),
              isDefault,
              ctx.principal.id,
            ],
          )
          .catch(uniqueName);
        const view = toView(r.rows[0]!, ctx);
        await this.o.audit.record(tx, {
          action: SAVED_VIEW_ACTIONS.update,
          resourceType: "saved_view",
          resourceId: id,
          before: ledgerForm(toView(before, ctx)),
          after: ledgerForm(view),
        });
        return view;
      },
      { action: SAVED_VIEW_ACTIONS.update },
    );
  }

  async remove(ctx: KernelContext, id: string): Promise<void> {
    assertUser(ctx);
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const before = await this.editableRow(tx, ctx, id);
        await tx.query("delete from config.saved_view where id = $1", [id]);
        await this.o.audit.record(tx, {
          action: SAVED_VIEW_ACTIONS.delete,
          resourceType: "saved_view",
          resourceId: id,
          before: ledgerForm(toView(before, ctx)),
        });
      },
      { action: SAVED_VIEW_ACTIONS.delete },
    );
  }

  /** The caller's column chooser state for a table, or null for the table's default. */
  async layout(ctx: KernelContext, table: string): Promise<TableLayout | null> {
    assertUser(ctx);
    assertTable(table);
    const r = await this.o.kernel.read(ctx, (tx) =>
      tx.query<{ columns: string[]; density: TableLayout["density"] }>(
        "select columns, density from config.table_layout where user_id = $1 and table_key = $2",
        [ctx.principal.id, table],
      ),
    );
    const row = r.rows[0];
    return row ? { table, columns: row.columns, density: row.density } : null;
  }

  /** Store the caller's columns and density for a table; `null` returns it to the default. */
  async setLayout(
    ctx: KernelContext,
    table: string,
    layout: Omit<TableLayout, "table"> | null,
  ): Promise<void> {
    assertUser(ctx);
    assertTable(table);
    if (layout) {
      assertColumns(layout.columns);
      if (layout.density !== "compact" && layout.density !== "comfortable")
        throw new RangeError("density is compact or comfortable");
    }
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const prev = await tx.query<{ columns: string[]; density: string }>(
          `select columns, density from config.table_layout
            where user_id = $1 and table_key = $2 for update`,
          [ctx.principal.id, table],
        );
        if (layout)
          await tx.query(
            `insert into config.table_layout (tenant_id, user_id, table_key, columns, density)
             values ($1, $2, $3, $4, $5)
             on conflict (tenant_id, user_id, table_key)
               do update set columns = excluded.columns, density = excluded.density, updated_at = now()`,
            [ctx.tenantId, ctx.principal.id, table, [...layout.columns], layout.density],
          );
        else
          await tx.query("delete from config.table_layout where user_id = $1 and table_key = $2", [
            ctx.principal.id,
            table,
          ]);
        await this.o.audit.record(tx, {
          action: SAVED_VIEW_ACTIONS.layout,
          resourceType: "table_layout",
          resourceId: `${ctx.principal.id}:${table}`,
          before: prev.rows[0] ?? null,
          after: layout,
        });
      },
      { action: SAVED_VIEW_ACTIONS.layout },
    );
  }

  private async sharedEnabled(ctx: KernelContext): Promise<boolean> {
    return this.o.settings ? this.o.settings.get(ctx, "ux.tables.saved_views_shared") : true;
  }

  private async assertAudience(ctx: KernelContext, a: ViewAudience, viewer: Viewer): Promise<void> {
    if (a.kind === "personal") return;
    if (!(await this.sharedEnabled(ctx)))
      throw new IpbError("IPB-UX-011", {
        detail: "shared views are off for this tenant (ux.tables.saved_views_shared)",
      });
    if (a.kind === "team") {
      if (!TEAM.test(a.teamId)) throw new RangeError("invalid team id");
      if (!(viewer.teamIds ?? []).includes(a.teamId))
        throw new IpbError("IPB-UX-011", { detail: "a team view is shared by a team member" });
      return;
    }
    if (a.kind === "roles") {
      if (a.roles.length < 1 || a.roles.length > 10)
        throw new RangeError("a roles view names 1 to 10 roles");
      if (a.roles.some((r) => !/^[A-Z][A-Z0-9_]{1,63}$/.test(r) || !isTenantRole(r)))
        throw new RangeError("a view is shared with tenant roles only");
    }
    assertSharer(ctx);
  }

  private async editableRow(tx: Tx, ctx: KernelContext, id: string): Promise<Row> {
    const r = await tx.query<Row>(
      `select ${COLS} from config.saved_view where id = $1 for update`,
      [id],
    );
    const row = r.rows[0];
    if (!row) throw new SavedViewNotFoundError();
    if (!canEdit(row, ctx)) {
      // A view the caller cannot see is not disclosed (IPB-02-14).
      if (row.owner_id !== ctx.principal.id && row.audience === "personal")
        throw new SavedViewNotFoundError();
      throw new IpbError("IPB-UX-011", { detail: "only the owner changes this view" });
    }
    return row;
  }
}

/** Platform staff, agents and service readers are never an audience. */
const isTenantRole = (r: string) => !isPlatformRole(r) && !/^(PLT|AGT|SVC)_/.test(r);

function assertUser(ctx: KernelContext): void {
  if (ctx.scope === "platform" || ctx.principal.type !== "user")
    throw new IpbError("IPB-SEC-005", { detail: "saved views belong to the tenant's named users" });
}

function assertSharer(ctx: KernelContext): void {
  if (!ctx.principal.roles.some((r) => VIEW_SHARE_ROLES.includes(r)))
    throw new IpbError("IPB-UX-011", { detail: `needs one of ${VIEW_SHARE_ROLES.join(", ")}` });
}

function assertDefault(ctx: KernelContext, a: ViewAudience, isDefault: boolean): void {
  if (!isDefault) return;
  if (a.kind !== "personal" && a.kind !== "tenant")
    throw new RangeError("only a personal or a tenant view can be a default");
  if (a.kind === "tenant") assertSharer(ctx);
}

function assertTable(table: string): void {
  if (!TABLE.test(table)) throw new RangeError(`invalid table key ${JSON.stringify(table)}`);
}

function assertName(name: string): string {
  const n = name.trim();
  if (n.length < 1 || n.length > 80) throw new RangeError("a view name is 1 to 80 characters");
  if (searchRefusal(n)) throw new IpbError("IPB-UX-003", { detail: "view name" });
  return n;
}

function assertColumns(columns: readonly string[]): void {
  if (columns.length > MAX_COLUMNS) throw new RangeError(`at most ${MAX_COLUMNS} columns`);
  if (columns.some((c) => !FIELD.test(c))) throw new RangeError("invalid column key");
  if (new Set(columns).size !== columns.length) throw new RangeError("a column is listed twice");
}

/** The state as stored: known fields only, bounded, and no refused identifier in a value. */
function assertState(s: ViewState): ViewState {
  const entries = Object.entries(s.filters ?? {});
  if (entries.length > MAX_FILTERS) throw new RangeError(`at most ${MAX_FILTERS} filters`);
  for (const [k, v] of entries) {
    if (!FIELD.test(k)) throw new RangeError("invalid filter key");
    if (typeof v !== "string" || v.length > 500)
      throw new RangeError("a filter value is text of at most 500 characters");
    // The pattern class only: the value itself is not repeated (IPB-07-17).
    const refused = searchRefusal(v);
    if (refused)
      throw new IpbError("IPB-UX-003", { meta: { pattern_class: refused.patternClass } });
  }
  const out: ViewState = { filters: Object.fromEntries(entries) };
  if (s.sort) {
    if (!FIELD.test(s.sort.column)) throw new RangeError("invalid sort column");
    if (s.sort.direction !== "ascending" && s.sort.direction !== "descending")
      throw new RangeError("sort direction is ascending or descending");
    out.sort = { column: s.sort.column, direction: s.sort.direction };
  }
  if (s.columns) {
    assertColumns(s.columns);
    out.columns = [...s.columns];
  }
  return out;
}

function audienceOf(r: Row): ViewAudience {
  switch (r.audience) {
    case "team":
      return { kind: "team", teamId: r.team_id! };
    case "roles":
      return { kind: "roles", roles: r.roles ?? [] };
    default:
      return { kind: r.audience };
  }
}

function inAudience(r: Row, ctx: KernelContext, viewer: Viewer): boolean {
  switch (r.audience) {
    case "tenant":
      return true;
    case "roles":
      return (r.roles ?? []).some((role) => ctx.principal.roles.includes(role));
    case "team":
      return (viewer.teamIds ?? []).includes(r.team_id ?? "");
    default:
      return false;
  }
}

function canEdit(r: Row, ctx: KernelContext): boolean {
  if (r.owner_id === ctx.principal.id) return true;
  return (
    (r.audience === "roles" || r.audience === "tenant") &&
    ctx.principal.roles.some((x) => VIEW_SHARE_ROLES.includes(x))
  );
}

function toView(r: Row, ctx: KernelContext): SavedView {
  return {
    id: r.id,
    table: r.table_key,
    name: r.name,
    audience: audienceOf(r),
    ownerId: r.owner_id,
    isDefault: r.is_default,
    editable: canEdit(r, ctx),
    version: r.version,
    updatedAt: new Date(r.updated_at).toISOString(),
    filters: r.state.filters ?? {},
    ...(r.state.sort ? { sort: r.state.sort } : {}),
    ...(r.state.columns ? { columns: r.state.columns } : {}),
  };
}

const ledgerForm = (v: SavedView) => ({
  table: v.table,
  name: v.name,
  audience: v.audience,
  is_default: v.isDefault,
  filters: v.filters,
  sort: v.sort ?? null,
  columns: v.columns ?? null,
});

/** Unset the default this one replaces, with a ledger entry for each view changed. */
async function clearDefault(
  tx: Tx,
  audit: AuditSink,
  table: string,
  kind: ViewAudience["kind"],
  ownerId: string,
): Promise<void> {
  const r =
    kind === "personal"
      ? await tx.query<{ id: string }>(
          `update config.saved_view set is_default = false, version = version + 1, updated_at = now(),
                  updated_by = $2
            where table_key = $1 and owner_id = $2 and audience = 'personal' and is_default
            returning id`,
          [table, ownerId],
        )
      : await tx.query<{ id: string }>(
          `update config.saved_view set is_default = false, version = version + 1, updated_at = now(),
                  updated_by = current_setting('app.actor_id', true)
            where table_key = $1 and audience = 'tenant' and is_default
            returning id`,
          [table],
        );
  for (const { id } of r.rows)
    await audit.record(tx, {
      action: SAVED_VIEW_ACTIONS.update,
      resourceType: "saved_view",
      resourceId: id,
      before: { is_default: true },
      after: { is_default: false },
    });
}

function uniqueName(e: unknown): never {
  if ((e as { code?: string }).code === "23505")
    throw new SavedViewConflictError("a view of this table already has that name, or a default");
  throw e;
}
