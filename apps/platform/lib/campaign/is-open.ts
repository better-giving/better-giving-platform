/**
 * `expiration` is read as its UTC calendar date; the fund stays open until that
 * date has ended everywhere on earth — midnight after it in UTC−12, i.e. 12:00 UTC
 * the next day. The fund-list SQL in `.server/pg/queries/fund.ts` applies the same rule.
 */
export const fund_closes_at = (expiration: string): Date => {
  // reads carry 3–6 fraction digits and Date's parser is only specified for 3;
  // the date part is all the rule needs, and reads are normalised to UTC `…Z`
  const [y, m, d] = expiration.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, 12));
};

export const fund_is_open = (
  fund: { active: boolean; expiration?: string | null },
  now: Date
): boolean => {
  if (!fund.active) return false;
  if (!fund.expiration) return true;
  return now.getTime() < fund_closes_at(fund.expiration).getTime();
};

/** `fund_is_open` for a list item, whose expiration is unix seconds */
export const fund_item_is_open = (
  fund: { active: boolean; expiration: number },
  now: Date
): boolean =>
  fund_is_open(
    {
      active: fund.active,
      expiration: new Date(fund.expiration * 1000).toISOString(),
    },
    now
  );
