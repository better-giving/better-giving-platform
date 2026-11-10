import { useMaskedInput } from "@better-giving/ui";
import { decimal } from "@better-giving/ui/masks";
import type { Ref } from "react";
import { useCallback, useMemo } from "react";

interface Opts {
  /** the plain decimal the form stores: "9627.92", never "9,627.92" */
  value: string;
  onChange: (plain: string) => void;
  /** decimals the field allows. 2 for dollars; a currency's or token's own
   * precision elsewhere; `Number.POSITIVE_INFINITY` for no cap */
  places?: number;
  ref?: Ref<HTMLInputElement>;
}

/** what a masked money `<input>` needs, for a caller that owns the markup.
 * the form keeps the plain decimal and the input shows it grouped, so nothing
 * downstream of the field ever sees a comma. */
export function useMoneyInput({ value, onChange, places = 2, ref }: Opts) {
  const mask = useMemo(() => decimal.decimals(places), [places]);
  const on_display = useCallback(
    (next: string) => onChange(mask.unmask(next)),
    [mask, onChange]
  );
  const { ref: set_ref, onInput } = useMaskedInput({
    mask,
    display: mask.format(value),
    on_display,
    ref,
  });
  return {
    ref: set_ref,
    onInput,
    value: mask.format(value),
    // a no-op: React wants an onChange beside `value`, and typing is handled
    // by onInput
    onChange: () => {},
    inputMode: "decimal" as const,
  };
}
