import type Stripe from "stripe";
import { stripe } from "$/kit/stripe";

/**
 * @param currency - uppercase
 * @param email - lowercase
 */
export async function customer_with_currency(
  currency: string,
  email: string,
  /** a retry with the same key is answered the customer it first made */
  idempotency_key?: string
): Promise<string> {
  // search for existing Stripe Customer data
  const actives: Stripe.Customer[] = [];
  let next_page: string | undefined;
  do {
    const result = await stripe.customers.search({
      expand: ["data.subscriptions"], // needed so we can check if customer has existing subs
      query: `email:"${email}"`,
      page: next_page,
    });

    actives.push(...result.data.filter((x) => !x.deleted));
    // must reassign unconditionally; keeping a stale cursor loops forever
    next_page = result.next_page ?? undefined;
  } while (next_page);

  const with_currency = actives.find(
    (x) => x.currency?.toUpperCase() === currency
  );

  if (with_currency) return with_currency.id;

  //create new customer for the desired currency
  const created = idempotency_key
    ? stripe.customers.create({ email }, { idempotencyKey: idempotency_key })
    : stripe.customers.create({ email });
  return created.then((x) => x.id);
}
