/**
 * did this error come from a unique violation on `constraint`?
 *
 * drizzle wraps the driver's error in a `DrizzleQueryError` whose `cause` carries
 * the postgres `code`, so the top-level error never has one.
 */
export function is_unique_violation(err: unknown, constraint: string): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    const pg = e as Error & { code?: unknown; constraint?: unknown };
    if (pg.code === "23505") return pg.constraint === constraint;
  }
  return false;
}

/** did this error come from a foreign-key violation: a row elsewhere still
 * points at the one being deleted? drizzle wraps the driver's error, so the
 * code is on a `cause`. */
export function is_foreign_key_violation(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    if ((e as Error & { code?: unknown }).code === "23503") return true;
  }
  return false;
}
