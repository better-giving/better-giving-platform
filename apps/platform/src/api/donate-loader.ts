import { data, type LoaderFunctionArgs } from "react-router";
import * as v from "valibot";
import { type AuthUser, get_session } from "#/.server/auth";
import { npo_id } from "#/pages/marketplace/npo-id";
import { resp, search } from "@/helpers/https";
import type { IProgram } from "@/npo";
import { program_id } from "@/npo/schema";
import {
  type INpoPublic,
  npo_by_slug,
  npo_get,
  npo_public,
} from "$/pg/queries/npo";
import { npo_program_get, npo_program_owned } from "$/pg/queries/program";

export interface DonateData {
  id: number;
  endow: INpoPublic;
  /** need to await */
  program?: IProgram;
  user?: AuthUser;
  base_url: string;
  /** the `:id` segment the visitor used — numeric id or org slug */
  arrived: string;
}

export const loader = async ({ params, request, url }: LoaderFunctionArgs) => {
  const { programId } = search(url);
  const p1 = v.safeParse(v.optional(program_id), programId);
  if (p1.issues) throw resp.status(400, p1.issues[0].message);
  const pid = p1.output;
  // same split as the marketplace profile: a number-like segment is an id
  const key = npo_id(params.id ?? "");
  const endow = await (typeof key === "number"
    ? npo_get(key)
    : npo_by_slug(key));
  if (!endow || endow.active === false) {
    throw new Response(null, { status: 404 });
  }
  const id = endow.id;

  const { user } = await get_session(request);
  // another npo's program is dropped, not refused: the link still reaches this npo
  const program =
    pid && (await npo_program_owned(id, pid))
      ? await npo_program_get(pid)
      : undefined;

  return data({
    id,
    endow: npo_public(endow),
    program,
    user,
    base_url: url.origin,
    arrived: params.id ?? String(id),
  } satisfies DonateData);
};
