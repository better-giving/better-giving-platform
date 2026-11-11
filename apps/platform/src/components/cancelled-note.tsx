const copy = {
  npo: "Recorded twice. This duplicate was cancelled, so it doesn't count toward your totals. No refund was made.",
  donor:
    "Recorded twice. This duplicate was cancelled. No refund was made, and your gift is recorded once.",
  referrer:
    "Recorded twice. This duplicate was cancelled, so it earns no referral commission. No refund was made.",
};

/** what a cancelled duplicate's tooltip says, to whoever is reading. a
 * duplicate's dist reads `refunded`, so without this it would read as a refund
 * nobody was given. a function, not a component: the tooltip reads its
 * description off the element tree and cannot see through a component's output */
export const cancelled_note = (audience: keyof typeof copy = "npo") => (
  <>
    <span className="font-semibold">Cancelled</span>
    <br />
    {copy[audience]}
  </>
);
