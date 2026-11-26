import type { Alert } from "@/slack";

/** every part of an alert ops read, one per line: fields as `name: value`,
 * table rows as `a | b | c`, and the note, action, ids and sender under their
 * own labels with the links shown, so a regex can tell where a phrase sits and
 * a link that went missing shows */
export const alert_text = (a: Alert) =>
  [
    a.title,
    a.summary,
    a.body,
    ...(a.fields ?? []).map(
      (f) => `${f.name}: ${f.value}${f.url ? ` <${f.url}>` : ""}`
    ),
    ...(a.table
      ? [a.table.columns.map((c) => c.name), ...a.table.rows].map((r) =>
          r.join(" | ")
        )
      : []),
    a.note && `note: ${a.note}`,
    a.action &&
      `action: ${a.action.text}${a.action.url ? ` <${a.action.url}>` : ""}`,
    ...(a.context ?? []).map((line) => `ids: ${line}`),
    `from: ${a.from}`,
  ]
    .filter((line) => !!line)
    .join("\n");
