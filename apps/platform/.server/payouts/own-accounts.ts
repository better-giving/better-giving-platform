import type { AccountDetails, V2RecipientAccount } from "@/wise";
import { wise as wise_env } from "../env";
import { wise } from "../kit/wise";

const norm = (v: unknown) =>
  typeof v === "string" || typeof v === "number"
    ? String(v)
        .replace(/[^0-9a-z]/gi, "")
        .toUpperCase()
    : "";

/** the recipient's account identifiers: account number or IBAN, wherever
 * wise puts them. a bank code alone is shared by every customer of the bank,
 * so it never counts */
function recipient_ids(r: V2RecipientAccount): string[] {
  const keys = ["accountNumber", "iban", r.commonFieldMap?.accountNumberField];
  const from_details = keys.map((k) => (k ? r.details?.[k] : undefined));
  const from_display = (r.displayFields ?? [])
    .filter((f) => /\/(accountNumber|iban)$/i.test(f.key))
    .map((f) => f.value);
  return [...from_details, ...from_display].map(norm).filter(Boolean);
}

/** whether paying `r` would pay one of our own wise balances, whose receiving
 * details are `own` */
export function is_own_account(
  r: V2RecipientAccount,
  own: AccountDetails[]
): boolean {
  if (r.ownedByCustomer === true) return true;
  const ours = new Set(
    own.flatMap((a) =>
      a.receiveOptions.flatMap((o) => o.details.map((d) => norm(d.body)))
    )
  );
  return recipient_ids(r).some((id) => ours.has(id));
}

/** approving a nonprofit's bank account that is one of ours */
export const OWN_ACCOUNT_REFUSAL =
  "This bank account belongs to Better Giving, so it can't receive the nonprofit's payouts.";
/** approving one whose check failed: approval fails closed */
export const OWN_LOOKUP_REFUSAL =
  "We couldn't check this bank account against Better Giving's own accounts. Try again in a few minutes.";

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
