import { and, eq } from "drizzle-orm";
import { data, redirect } from "react-router";
import { user_ctx } from "#/.server/auth";
import { type ClientId, parse_client } from "#/components/connector/clients";
import { issue_code } from "$/connector/keys";
import { origin_allowed, request_origin } from "$/connector/origins";
import { connector_return_url } from "$/connector/return-url";
import { db } from "$/pg/db";
import { npos } from "$/pg/schema/npo";
import { user_npo_memberships } from "$/pg/schema/user";
import type { Route } from "./+types/route";

const STATE_RE = /^[A-Za-z0-9._~-]{1,512}$/;

export const CONNECTION_REFUSED =
  "This connection request can't be completed. Start again from the chat.";

const refused = () => data({ error: CONNECTION_REFUSED }, { status: 400 });

// a returned Response is loader data the page cannot read, so the render throws
// into the generic boundary and gets reported. `data()` stays on this screen.
const blocked = (shared: Shared) =>
  data(
    {
      ...shared,
      nonprofits: [],
      state: "",
      error: CONNECTION_REFUSED,
      blocked: true as const,
    },
    { status: 400 }
  );

/** what the page shows whether or not the request is usable */
interface Shared {
  email: string;
  client: ClientId | null;
}

const state_ok = (state: string) => STATE_RE.test(state);

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

const npo_id_of = (raw: string) => {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  return Number(raw);
};

const memberships_of = (user_id: string) =>
  db
    .select({ id: npos.id, name: npos.name })
    .from(user_npo_memberships)
    .innerJoin(npos, eq(npos.id, user_npo_memberships.npo_id))
    .where(eq(user_npo_memberships.user_id, user_id))
    .orderBy(npos.name);

const see_other = (href: string, query: Record<string, string>) => {
  const url = new URL(href);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return redirect(url.toString(), 303);
};

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const query = new URL(request.url).searchParams;
  const state = query.get("state") ?? "";
  const user = context.get(user_ctx);
  const shared: Shared = {
    email: user.email,
    client: parse_client(query.get("client")),
  };
  if (!state_ok(state)) return blocked(shared);
  const nonprofits = await memberships_of(user.id);
  return { ...shared, nonprofits, state, blocked: false as const };
};

export const action = async ({ request, context }: Route.ActionArgs) => {
  const form = await request.formData();
  const state = field(form, "state");
  if (!state_ok(state)) return refused();

  const origin = request_origin(request);
  if (!origin_allowed(origin, process.env)) return refused();

  const decision = field(form, "decision");
  const back = connector_return_url(process.env);
  if (decision === "deny") {
    return see_other(back, { error: "access_denied", state, iss: origin });
  }
  if (decision !== "allow") return refused();

  const npo_id = npo_id_of(field(form, "npo_id"));
  if (npo_id === null)
    return data({ error: "Choose a nonprofit" }, { status: 400 });
  const user = context.get(user_ctx);
  const [member] = await db
    .select({ npo_id: user_npo_memberships.npo_id })
    .from(user_npo_memberships)
    .where(
      and(
        eq(user_npo_memberships.user_id, user.id),
        eq(user_npo_memberships.npo_id, npo_id)
      )
    )
    .limit(1);
  if (!member) return refused();

  const { code } = await issue_code(db, {
    npo_id,
    allowed_by: user.id,
    iss: origin,
  });
  return see_other(back, { state, iss: origin, code });
};
