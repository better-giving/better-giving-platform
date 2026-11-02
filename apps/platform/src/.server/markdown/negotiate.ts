interface IRange {
  type: string;
  subtype: string;
  q: number;
}

function parse_accept(accept: string): IRange[] {
  const ranges: IRange[] = [];
  for (const part of accept.split(",")) {
    const [media, ...params] = part.split(";");
    const [type, subtype] = media.trim().toLowerCase().split("/");
    if (!type || !subtype) continue;
    let q = 1;
    for (const p of params) {
      const [k, v] = p.split("=").map((s) => s.trim().toLowerCase());
      if (k === "q") q = Number.isFinite(Number(v)) ? Number(v) : 0;
    }
    ranges.push({ type, subtype, q });
  }
  return ranges;
}

/** q of the most specific range matching `type/subtype` (RFC 9110 §12.5.1), 0 when none does */
function quality(ranges: IRange[], type: string, subtype: string): number {
  let best: { specificity: number; q: number } | null = null;
  for (const r of ranges) {
    const specificity =
      r.type === type && r.subtype === subtype
        ? 2
        : r.type === type && r.subtype === "*"
          ? 1
          : r.type === "*" && r.subtype === "*"
            ? 0
            : -1;
    if (specificity < 0) continue;
    if (!best || specificity > best.specificity) best = { specificity, q: r.q };
  }
  return best?.q ?? 0;
}

/** true only when text/markdown outranks text/html by q — a tie, `*\/*` or no header keeps html */
export function prefers_markdown(accept: string | null): boolean {
  if (!accept) return false;
  const ranges = parse_accept(accept);
  return quality(ranges, "text", "markdown") > quality(ranges, "text", "html");
}
