import { inArray, not, or, type SQL, sql } from "drizzle-orm";
import { donations } from "$/pg/schema/donation";
import {
  type Group,
  type MethodFilter,
  STATUS_OPTIONS,
  type StatusFilter,
} from "./constants";

const via = donations.via;

/** SQL twin of `via_group` in constants.ts; the one place a `via` is matched to a payment-method group */
const GROUP_SQL: Record<Group, SQL> = {
  stripe: sql`(${via} = 'stripe' OR ${via} LIKE 'stripe:%')`,
  paypal: sql`(${via} LIKE 'paypal%' OR ${via} = 'venmo')`,
  daf: sql`(${via} LIKE 'chariot%' OR ${via} = 'daf')`,
  crypto: sql`${via} LIKE 'crypto:%'`,
  stocks: sql`${via} = 'stocks'`,
  match: sql`${via} = 'match'`,
};

export const status_where = (f: StatusFilter): SQL | undefined => {
  const statuses = STATUS_OPTIONS.find((o) => o.value === f)?.statuses ?? [];
  return statuses.length ? inArray(donations.status, [...statuses]) : undefined;
};

export const method_where = (f: MethodFilter): SQL | undefined => {
  if (f === "all") return undefined;
  if (f === "other") return not(or(...Object.values(GROUP_SQL))!);
  return GROUP_SQL[f];
};
