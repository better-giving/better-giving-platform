import { npo_default_bapp } from "$/pg/queries/banking";
import { npo_by_rid } from "$/pg/queries/npo";
import { user_by_referral_code } from "$/pg/queries/user";

interface Referrer {
  pay_id?: number;
  /** when a nonprofit referrer's payout account was approved or made default */
  pay_since?: string;
  /** default $50 */
  pay_min: number;
  id: string;
  name: string;
  email: string;
}

export async function get_referrer(
  referral_id: string
): Promise<Referrer | null> {
  //handle nonprofit referrer
  if (referral_id.startsWith("NPO-")) {
    const item = await npo_by_rid(referral_id);
    if (!item) return null;

    //get default payout method
    const bapp = await npo_default_bapp(item.id);
    const wise_id = bapp?.id;

    return {
      id: referral_id,
      name: item.name,
      email: "n/a",
      pay_id: wise_id ? +wise_id : undefined,
      pay_since: bapp ? (bapp.updated_at ?? bapp.date_created) : undefined,
      pay_min: 50,
    };
  }

  const user = await user_by_referral_code(referral_id);
  if (!user) return null;

  return {
    name: `${user.first_name} ${user.last_name}`,
    email: user.email,
    pay_id: user.pay_id ? +user.pay_id : undefined,
    // non-null: see `IUserRow`'s doc comment
    pay_min: user.pay_min!,
    id: user.referral_code!,
  };
}
