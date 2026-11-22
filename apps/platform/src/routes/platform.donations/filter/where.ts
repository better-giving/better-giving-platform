import { inArray, not, or, type SQL, sql } from "drizzle-orm";
import { donations } from "$/pg/schema/donation";
import {
  type Group,
  type MethodKey,
  STATUS_OPTIONS,
  type StatusKey,
} from "./constants";

const via = donations.via;

/** SQL twin of `via_group` in constants.ts: the loader's match of a `via` to a payment-method group */
const GROUP_SQL: Record<Group, SQL> = {
  stripe: sql`(${via} = 'stripe' OR ${via} LIKE 'stripe:%')`,
  paypal: sql`(${via} LIKE 'paypal%' OR ${via} = 'venmo')`,
  daf: sql`(${via} LIKE 'chariot%' OR ${via} = 'daf')`,
  crypto: sql`${via} LIKE 'crypto:%'`,
  stocks: sql`${via} = 'stocks'`,
  match: sql`${via} = 'match'`,
};

const NOT_ANY_GROUP = () => not(or(...Object.values(GROUP_SQL))!);

/** the union of the selected groups' statuses; every group applies no filter */
export const status_where = (sel: StatusKey[]): SQL | undefined => {
  if (sel.length === STATUS_OPTIONS.length) return undefined;
  const statuses = STATUS_OPTIONS.filter((o) => sel.includes(o.value)).flatMap(
    (o) => o.statuses
  );
  return inArray(donations.status, statuses);
};

/** the OR of the selected predicates; none selected applies no filter */
export const method_where = (sel: MethodKey[]): SQL | undefined => {
  if (sel.length === 0) return undefined;
  return or(
    ...sel.map((k) => (k === "other" ? NOT_ANY_GROUP() : GROUP_SQL[k]))
  );
};
