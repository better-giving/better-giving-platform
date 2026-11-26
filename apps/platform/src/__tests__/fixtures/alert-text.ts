import type { Alert } from "@/slack";

/** every part of an alert ops read, one per line: fields as `name: value`,
 * table rows as `a | b | c`, for a regex over the whole */
export const alert_text = (a: Alert) =>
  [
    a.title,
    a.summary,
    a.body,
    ...(a.fields ?? []).map((f) => `${f.name}: ${f.value}`),
    ...(a.table
      ? [a.table.columns.map((c) => c.name), ...a.table.rows].map((r) =>
          r.join(" | ")
        )
      : []),
    a.note,
    a.action?.text,
    ...(a.context ?? []),
  ]
    .filter((line) => !!line)
    .join("\n");
