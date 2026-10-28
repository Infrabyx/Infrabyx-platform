// The visual block editor of the Studio page screens (PR-038; R1-D-02). A page's blocks are shown in
// order, each with a form of its own fields, buttons to move it up or down or remove it, and a form
// to add a block of any type at any position. Everything is a plain form post (no JavaScript): list
// fields show their rows plus one blank row to add, with a checkbox to remove a row; rich text is
// written as paragraphs with a few text conventions instead of JSON. The block types' fields come
// from the service that owns them (`@infrabyx/cms` exports `BLOCK_EDITOR`), and the service checks
// every save as before. A block whose type has no spec (tabs) keeps a JSON field, and the whole
// body stays editable as JSON.
import type { ReactNode } from "react";
import { Button, CheckboxField, Field, SelectField } from "../components/forms.js";
import { FieldProblem, oneOf, required, text } from "./form.js";
import { Hidden, StudioSectionBox } from "./layout.js";
import type { FieldError, FormAction } from "./types.js";

/** One field of a block type's form. `name` is the property of the block (or of a list row). */
export type BlockField =
  | {
      kind: "text";
      name: string;
      label: string;
      required?: boolean;
      multiline?: boolean;
      hint?: string;
    }
  | { kind: "number"; name: string; label: string; required?: boolean; hint?: string }
  | { kind: "select"; name: string; label: string; options: readonly string[]; required?: boolean }
  | { kind: "checkbox"; name: string; label: string }
  /** Rich text through the service's codec (paragraphs and a few conventions, not JSON). */
  | { kind: "richtext"; name: string; label: string; required?: boolean }
  /** A list of strings, one per line. */
  | { kind: "lines"; name: string; label: string; required?: boolean; hint?: string }
  /** A table of strings: one row per line, cells separated by ` | `. */
  | { kind: "table"; name: string; label: string; hint?: string }
  /** An optional object of scalar fields (a call to action); left empty, it is omitted. */
  | { kind: "group"; name: string; label: string; fields: readonly ScalarField[] }
  /** A list of objects: one row per item, plus a blank row to add one. */
  | { kind: "list"; name: string; label: string; fields: readonly ScalarField[] };
export type ScalarField = Extract<
  BlockField,
  { kind: "text" | "number" | "select" | "checkbox" | "richtext" }
>;

export interface BlockSpec {
  type: string;
  label: string;
  /** What a new block of this type starts with (valid once `ref` is filled). */
  template: Record<string, unknown>;
  /**
   * A property a new block cannot start without (a media, form or testimonial id): the add form
   * asks for it. `name` may be a path into the template (`logos.0.media_id`); `list: true` puts
   * the value in a one-item list (`testimonial_ids`).
   */
  ref?: { name: string; label: string; list?: boolean };
  fields: readonly BlockField[];
}

/** Rich text to and from the text an editor writes (the service owns the format). */
export interface RichTextCodec {
  toText(value: unknown): string;
  fromText(text: string): unknown;
  /** Shown under every rich text field. */
  hint: string;
}

export interface BlockEditorOptions {
  specs: readonly BlockSpec[];
  richText: RichTextCodec;
}

export type Block = Record<string, unknown>;

export type BlockOp =
  | { op: "add"; type: string; at: number; ref?: string }
  | { op: "remove"; index: number }
  | { op: "move"; index: number; by: -1 | 1 }
  | { op: "update"; index: number; block: Block };

const GONE = "That block is no longer there; reload the page.";

/** Where an added block goes: the position asked for, kept within the list (the end if none). */
export const insertAt = (length: number, at: number) =>
  Number.isFinite(at) ? Math.max(0, Math.min(length, Math.trunc(at))) : length;

/** Apply one operation to a block list; the input is not changed. */
export function applyBlockOp(
  blocks: readonly Block[],
  op: BlockOp,
  o: BlockEditorOptions,
): Block[] {
  const out = [...blocks];
  const at = (i: number) => {
    if (!Number.isInteger(i) || i < 0 || i >= out.length)
      throw new FieldProblem([{ fieldId: "blocks", message: GONE }]);
    return i;
  };
  switch (op.op) {
    case "add": {
      const spec = o.specs.find((s) => s.type === op.type);
      if (!spec)
        throw new FieldProblem([{ fieldId: "f-block-type", message: "Choose a block type." }]);
      const block: Block = structuredClone({ type: spec.type, ...spec.template });
      if (spec.ref) {
        if (!op.ref)
          throw new FieldProblem([
            {
              fieldId: "f-block-ref",
              message: `Enter ${spec.ref.label.toLowerCase()} for this block.`,
            },
          ]);
        const path = spec.ref.name.split(".");
        let target = block as Record<string, unknown>;
        for (const k of path.slice(0, -1)) target = target[k] as Record<string, unknown>;
        target[path[path.length - 1]!] = spec.ref.list ? [op.ref] : op.ref;
      }
      out.splice(insertAt(out.length, op.at), 0, block);
      return out;
    }
    case "remove":
      out.splice(at(op.index), 1);
      return out;
    case "move": {
      const i = at(op.index);
      const j = i + op.by;
      if (j < 0 || j >= out.length) return out;
      [out[i], out[j]] = [out[j]!, out[i]!];
      return out;
    }
    case "update":
      out[at(op.index)] = op.block;
      return out;
  }
}

/** The page id of a block's field (`b-2-items-0-title`); its form name is `b.2.items.0.title`. */
export const blockFieldId = (i: number, ...path: (string | number)[]) =>
  [`b-${i}`, ...path].join("-");
const fname = (...path: (string | number)[]) => `b.${path.join(".")}`;

const rawText = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
};

/** One scalar value from the form; undefined when left empty (the property is then dropped). */
function scalar(fd: FormData, f: ScalarField, name: string, id: string, o: BlockEditorOptions) {
  if (f.kind === "checkbox") return fd.has(name);
  const v = text(fd, name);
  if (v === undefined) return undefined;
  if (f.kind === "number") {
    const n = Number(v);
    if (!Number.isFinite(n))
      throw new FieldProblem([{ fieldId: id, message: `${f.label} must be a number.` }]);
    return n;
  }
  return f.kind === "richtext" ? o.richText.fromText(v) : v;
}

/** Write a form's scalar fields over `base`: set what was entered, drop what was cleared. */
function scalars(
  fd: FormData,
  fields: readonly ScalarField[],
  base: Record<string, unknown>,
  path: (string | number)[],
  index: number,
  o: BlockEditorOptions,
) {
  const out = { ...base };
  for (const f of fields) {
    const v = scalar(fd, f, fname(index, ...path, f.name), blockFieldId(index, ...path, f.name), o);
    // An unticked checkbox stays as `false` only where the block already had the property.
    if (v === undefined || (v === false && !(f.name in base))) delete out[f.name];
    else out[f.name] = v;
  }
  return out;
}

/**
 * Read one block's form back into the block. Properties the spec does not name (the block's key,
 * its slot, anything newer than the form) are kept from the current block, in rows too.
 */
export function blockFromForm(
  fd: FormData,
  index: number,
  current: Block,
  o: BlockEditorOptions,
): Block {
  const spec = o.specs.find((s) => s.type === current.type);
  if (!spec) {
    const id = blockFieldId(index, "json");
    const raw = text(fd, fname(index, "json"));
    if (raw === undefined)
      throw new FieldProblem([{ fieldId: id, message: "Enter the block as JSON." }]);
    let b: unknown;
    try {
      b = JSON.parse(raw);
    } catch (e) {
      throw new FieldProblem([{ fieldId: id, message: `Not valid JSON: ${(e as Error).message}` }]);
    }
    if (b === null || typeof b !== "object" || Array.isArray(b))
      throw new FieldProblem([{ fieldId: id, message: "A block is a JSON object." }]);
    return b as Block;
  }
  const next: Block = { ...current };
  const set = (k: string, v: unknown) => {
    if (v === undefined) delete next[k];
    else next[k] = v;
  };
  for (const f of spec.fields) {
    const name = fname(index, f.name);
    switch (f.kind) {
      case "lines": {
        const lines = rawText(fd, name)
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        set(f.name, lines.length || f.name in current ? lines : undefined);
        break;
      }
      case "table": {
        const rows = rawText(fd, name)
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .map((l) => l.split("|").map((c) => c.trim()));
        set(f.name, rows.length || f.name in current ? rows : undefined);
        break;
      }
      case "group": {
        const was = (current[f.name] ?? {}) as Record<string, unknown>;
        const g = scalars(fd, f.fields, was, [f.name], index, o);
        set(f.name, Object.keys(g).length ? g : undefined);
        break;
      }
      case "list": {
        const was = Array.isArray(current[f.name])
          ? (current[f.name] as Record<string, unknown>[])
          : [];
        const rows: Record<string, unknown>[] = [];
        for (let r = 0; r <= was.length; r++) {
          if (r < was.length && fd.has(fname(index, f.name, r, "remove"))) continue;
          const row = scalars(fd, f.fields, was[r] ?? {}, [f.name, r], index, o);
          if (Object.keys(row).length) rows.push(row);
        }
        set(f.name, rows.length || f.name in current ? rows : undefined);
        break;
      }
      default: {
        const v = scalar(fd, f, name, blockFieldId(index, f.name), o);
        set(f.name, v === false && !(f.name in current) ? undefined : v);
      }
    }
  }
  return next;
}

/** Read the posted block operation (the `op` and its fields) against the page's current blocks. */
export function blockOpFromForm(
  fd: FormData,
  blocks: readonly Block[],
  o: BlockEditorOptions,
): BlockOp {
  const op = oneOf(fd, "op", ["add", "remove", "up", "down", "update"] as const);
  if (op === "add") {
    const ref = text(fd, "block-ref");
    return {
      op: "add",
      type: oneOf(
        fd,
        "block-type",
        o.specs.map((s) => s.type),
      ),
      at: Number(text(fd, "block-at") ?? blocks.length),
      ...(ref ? { ref } : {}),
    };
  }
  const index = Number(required(fd, "index", "the block"));
  if (op === "remove") return { op, index };
  if (op === "up" || op === "down") return { op: "move", index, by: op === "up" ? -1 : 1 };
  const current = blocks[index];
  if (!current) throw new FieldProblem([{ fieldId: "blocks", message: GONE }]);
  return { op: "update", index, block: blockFromForm(fd, index, current, o) };
}

/**
 * The field a service error path points at: `blocks[2].items[0].title` is that row's title field,
 * `blocks[2].primary_cta.label` the group's field, `blocks[2].columns[1]` (a list of strings or a
 * table) the whole field, `blocks[2]` the block's heading.
 */
export function blockFieldOf(path: string): string | undefined {
  const m = /^blocks\[(\d+)\](.*)$/.exec(path);
  if (!m) return undefined;
  const i = Number(m[1]);
  const rest = [...m[2]!.matchAll(/\.([a-z_]+)|\[(\d+)\]/g)].map((x) =>
    x[1] !== undefined ? x[1] : Number(x[2]),
  );
  const [name, second, third] = rest;
  if (typeof name !== "string") return `block-${i}`;
  if (typeof second === "number" && typeof third === "string")
    return blockFieldId(i, name, second, third);
  if (typeof second === "string") return blockFieldId(i, name, second);
  return blockFieldId(i, name);
}

const asText = (v: unknown) => (v === undefined || v === null ? "" : String(v));

function ScalarInput(p: {
  f: ScalarField;
  id: string;
  name: string;
  value: unknown;
  o: BlockEditorOptions;
  error: string | undefined;
  /** Rows of a list and optional groups: no field is required (an empty row is left out). */
  inRow?: boolean;
}) {
  const { f } = p;
  const req = !p.inRow && "required" in f && f.required === true;
  if (f.kind === "checkbox")
    return (
      <CheckboxField
        id={p.id}
        name={p.name}
        label={f.label}
        helpKey="hlp.studio.block_field"
        checked={p.value === true}
        error={p.error}
      />
    );
  if (f.kind === "select")
    return (
      <SelectField
        id={p.id}
        name={p.name}
        label={f.label}
        helpKey="hlp.studio.block_field"
        required={req}
        options={[
          ...(req ? [] : [{ value: "", label: "None" }]),
          ...f.options.map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
        ]}
        defaultValue={asText(p.value)}
        error={p.error}
      />
    );
  if (f.kind === "richtext")
    return (
      <Field
        id={p.id}
        name={p.name}
        label={f.label}
        helpKey="hlp.studio.rich_text"
        multiline
        required={req}
        hint={p.o.richText.hint}
        defaultValue={p.value === undefined ? "" : p.o.richText.toText(p.value)}
        error={p.error}
      />
    );
  return (
    <Field
      id={p.id}
      name={p.name}
      label={f.label}
      helpKey="hlp.studio.block_field"
      {...(f.kind === "number" ? { type: "number" as const } : {})}
      multiline={f.kind === "text" && f.multiline === true}
      required={req}
      hint={f.hint}
      defaultValue={asText(p.value)}
      error={p.error}
    />
  );
}

const LINES_HINT = "One per line.";
const TABLE_HINT = "One row per line; separate the cells with a vertical bar ( | ).";

function BlockFields(p: {
  index: number;
  block: Block;
  spec: BlockSpec;
  o: BlockEditorOptions;
  err: (id: string) => string | undefined;
}) {
  const i = p.index;
  return (
    <>
      {p.spec.fields.map((f) => {
        const id = blockFieldId(i, f.name);
        const name = fname(i, f.name);
        const value = p.block[f.name];
        switch (f.kind) {
          case "lines":
            return (
              <Field
                key={f.name}
                id={id}
                name={name}
                label={f.label}
                helpKey="hlp.studio.block_field"
                multiline
                required={f.required === true}
                hint={f.hint ?? LINES_HINT}
                defaultValue={Array.isArray(value) ? value.join("\n") : ""}
                error={p.err(id)}
              />
            );
          case "table":
            return (
              <Field
                key={f.name}
                id={id}
                name={name}
                label={f.label}
                helpKey="hlp.studio.block_field"
                multiline
                hint={f.hint ?? TABLE_HINT}
                defaultValue={
                  Array.isArray(value)
                    ? (value as unknown[])
                        .map((r) => (Array.isArray(r) ? r.join(" | ") : ""))
                        .join("\n")
                    : ""
                }
                error={p.err(id)}
              />
            );
          case "group": {
            const g = (value ?? {}) as Record<string, unknown>;
            return (
              <fieldset key={f.name} id={id} className="ibx-studio__group">
                <legend>{f.label} (optional)</legend>
                {f.fields.map((sf) => (
                  <ScalarInput
                    key={sf.name}
                    f={sf}
                    id={blockFieldId(i, f.name, sf.name)}
                    name={fname(i, f.name, sf.name)}
                    value={g[sf.name]}
                    o={p.o}
                    inRow
                    error={p.err(blockFieldId(i, f.name, sf.name))}
                  />
                ))}
              </fieldset>
            );
          }
          case "list": {
            const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
            return (
              <fieldset key={f.name} id={id} className="ibx-studio__group">
                <legend>{f.label}</legend>
                {p.err(id) ? <p className="ibx-field__error">{p.err(id)}</p> : null}
                {[...rows, {}].map((row, r) => (
                  <fieldset key={r} className="ibx-studio__row">
                    <legend>{r < rows.length ? `Item ${r + 1}` : "Add an item"}</legend>
                    {f.fields.map((sf) => (
                      <ScalarInput
                        key={sf.name}
                        f={sf}
                        id={blockFieldId(i, f.name, r, sf.name)}
                        name={fname(i, f.name, r, sf.name)}
                        value={row[sf.name]}
                        o={p.o}
                        inRow
                        error={p.err(blockFieldId(i, f.name, r, sf.name))}
                      />
                    ))}
                    {r < rows.length ? (
                      <CheckboxField
                        id={blockFieldId(i, f.name, r, "remove")}
                        name={fname(i, f.name, r, "remove")}
                        label={`Remove item ${r + 1}`}
                        helpKey="hlp.studio.block_list_remove"
                      />
                    ) : null}
                  </fieldset>
                ))}
              </fieldset>
            );
          }
          default:
            return (
              <ScalarInput
                key={f.name}
                f={f}
                id={id}
                name={name}
                value={value}
                o={p.o}
                error={p.err(id)}
              />
            );
        }
      })}
    </>
  );
}

/** The block editor section of a page's edit screen. */
export function BlockEditor(p: {
  itemId: string;
  /** The revision the blocks come from; a post against an older one is refused. */
  revisionId: string;
  blocks: readonly Block[];
  action: FormAction;
  options: BlockEditorOptions;
  errors?: readonly FieldError[] | undefined;
  children?: ReactNode;
}) {
  const err = (id: string) => p.errors?.find((e) => e.fieldId === id)?.message;
  const label = (type: unknown) =>
    p.options.specs.find((s) => s.type === type)?.label ?? String(type).replace(/_/g, " ");
  const n = p.blocks.length;
  const hidden = { itemId: p.itemId, revisionId: p.revisionId };
  const refs = p.options.specs.filter((s) => s.ref);
  return (
    <StudioSectionBox id="blocks" title="Page blocks">
      <p>
        Each change is saved as a new draft revision and moves the page back to draft. The service
        checks every block when you save.
      </p>
      {err("blocks") ? <p className="ibx-field__error">{err("blocks")}</p> : null}
      {n === 0 ? <p>This page has no blocks yet.</p> : null}
      <ol className="ibx-studio__blocks">
        {p.blocks.map((block, i) => {
          const spec = p.options.specs.find((s) => s.type === block.type);
          const title = `Block ${i + 1}: ${label(block.type)}`;
          const at = { ...hidden, index: String(i) };
          return (
            <li key={i} className="ibx-studio__block">
              <h3 id={`block-${i}`}>{title}</h3>
              {err(`block-${i}`) ? <p className="ibx-field__error">{err(`block-${i}`)}</p> : null}
              <div className="ibx-studio__ops">
                {i > 0 ? (
                  <form method="post" action={p.action} className="ibx-studio__op">
                    <Hidden values={{ ...at, op: "up" }} />
                    <Button type="submit">Move block {i + 1} up</Button>
                  </form>
                ) : null}
                {i < n - 1 ? (
                  <form method="post" action={p.action} className="ibx-studio__op">
                    <Hidden values={{ ...at, op: "down" }} />
                    <Button type="submit">Move block {i + 1} down</Button>
                  </form>
                ) : null}
                <form method="post" action={p.action} className="ibx-studio__op">
                  <Hidden values={{ ...at, op: "remove" }} />
                  <Button type="submit" variant="danger">
                    Remove block {i + 1}
                  </Button>
                </form>
              </div>
              <form method="post" action={p.action} noValidate aria-labelledby={`block-${i}`}>
                <Hidden values={{ ...at, op: "update" }} />
                {spec ? (
                  <BlockFields index={i} block={block} spec={spec} o={p.options} err={err} />
                ) : (
                  <Field
                    id={blockFieldId(i, "json")}
                    name={fname(i, "json")}
                    label={`${label(block.type)} block (JSON)`}
                    helpKey="hlp.studio.block_json"
                    multiline
                    defaultValue={JSON.stringify(block, null, 2)}
                    error={err(blockFieldId(i, "json"))}
                  />
                )}
                <Button type="submit" variant="primary">
                  Save block {i + 1}
                </Button>
              </form>
            </li>
          );
        })}
      </ol>
      <h3 id="block-add">Add a block</h3>
      <form method="post" action={p.action} noValidate aria-labelledby="block-add">
        <Hidden values={{ ...hidden, op: "add" }} />
        <SelectField
          id="f-block-type"
          name="block-type"
          label="Block type"
          helpKey="hlp.studio.block_type"
          required
          options={p.options.specs.map((s) => ({ value: s.type, label: s.label }))}
          error={err("f-block-type")}
        />
        <SelectField
          id="f-block-at"
          name="block-at"
          label="Position"
          helpKey="hlp.studio.block_position"
          required
          defaultValue={String(n)}
          options={[
            ...p.blocks.map((b, i) => ({
              value: String(i),
              label: `Before block ${i + 1} (${label(b.type)})`,
            })),
            { value: String(n), label: "At the end" },
          ]}
        />
        {refs.length ? (
          <Field
            id="f-block-ref"
            name="block-ref"
            label="Reference"
            helpKey="hlp.studio.block_ref"
            hint={`Needed for ${refs.map((s) => `${s.label} (${s.ref!.label.toLowerCase()})`).join(", ")}.`}
            error={err("f-block-ref")}
          />
        ) : null}
        <Button type="submit">Add block</Button>
      </form>
      {p.children}
    </StudioSectionBox>
  );
}
