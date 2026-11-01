import { valibotResolver } from "@hookform/resolvers/valibot";
import { and, eq } from "drizzle-orm";
import { href } from "react-router";
import { getValidatedFormData } from "remix-hook-form";
import { get_session, to_auth } from "#/.server/auth";
import { dataWithError, redirectWithSuccess } from "#/.server/toast";
import type { IForm } from "@/forms";
import { resp, search } from "@/helpers/https";
import type { IProgramDb } from "@/npo";
import { db } from "$/pg/db";
import { form_put } from "$/pg/queries/form";
import { npo_get } from "$/pg/queries/npo";
import {
  npo_program_get,
  npo_program_owned,
  npo_programs,
} from "$/pg/queries/program";
import { user_npo_memberships } from "$/pg/schema/user";
import type { Route as AdminRoute } from "../../../routes/admin.$id.forms/+types/route";
import type { Route as UserRoute } from "../../../routes/dashboard.forms/+types/route";
import { type FV, schema } from "./schema";

export interface INpoOpt {
  id: number;
  name: string;
}

export interface ILoaderData {
  creator: "user" | "admin";
  programs: IProgramDb[];
  /** for user creator */
  npos?: {
    value: INpoOpt | undefined;
  };
}

interface IActors {
  creator: string;
  recipient: string;
}

export const loader = async ({
  request,
  params,
  url,
}: UserRoute.LoaderArgs | AdminRoute.LoaderArgs) => {
  const { user } = await get_session(request);
  if (!user) return to_auth(url);

  //creating inside admin, form is attributed to :id
  if ("id" in params) {
    const npo_id = +params.id;
    if (user.role !== "admin") {
      const [membership] = await db
        .select({ npo_id: user_npo_memberships.npo_id })
        .from(user_npo_memberships)
        .where(
          and(
            eq(user_npo_memberships.user_id, user.id),
            eq(user_npo_memberships.npo_id, npo_id)
          )
        )
        .limit(1);
      if (!membership) throw resp.status(403);
    }
    //load program options
    const progs = await npo_programs(npo_id);
    return {
      creator: "admin",
      programs: progs,
    } satisfies ILoaderData;
  }

  const { npo_id } = search(url);

  if (!npo_id) {
    return {
      creator: "user",
      programs: [],
      npos: { value: undefined },
    } satisfies ILoaderData;
  }

  const npo = await npo_get(+npo_id);
  if (!npo) throw resp.status(404, "npo not found");

  const progs = await npo_programs(+npo_id);

  return {
    creator: "user",
    programs: progs,
    npos: {
      value: { id: +npo_id, name: npo.name },
    },
  } satisfies ILoaderData;
};

export const action = async ({
  request,
  params,
  url,
}: UserRoute.ActionArgs | AdminRoute.ActionArgs) => {
  const fvraw = await getValidatedFormData<FV>(
    request,
    valibotResolver(schema)
  );
  if (fvraw.errors) return fvraw;
  const { data: fv } = fvraw;

  const { user } = await get_session(request);
  if (!user) return to_auth(url);

  let actors: IActors | undefined;
  const { npo_id: y } = search(url);
  if ("id" in params) {
    const x = params.id;

    if (user.role !== "admin") {
      const [membership] = await db
        .select({ npo_id: user_npo_memberships.npo_id })
        .from(user_npo_memberships)
        .where(
          and(
            eq(user_npo_memberships.user_id, user.id),
            eq(user_npo_memberships.npo_id, +x)
          )
        )
        .limit(1);
      if (!membership) throw resp.status(403);
    }
    actors = { creator: x, recipient: x };
  } else if (y) {
    actors = { creator: user.id, recipient: y };
  }
  // the nonprofit selector's `required` doesn't block the submit
  if (!actors) return dataWithError(null, "Select a nonprofit");

  const npo = await npo_get(+actors.recipient);
  if (!npo) throw resp.status(404, "npo not found");

  const form: IForm = {
    id: crypto.randomUUID(),
    date_created: new Date().toISOString(),
    tag: fv.tag,
    name: npo.name,
    target: "smart",
    owner: actors.creator,
    recipient_npo_id: +actors.recipient,
    recipient_fund_id: null,
    ltd: 0,
    ltd_count: 0,
    status: "active",
  };
  // gifts through the form credit its program at settlement; another npo's is dropped
  if (fv.program && (await npo_program_owned(npo.id, fv.program))) {
    const prog = await npo_program_get(fv.program);
    if (prog) form.program = { id: prog.id, name: prog.title };
  }
  await form_put(form);

  return redirectWithSuccess(
    href("/forms/:id/edit", { id: form.id }),
    "Form created"
  );
};
