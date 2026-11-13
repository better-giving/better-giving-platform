import type { ActionFunction } from "react-router";
import { verify_qstash } from "$/kit/queue";
import { wise } from "$/kit/wise";
import { poll_wise_returns } from "$/payouts/wise-return";

/** finds the grants runs whose wise transfer came back, and takes each back
 * into the npo's books (`.server/payouts/wise-return.ts`) */
export const action: ActionFunction = async ({ request }) => {
  await verify_qstash(request);
  await poll_wise_returns(async (id) => {
    const t = await wise.transfer_get(id);
    if (!t.status) throw new Error(`wise transfer ${id} has no status`);
    return t.status;
  });
  return new Response("ok", { status: 200 });
};
