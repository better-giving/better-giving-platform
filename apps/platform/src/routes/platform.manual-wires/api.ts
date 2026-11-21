import * as v from "valibot";
import { humanize } from "@/helpers/decimal";
import { resp } from "@/helpers/https";
import {
  type IMarkWired,
  type MarkWiredResult,
  mark_wired,
} from "$/payouts/manual-wire";
import { manual_wire_rows } from "$/pg/queries/manual-wire";
import type { Route } from "./+types/route";

export const loader = async () => ({ rows: await manual_wire_rows() });

/** what a refusal calls each field */
const LABELS: Record<keyof IMarkWired, string> = {
  npo_id: "nonprofit",
  wire_date: "wire date",
  amount_sent: "amount sent",
  provider: "provider",
  provider_tx_id: "transaction id",
  wire_fee: "wire fee",
};

// shapes only: `mark_wired` judges the values and answers `invalid`
const body = v.object({
  npo_id: v.pipe(v.number(), v.integer()),
  wire_date: v.string(),
  amount_sent: v.number(),
  provider: v.string(),
  provider_tx_id: v.pipe(v.string(), v.trim()),
  wire_fee: v.number(),
});

interface IDone {
  ok: true;
}

/** what the action answers: `resp.fail`'s body on a refusal, which typegen
 * can't see through the `Response` */
export type TWireAnswer = IDone | { status: number; message: string };

/** "$4,200.00", "−$5.00" */
const usd = (n: number) => `${n < 0 ? "−" : ""}$${humanize(Math.abs(n))}`;

export const action = async ({ request }: Route.ActionArgs) => {
  const p = v.safeParse(body, await request.json().catch(() => null));
  if (p.issues) {
    const key = p.issues[0].path?.[0]?.key;
    const label = LABELS[key as keyof IMarkWired];
    return resp.fail(
      400,
      label ? `Check the ${label}` : "Check the form and try again"
    );
  }
  return answer(p.output, await mark_wired(p.output));
};

function answer(sent: IMarkWired, res: MarkWiredResult) {
  switch (res.status) {
    case "ok":
      return { ok: true } satisfies IDone;
    case "invalid":
      return resp.fail(400, `Check the ${LABELS[res.field]}`);
    case "duplicate":
      return resp.fail(
        409,
        `Transaction ${sent.provider_tx_id} from ${sent.provider} is already recorded. Check the id with the provider.`
      );
    case "not_manual_wire":
      return resp.fail(409, "This nonprofit is not paid by manual wire");
    case "none_pending":
      return resp.fail(409, "Nothing is pending for this nonprofit");
    case "under_minimum":
      return resp.fail(409, `Under the ${usd(res.minimum)} payout minimum`);
    case "amount_mismatch":
      return resp.fail(
        409,
        `The amount sent must be ${usd(res.expected)}, the net total less the wire fee`
      );
    case "held":
      return resp.fail(
        409,
        "A returned transfer holds this nonprofit's payouts"
      );
  }
}
