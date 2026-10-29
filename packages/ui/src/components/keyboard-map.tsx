// The keyboard map (IPB-06-29, IPB-06-30; Finbyx PR-FBX-09): rendered from the shortcut registry
// (`ShortcutRegistry.list()` in `@infrabyx/a11y` gives each shortcut's id, label, combo and whether
// it is active), grouped as the product's definitions say. A shortcut in no known group, or listed
// twice, is a defect and throws, so the map cannot drift from the registry.
import { messages, type Messages } from "../i18n/messages.js";

const en = messages("en-IN");

export interface ShortcutEntry {
  id: string;
  label: string;
  combo: string;
  /** False when off (a single-key shortcut while `a11y.keyboard.single_key_enabled` is false). */
  active?: boolean;
  group: string;
}

export function KeyboardMap({
  groups,
  shortcuts,
  remapHref,
  t = en,
}: {
  /** Group ids and headings in order: global, navigation, list, editor, record actions. */
  groups: readonly { id: string; label: string }[];
  shortcuts: readonly ShortcutEntry[];
  /** The settings page that rebinds shortcuts (IPB-06-30). */
  remapHref?: string;
  t?: Messages;
}) {
  const known = new Set(groups.map((g) => g.id));
  const seen = new Set<string>();
  for (const s of shortcuts) {
    if (!known.has(s.group)) throw new Error(`shortcut ${s.id} is in unknown group ${s.group}`);
    if (seen.has(s.id)) throw new Error(`shortcut ${s.id} is listed twice`);
    seen.add(s.id);
  }
  return (
    <div className="ibx-keymap">
      {remapHref ? (
        <p>
          <a href={remapHref}>{t.t("ui.keys.remap")}</a>
        </p>
      ) : null}
      {groups.map((g) => {
        const rows = shortcuts.filter((s) => s.group === g.id);
        if (!rows.length) return null;
        return (
          <div
            className="ibx-table-wrap"
            key={g.id}
            role="region"
            aria-label={g.label}
            tabIndex={0}
          >
            <table className="ibx-table">
              <caption>{g.label}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.t("ui.keys.action")}</th>
                  <th scope="col">{t.t("ui.keys.keys")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">{s.label}</th>
                    <td>
                      <kbd className="ibx-kbd">{s.combo}</kbd>
                      {s.active === false ? (
                        <span className="ibx-field__req"> ({t.t("ui.keys.off")})</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
