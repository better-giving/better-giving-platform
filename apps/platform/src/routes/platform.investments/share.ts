import { humanize } from "@/helpers/decimal";

/** `part` as a percentage of `whole`; null when `whole` is 0, where a share is undefined */
export function share_pct(part: number, whole: number): number | null {
  return whole === 0 ? null : (part / whole) * 100;
}

export function fmt_share(pct: number | null): string {
  return pct === null ? "—" : `${humanize(pct)}%`;
}
