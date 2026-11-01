import { safeParse } from "valibot";
import type { TStatus } from "@/banking";
import { resp, search } from "@/helpers/https";
import { $int_gte1 } from "@/schemas";
import { bapps_by_status } from "$/pg/queries/banking";
import type { Route } from "./+types/route";

export const loader = async ({ url }: Route.LoaderArgs) => {
  const { status = "under-review", nextPageKey, endowmentID } = search(url);

  // "default" is an approved account that is also the npo's primary one — a
  // verdict, not a review state of its own, so it rides with "approved".
  // "" = all reviewable statuses.
  const statuses: TStatus[] =
    status === "approved"
      ? ["approved", "default"]
      : status
        ? [status as TStatus]
        : ["under-review", "approved", "rejected", "default"];

  let npo_id: number | undefined;
  if (endowmentID) {
    const p = safeParse($int_gte1, endowmentID);
    if (p.issues) throw resp.status(400, p.issues[0].message);
    npo_id = p.output;
  }

  const page = await bapps_by_status(statuses, {
    next: nextPageKey as string | undefined,
    npo_id,
  });
  return page;
};
