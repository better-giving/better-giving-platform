import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { DbOrTx } from "../pg/queries/helpers";
import { connector_idempotency } from "../pg/schema/connector";
import { problem } from "./problem";

/** Same window `sweep` deletes in keys.ts. A replay inside it is 200. */
const IDEM_MS = 24 * 60 * 60 * 1000;
/** a claim this old belongs to a request that died without releasing it */
export const IDEMPOTENCY_PENDING_RECLAIM_MS = 60_000;
const RETRY_AFTER_S = 5;
const MAX_KEY_LEN = 255;

const in_progress = () =>
  problem(409, "idempotency_in_progress", {
    detail:
      "A request with this Idempotency-Key is still running. Retry the same request, with the same Idempotency-Key and the same body, after a few seconds.",
    headers: { "retry-after": String(RETRY_AFTER_S) },
  });

const conflict = () =>
  problem(409, "idempotency_conflict", {
    detail:
      "This Idempotency-Key was already used for a different request. Send a new key for a new request.",
  });

const sha256_hex = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const idem_key_of = (request: Request) =>
  request.headers.get("Idempotency-Key")?.trim() ?? "";

/**
 * One logical write per `(key_id, Idempotency-Key)`. The handler runs only
 * when this call owns a fresh `pending` row. A 4xx from the handler deletes
 * that row, since nothing was written. A throw or a 5xx may follow a write that
 * landed, so the row stays pending: a retry inside
 * `IDEMPOTENCY_PENDING_RECLAIM_MS` is in progress, and past it a retry of the
 * same body takes the claim with the same `resource_id`.
 *
 * The handler gets the record's `resource_id`, the id a create inserts. A
 * reclaim keeps it, so a retry after a write that landed finds that write; a
 * record replaced after 24h gets a new one, so a reused key makes a new resource.
 */
export async function with_idempotency(
  db: DbOrTx,
  key_id: string,
  request: Request,
  handler: (resource_id: string) => Promise<Response>
): Promise<Response> {
  const idem_key = idem_key_of(request);
  if (!idem_key || idem_key.length > MAX_KEY_LEN) {
    return problem(400, "idempotency_key_required");
  }

  const raw = await request.clone().text();
  const request_hash = sha256_hex(raw);

  // a lost race re-reads; a comparison that never deletes must not spin
  for (let spins = 0; spins < 4; spins++) {
    const inserted = await db
      .insert(connector_idempotency)
      .values({
        key_id,
        idem_key,
        request_hash,
        status: "pending",
      })
      .onConflictDoNothing()
      .returning({ resource_id: connector_idempotency.resource_id });

    if (inserted.length === 1) {
      return finish(db, key_id, idem_key, inserted[0].resource_id, handler);
    }

    const [row] = await db
      .select()
      .from(connector_idempotency)
      .where(
        and(
          eq(connector_idempotency.key_id, key_id),
          eq(connector_idempotency.idem_key, idem_key)
        )
      );
    if (!row) continue;

    const created_ms = Date.parse(row.created_at);
    if (
      row.status === "stored" &&
      (Number.isNaN(created_ms) || created_ms + IDEM_MS < Date.now())
    ) {
      await db
        .delete(connector_idempotency)
        .where(
          and(
            eq(connector_idempotency.key_id, key_id),
            eq(connector_idempotency.idem_key, idem_key),
            lt(
              connector_idempotency.created_at,
              new Date(Date.now() - IDEM_MS).toISOString()
            )
          )
        );
      continue;
    }

    if (row.request_hash !== request_hash) return conflict();

    if (row.status === "pending") {
      if (created_ms + IDEMPOTENCY_PENDING_RECLAIM_MS >= Date.now()) {
        return in_progress();
      }
      // guarded on the age, so of two retries only one restamps the claim
      const reclaimed = await db
        .update(connector_idempotency)
        .set({ created_at: new Date().toISOString() })
        .where(
          and(
            eq(connector_idempotency.key_id, key_id),
            eq(connector_idempotency.idem_key, idem_key),
            eq(connector_idempotency.status, "pending"),
            lt(
              connector_idempotency.created_at,
              new Date(
                Date.now() - IDEMPOTENCY_PENDING_RECLAIM_MS
              ).toISOString()
            )
          )
        )
        .returning({ resource_id: connector_idempotency.resource_id });
      if (reclaimed.length === 1) {
        return finish(db, key_id, idem_key, reclaimed[0].resource_id, handler);
      }
      continue;
    }

    // replay is 200 even when the row stored a 201
    return Response.json(row.response_body, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  }

  return in_progress();
}

const release_pending = (db: DbOrTx, key_id: string, idem_key: string) =>
  db
    .delete(connector_idempotency)
    .where(
      and(
        eq(connector_idempotency.key_id, key_id),
        eq(connector_idempotency.idem_key, idem_key),
        eq(connector_idempotency.status, "pending")
      )
    );

async function finish(
  db: DbOrTx,
  key_id: string,
  idem_key: string,
  resource_id: string,
  handler: (resource_id: string) => Promise<Response>
): Promise<Response> {
  // a throw keeps the claim: the write may have landed before it
  const res = await handler(resource_id);

  const text = await res.text();
  const headers = new Headers(res.headers);
  headers.set("cache-control", "no-store");
  // a refusal wrote nothing, so free the key; a 5xx keeps the claim like a throw
  if (res.status < 200 || res.status >= 300) {
    if (res.status < 500) await release_pending(db, key_id, idem_key);
    return new Response(text, { status: res.status, headers });
  }

  // the handler already returned. a parse or store failure must keep the claim
  const response_body: unknown = JSON.parse(text);
  await db
    .update(connector_idempotency)
    .set({
      status: "stored",
      response_status: res.status,
      response_body,
    })
    .where(
      and(
        eq(connector_idempotency.key_id, key_id),
        eq(connector_idempotency.idem_key, idem_key)
      )
    );
  return new Response(text, { status: res.status, headers });
}
