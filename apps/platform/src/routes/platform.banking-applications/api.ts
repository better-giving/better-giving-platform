import { safeParse } from "valibot";
import type { TStatus } from "@/banking";
import { resp, search } from "@/helpers/https";
import { $int_gte1 } from "@/schemas";
import { bapps_by_status } from "$/pg/queries/banking";
import { npos_batch_get } from "$/pg/queries/npo";
import type { Route } from "./+types/route";
import type { IBappRow } from "./table";

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
  const ids = [...new Set(page.items.map((b) => b.npo_id))];
  const names = new Map(
    (await npos_batch_get(ids)).map((npo) => [npo.id, npo.name])
  );
  return {
    ...page,
    items: page.items.map(
      (b): IBappRow => ({ ...b, npo_name: names.get(b.npo_id) })
    ),
  };
};
