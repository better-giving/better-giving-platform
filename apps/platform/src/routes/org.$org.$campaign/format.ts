import { smart_next } from "@better-giving/ui";
import type { TCampaignType } from "@/campaign";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const TAG: Record<TCampaignType, string | null> = {
  year_end: "Year-end",
  emergency: "Emergency",
  building: "Building",
  event: "Event",
  tribute: "Tribute",
  monthly: "Monthly",
  program: "Program",
  other: null,
};

export function tag_label(type: string | null): string | null {
  if (!type) return null;
  if (!(type in TAG)) return null;
  return TAG[type as TCampaignType];
}

/** fixed goal, or the next smart rung. null when the campaign has no goal. */
export function goal_amount(
  target: string | undefined,
  raised: number
): number | null {
  if (!target || target === "0") return null;
  const to = target === "smart" ? smart_next(raised) : Number(target);
  if (!(to > 0) || Number.isNaN(to) || Number.isNaN(raised)) return null;
  return to;
}

/** keeps counting past 100. the bar caps on its own. */
export function goal_percent(raised: number, goal: number): number {
  if (!(goal > 0) || Number.isNaN(raised)) return 0;
  return Math.floor((raised / goal) * 100);
}

/**
 * $0 stays 0% with an empty bar. a gift that floors to 0% has still started,
 * so the figure reads <1% rather than looking like nothing came in.
 */
export function percent_label(raised: number, goal: number): string {
  if (!(raised > 0)) return "0%";
  const n = goal_percent(raised, goal);
  if (n === 0) return "<1%";
  return `${n}%`;
}

/** the page joins this with the website, so the separating dot stays there. */
export function legal_line(ein: string | null): string | undefined {
  if (!ein) return;
  return `501(c)(3) · EIN ${ein}`;
}

export function website_link(
  url: string | null
): { href: string; label: string } | undefined {
  if (!url) return;
  try {
    return { href: url, label: new URL(url).host };
  } catch {
    return { href: url, label: url };
  }
}

export function donor_noun(n: number): string {
  return n === 1 ? "donor" : "donors";
}

export function donor_label(n: number): string {
  return `${n.toLocaleString("en-US")} ${donor_noun(n)}`;
}

const ended_date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function format_ended_date(ends_at: string): string {
  return ended_date.format(new Date(ends_at));
}

/**
 * a future `ends_at` is the schedule. an early close does not rewrite it, so
 * that date is not when donations stopped.
 */
export function shown_end(ends_at: string | null, now: Date): string | null {
  if (!ends_at) return null;
  if (new Date(ends_at).getTime() > now.getTime()) return null;
  return ends_at;
}

export function ended_label(ends_at: string | null): string {
  if (!ends_at) return "Ended";
  return `Ended ${format_ended_date(ends_at)}`;
}

export function closed_body(ends_at: string | null): string {
  if (!ends_at) {
    return "It no longer takes donations. Thank you to everyone who gave.";
  }
  return `It stopped taking donations on ${format_ended_date(ends_at)}. Thank you to everyone who gave.`;
}

/** display only. a settled match is already inside raised and donors. a repeat donor is already inside the count. */
export function shown_totals(input: {
  raised: number;
  donors: number;
  open: boolean;
  thanks_usd: number | null;
  thanks_present: boolean;
  already_settled: boolean;
  repeat_donor: boolean;
}): { raised: number; donors: number; no_gifts: boolean } {
  const extra =
    input.thanks_usd != null && input.thanks_usd > 0 && !input.already_settled
      ? input.thanks_usd
      : 0;
  const donors = input.donors + (extra > 0 && !input.repeat_donor ? 1 : 0);
  return {
    raised: input.raised + extra,
    donors,
    no_gifts: input.open && donors === 0 && !input.thanks_present,
  };
}

/** whole days to the end, a partial day counting as one; null once ended.
 * elapsed time, not calendar days, so server and browser agree in any zone. */
export function days_left(ends_at: string, now: number): number | null {
  const ms = Date.parse(ends_at) - now;
  if (!(ms > 0)) return null;
  return Math.ceil(ms / DAY);
}

/** null once the end has passed. the caller shows the ended label instead. */
export function time_left(ends_at: string, now: Date): string | null {
  const ms = new Date(ends_at).getTime() - now.getTime();
  if (!(ms > 0)) return null;
  if (ms < HOUR) return "Less than an hour left";
  if (ms < DAY) {
    const hours = Math.ceil(ms / HOUR);
    return hours === 1 ? "1 hour left" : `${hours} hours left`;
  }
  const days = days_left(ends_at, now.getTime());
  return days === 1 ? "1 day left" : `${days} days left`;
}
