import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as v from "valibot";
import { reserve_ip } from "$/connector/gate";
import { connector_route } from "$/connector/http";
import { exchange_code } from "$/connector/keys";
import { problem } from "$/connector/problem";
import { db } from "$/pg/db";

const NO_STORE = { "cache-control": "no-store" };

const exchange_body = v.object({ code: v.string() });

export function loader(_args: LoaderFunctionArgs) {
  return problem(404, "unknown_action");
}

export const action = connector_route(
  async ({ request }: ActionFunctionArgs) => {
    if (request.method !== "POST") return problem(404, "unknown_action");
    if (!reserve_ip("exchange", request)) return problem(429, "rate_limited");

    let raw: unknown;
    try {
      raw = JSON.parse(await request.text());
    } catch {
      return problem(400, "code_invalid");
    }
    const parsed = v.safeParse(exchange_body, raw);
    if (!parsed.success) return problem(400, "code_invalid");

    const exchanged = await exchange_code(db, parsed.output.code);
    if (!exchanged.ok) return problem(400, "code_invalid");
    return Response.json(
      { key: exchanged.key, name: exchanged.name },
      { headers: NO_STORE }
    );
  }
);
