/** what a cancelled duplicate's tooltip says. a duplicate's dist reads
 * `refunded`, so without this it would read as a refund nobody was given */
export function CancelledNote({ donor = false }: { donor?: boolean }) {
  return (
    <>
      <span className="font-semibold">Cancelled</span>
      <br />
      {donor
        ? "Recorded twice. This duplicate was cancelled. No refund was made, and your gift is recorded once."
        : "Recorded twice. This duplicate was cancelled, so it doesn't count toward your totals. No refund was made."}
    </>
  );
}
