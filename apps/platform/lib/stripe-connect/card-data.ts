import * as v from "valibot";
import {
  connect_ineligibility,
  type TConnectIneligibility,
} from "./eligibility";
import type { TConnectStatus } from "./readiness";
import {
  CONNECT_REASON_PARAM,
  CONNECT_RESULT_PARAM,
  type TConnectErrorReason,
} from "./return";

// a Record, so a reason added to the union fails to compile here
const reasons: Record<TConnectErrorReason, null> = {
  already_linked: null,
  replace_unconfirmed: null,
  expired: null,
  forbidden: null,
  failed: null,
};

const notice_query = v.variant("result", [
  v.object({ result: v.picklist(["connected", "denied"]) }),
  v.object({
    result: v.literal("error"),
    reason: v.optional(
      v.picklist(Object.keys(reasons) as TConnectErrorReason[])
    ),
  }),
]);

export type TConnectNotice = v.InferOutput<typeof notice_query>;

/** how the connect attempt that returned to `url` ended; anything the callback
 * would not have written reads as no notice */
export function connect_notice(url: URL): TConnectNotice | undefined {
  const q = url.searchParams;
  const reason = q.get(CONNECT_REASON_PARAM);
  const p = v.safeParse(notice_query, {
    result: q.get(CONNECT_RESULT_PARAM),
    ...(reason !== null && { reason }),
  });
  return p.success ? p.output : undefined;
}

export type TConnectTargetQuery =
  | { kind: "reg"; reg_id: string }
  | { kind: "npo"; npo_id: number };

/** the start route's url for `t` — `api.stripe-connect.start` parses this query */
export const connect_start_href = (t: TConnectTargetQuery): string => {
  const q: Record<string, string> =
    t.kind === "reg"
      ? { kind: t.kind, reg_id: t.reg_id }
      : { kind: t.kind, npo_id: `${t.npo_id}` };
  return `/api/stripe-connect/start?${new URLSearchParams(q)}`;
};

/** what a page hands the connect card */
export interface IConnectCardData {
  status: TConnectStatus;
  start_href: string;
  notice?: TConnectNotice;
  /** set when the npo can never route, so connecting would not change that */
  ineligible?: TConnectIneligibility;
}

/** `connect_ineligibility` for a registration that is not an npo yet */
export const reg_ineligibility = (reg: {
  o_type: string;
  o_hq_country: string;
}): TConnectIneligibility | null => {
  const fiscal_sponsored = reg.o_type === "other";
  // empty until the org step: no country to judge yet
  if (!fiscal_sponsored && reg.o_hq_country === "") return null;
  return connect_ineligibility({
    fiscal_sponsored,
    hq_country: reg.o_hq_country,
  });
};
