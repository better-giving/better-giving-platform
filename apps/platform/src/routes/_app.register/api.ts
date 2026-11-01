import { to_auth } from "#/.server/auth";
import { reg_user } from "#/pages/registration/data/reg-user";
import type { Route } from "./+types/route";

export const loader = async ({ request, url }: Route.LoaderArgs) => {
  // this layer wraps the contact step, so it answers to the draft grant the
  // same way that step does. the index screen under it keeps its own
  // session-only gate.
  const ru = await reg_user(request, true);
  if (!ru) return to_auth(url);
  return ru.user;
};
