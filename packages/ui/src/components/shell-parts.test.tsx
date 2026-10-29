// The application shell parts of Finbyx PR-FBX-09 (R1-D-32): search and the palette
// (@IPB-07-AT-03), the workspace switcher, page states and templates (IPB-07-11, -12, -24), the
// column chooser and view picker (@IPB-07-AT-08) and the keyboard map (IPB-06-29).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  applyColumns,
  ApprovalQueuePage,
  checkQuery,
  ColumnChooser,
  CommandPalette,
  DashboardPage,
  DataTable,
  DetailPage,
  EmptyState,
  ErrorState,
  globalSearch,
  KeyboardMap,
  ListPage,
  messages,
  moveColumn,
  paletteEvent,
  PermissionDenied,
  resolveWorkspace,
  SavedViewPicker,
  Skeleton,
  staticProvider,
  WizardPage,
  WorkspaceSwitcher,
  type SearchProvider,
} from "../index.js";
import { BASE_MESSAGE_KEYS, baseCatalogue } from "../i18n/messages.js";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
type Ctx = { roles: readonly string[] };

describe("@IPB-07-AT-03 palette search refuses protected patterns", () => {
  it.each([
    ["2345 6789 0123", "aadhaar_pattern"],
    ["ABCDE1234F", "pan_pattern"],
    ["4111 1111 1111 1111", "card_pattern"],
  ])("refuses %s before any provider runs, and the event holds no query text", async (q, cls) => {
    const search = vi.fn(async () => []);
    const r = await globalSearch<Ctx>(q, { roles: [] }, [{ id: "x", label: "X", search }]);
    expect(r).toMatchObject({ status: "refused", code: "IPB-UX-003", patternClass: cls });
    expect(search).not.toHaveBeenCalled();
    const ev = paletteEvent(r);
    expect(ev).toEqual({ event: "palette.search", outcome: "refused", pattern_class: cls });
    expect(JSON.stringify([r, ev])).not.toContain(q);
    const out = html(<CommandPalette action="/search" result={r} query={q} />);
    expect(out).toContain("Search by name or reference instead.");
    expect(out).toContain("IPB-UX-003");
    expect(out).not.toContain(q);
    expect(out).toContain('method="post"');
  });

  it("asks for three characters and caps the length", () => {
    expect(checkQuery("ab")).toMatchObject({ ok: false, code: "too_short" });
    expect(checkQuery("x".repeat(201))).toMatchObject({ ok: false, code: "too_long" });
    expect(checkQuery("  loan ")).toEqual({ ok: true, query: "loan" });
  });

  it("returns only what providers trim to, grouped, capped, and survives a failing provider", async () => {
    const pages = staticProvider<Ctx>("pages", "Pages", (c) => [
      { label: "Loans", href: "/loans" },
      ...(c.roles.includes("ORG_ADMIN")
        ? [{ label: "Loan settings", href: "/settings/loans" }]
        : []),
    ]);
    const broken: SearchProvider<Ctx> = {
      id: "records",
      label: "Records",
      search: async () => {
        throw new Error("index down for query loan");
      },
    };
    const member = await globalSearch<Ctx>("loan", { roles: ["ORG_MEMBER"] }, [pages, broken]);
    expect(member).toEqual({
      status: "ok",
      groups: [{ id: "pages", label: "Pages", hits: [{ label: "Loans", href: "/loans" }] }],
      failed: ["records"],
    });
    expect(paletteEvent(member)).toEqual({
      event: "palette.search",
      outcome: "ok",
      result_count: 1,
      failed_providers: 1,
    });
    const many = staticProvider<Ctx>("m", "Many", () =>
      Array.from({ length: 30 }, (_, i) => ({ label: `Loan ${i}`, href: `/l/${i}` })),
    );
    const capped = await globalSearch<Ctx>("loan", { roles: [] }, [many, many], { total: 7 });
    expect(capped.status === "ok" && capped.groups.map((g) => g.hits.length)).toEqual([5, 2]);
    const out = html(<CommandPalette action="/search" result={member} query="loan" />);
    expect(out).toContain('value="loan"');
    expect(out).toContain("<h2");
    expect(out).toContain("1 result");
    expect(out).toContain("incomplete");
  });

  it("times out a slow provider", async () => {
    const slow: SearchProvider<Ctx> = {
      id: "slow",
      label: "Slow",
      search: () => new Promise(() => {}),
    };
    const r = await globalSearch<Ctx>("loan", { roles: [] }, [slow], { timeoutMs: 10 });
    expect(r).toEqual({ status: "ok", groups: [], failed: ["slow"] });
  });
});

describe("workspace switcher", () => {
  const ws = [
    { key: "M", label: "Management", href: "/ws/M" },
    { key: "N", label: "Tenant Administration", href: "/ws/N" },
  ];
  it("honours a remembered workspace only while it is assigned", () => {
    expect(resolveWorkspace(ws, "N")?.key).toBe("N");
    expect(resolveWorkspace(ws, "C")?.key).toBe("M");
    expect(resolveWorkspace([], "N")).toBeNull();
  });
  it("lists the assigned ones with the current marked; says so when none", () => {
    const out = html(<WorkspaceSwitcher assigned={ws} current={ws[1]!} />);
    expect(out).toContain("<details");
    expect(out).toContain('<a href="/ws/N" aria-current="true">Tenant Administration</a>');
    expect(html(<WorkspaceSwitcher assigned={[]} current={null} />)).toContain(
      "No workspace is assigned to you yet.",
    );
    expect(html(<WorkspaceSwitcher assigned={[ws[0]!]} current={ws[0]!} />)).not.toContain(
      "<details",
    );
  });
});

describe("page states and templates (IPB-07-11, IPB-07-12, IPB-07-24)", () => {
  it("teaches in the empty state and offers to clear filters when filtered", () => {
    const out = html(
      <EmptyState
        purpose="Loans you originate appear here."
        action={{ label: "Create loan", href: "/loans/new" }}
        tutorial={{ label: "How lending works", href: "/help/loans" }}
        sampleData={{ label: "Show sample data", href: "?sample=1" }}
      />,
    );
    for (const s of ["Loans you originate appear here.", "/loans/new", "/help/loans", "?sample=1"])
      expect(out).toContain(s);
    expect(html(<EmptyState purpose="x" clearFiltersHref="/loans" />)).toContain("Clear filters");
  });

  it("loads with a skeleton, not a spinner", () => {
    const out = html(<Skeleton rows={3} />);
    expect(out).toContain('aria-busy="true"');
    expect(out.match(/ibx-skeleton__line/g)).toHaveLength(3);
    expect(out).not.toMatch(/spinner/i);
  });

  it("says what failed, whether it saved, the reference and how to retry; and why access is denied", () => {
    const out = html(
      <ErrorState
        whatFailed="The loan list could not be loaded."
        saved="unknown"
        correlationId="trc_01"
        retry={{ label: "Try again", href: "/loans" }}
      />,
    );
    expect(out).toContain('role="alert"');
    expect(out).toContain("Check before you try again.");
    expect(out).toContain("trc_01");
    expect(out).toContain("Try again");
    const denied = html(
      <PermissionDenied
        code="IPB-SEC-005"
        reason="Loans are open to the credit team."
        fix={{ label: "Ask an administrator", href: "/settings/people" }}
      />,
    );
    expect(denied).toContain("IPB-SEC-005");
    expect(denied).toContain("/settings/people");
  });

  it("frames each template with one h1, one primary action, and its state", () => {
    const list = html(
      <ListPage
        title="Loans"
        primaryAction={{ label: "Create loan", href: "/loans/new" }}
        toolbar={<p>filters</p>}
        state={{ kind: "loading" }}
      >
        <p>table</p>
      </ListPage>,
    );
    expect(list.match(/<h1/g)).toHaveLength(1);
    expect(list.match(/ibx-button--primary/g)).toHaveLength(1);
    expect(list).toContain('id="filters"');
    expect(list).toContain('aria-busy="true"');
    expect(list).not.toContain("<p>table</p>");
    const denied = html(
      <DetailPage
        title="Loan LN-1"
        primaryAction={{ label: "Edit", href: "/e" }}
        state={{ kind: "denied", code: "IPB-SEC-005", reason: "r" }}
      />,
    );
    expect(denied).not.toContain('href="/e"');
    const detail = html(
      <DetailPage title="Loan LN-1" facts={[{ label: "Amount", value: "₹1,00,000" }]} />,
    );
    expect(detail).toContain("<dt>Amount</dt>");
    const wizard = html(
      <WizardPage title="New loan" steps={["Borrower", "Terms", "Review"]} current={1} />,
    );
    expect(wizard).toContain('aria-current="step"');
    expect(wizard).toContain("Step 2 of 3: Terms");
    expect(() => html(<WizardPage title="x" steps={["a"]} current={1} />)).toThrow(RangeError);
    const queue = html(
      <ApprovalQueuePage
        title="Approvals"
        items={[
          {
            id: "apr_1",
            summary: "Disburse LN-1",
            maker: "Asha",
            submitted: "29 Oct",
            href: "/apr/1",
          },
        ]}
      />,
    );
    expect(queue).toContain('<th scope="row"><a href="/apr/1">Disburse LN-1</a></th>');
    const empty = html(
      <ApprovalQueuePage
        title="Approvals"
        items={[]}
        state={{ kind: "empty", purpose: "Requests awaiting you." }}
      />,
    );
    expect(empty).toContain("Requests awaiting you.");
  });

  it("refuses a dashboard widget without an evidence class (IPB-UX-009) and badges AI", () => {
    const out = html(
      <DashboardPage
        title="Home"
        widgets={[
          {
            id: "a",
            title: "Disbursed",
            body: <p>₹10</p>,
            evidence: { class: "LEDGER", href: "/l" },
          },
          { id: "b", title: "Risk", body: <p>low</p>, evidence: { class: "AI", href: "/run/1" } },
        ]}
      />,
    );
    expect(out).toContain("Source: ledger");
    expect(out).toContain("AI-generated");
    expect(() =>
      html(<DashboardPage title="Home" widgets={[{ id: "c", title: "x", body: null } as never]} />),
    ).toThrow(/IPB-UX-009/);
  });
});

describe("@IPB-07-AT-08 column chooser and saved views", () => {
  const cols = [
    { key: "title", header: "Title", rowHeader: true },
    { key: "due_on", header: "Due" },
    { key: "status", header: "Status" },
    { key: "owner", header: "Owner" },
  ];

  it("restores hidden columns and order, keeping the first column pinned", () => {
    expect(applyColumns(cols, ["status", "due_on", "gone"]).map((c) => c.key)).toEqual([
      "title",
      "status",
      "due_on",
    ]);
    expect(applyColumns(cols, null)).toHaveLength(4);
    expect(moveColumn(["title", "a", "b"], "b:up")).toEqual(["title", "b", "a"]);
    expect(moveColumn(["a", "b"], "b:down")).toEqual(["a", "b"]);
  });

  it("renders the chooser as a form with the pinned column fixed, and density on the table", () => {
    const out = html(
      <ColumnChooser action="/cols" columns={cols} visible={["due_on"]} density="compact" />,
    );
    expect(out).toContain('method="post"');
    expect(out).toMatch(/id="col-title"[^>]*disabled/);
    expect(out).toContain('value="status:up"');
    expect(out).not.toContain('value="due_on:up"');
    expect(out).toMatch(/id="density-compact"[^>]*checked/);
    // Each column once, the pinned one too when the layout leaves it out (ids stay unique).
    const ids = [...out.matchAll(/id="(col-[a-z_]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["col-title", "col-due_on", "col-status", "col-owner"]);
    expect(html(<DataTable caption="c" columns={cols} rows={[]} density="compact" />)).toContain(
      "ibx-table--compact",
    );
  });

  it("lists my views and shared views, marking the current one", () => {
    const out = html(
      <SavedViewPicker
        personal={[{ id: "v1", name: "My overdue", href: "?view=v1", isDefault: true }]}
        shared={[{ id: "v2", name: "Team overdue", href: "?view=v2" }]}
        currentId="v2"
        saveAction="/views"
      />,
    );
    expect(out).toContain("My views");
    expect(out).toContain("Shared views");
    expect(out).toContain('<a href="?view=v2" aria-current="true">Team overdue</a>');
    expect(out).toContain('name="name"');
  });
});

describe("keyboard map (IPB-06-29)", () => {
  const groups = [
    { id: "global", label: "Global" },
    { id: "list", label: "Lists" },
  ];
  it("renders every shortcut from the registry list, grouped, with off ones marked", () => {
    const out = html(
      <KeyboardMap
        groups={groups}
        remapHref="/settings/accessibility/keyboard"
        shortcuts={[
          { id: "palette", label: "Open search", combo: "Ctrl+K", group: "global", active: true },
          { id: "next", label: "Next row", combo: "J", group: "list", active: false },
        ]}
      />,
    );
    expect(out).toContain("<caption>Global</caption>");
    expect(out).toContain('<kbd class="ibx-kbd">Ctrl+K</kbd>');
    expect(out).toContain("(off)");
    expect(out).toContain("Change shortcuts");
  });
  it("refuses a duplicate or an ungrouped shortcut", () => {
    const s = { id: "a", label: "A", combo: "Ctrl+A", group: "global" };
    expect(() => html(<KeyboardMap groups={groups} shortcuts={[s, s]} />)).toThrow(/twice/);
    expect(() => html(<KeyboardMap groups={groups} shortcuts={[{ ...s, group: "x" }]} />)).toThrow(
      /unknown group/,
    );
  });
});

describe("catalogues", () => {
  it("has a Hindi string for every new key", () => {
    const hi = baseCatalogue("hi-IN")!;
    const missing = BASE_MESSAGE_KEYS.filter(
      (k) =>
        /^ui\.(search|workspace|state|page|approvals|evidence|views|keys|table)\./.test(k) &&
        !hi[k],
    );
    expect(missing).toEqual([]);
    expect(messages("hi-IN").t("ui.search.refused")).not.toBe("ui.search.refused");
  });
});
