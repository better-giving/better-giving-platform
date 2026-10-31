const usd = (decimals = 0) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/** "$1,234" — whole dollars by default; `decimals: 2` for a money figure that
 *  shows cents ("$0.00"). from 1M up it shortens to "$1.20M" / "$3.40B"
 *  either way. the sign is never followed by a space. */
export function to_usd(num: number, decimals: 0 | 2 = 0): string {
  const n = Math.abs(num);
  if (n < 1_000_000) {
    return usd(decimals).format(num);
  }

  if (n < 1_000_000_000) {
    const millions = num / 1_000_000;
    //millions with two decimal points
    return `${usd(2).format(millions)}M`;
  }
  const billions = num / 1_000_000_000;
  return `${usd(2).format(billions)}B`;
}
