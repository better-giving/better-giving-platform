import type { AccountDetails, V2RecipientAccount } from "../wise";

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
