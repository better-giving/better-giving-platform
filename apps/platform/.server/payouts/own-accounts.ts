import { is_own_account } from "@/banking/own-account";
import type { AccountDetails, V2RecipientAccount } from "@/wise";
import { wise as wise_env } from "../env";
import { wise } from "../kit/wise";

// our account details change when ops opens a balance, not per payout
const TTL_MS = 60 * 60 * 1000;

let cached: { at: number; details: Promise<AccountDetails[]> } | null = null;

/** the receiving details of our own wise profile, held per instance for an
 * hour. a failed lookup is not held, so the next call asks again */
function own_account_details(): Promise<AccountDetails[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.details;
  const entry = {
    at: Date.now(),
    details: wise.account_details(wise_env.profile_id),
  };
  cached = entry;
  entry.details.catch(() => {
    if (cached === entry) cached = null;
  });
  return entry.details;
}

/** whether paying `r` pays one of our own wise balances. rejects when our
 * details can't be read: callers refuse rather than guess */
export async function is_own_recipient(r: V2RecipientAccount) {
  return is_own_account(r, await own_account_details());
}
