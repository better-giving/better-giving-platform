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
  // what the form holds is shown whole: when the allowed decimals shrink (a
  // currency or token switch), "1.2345" stays visible beside the schema's
  // message naming the cap instead of the box showing a trimmed value the form
  // doesn't hold. the mask caps only what the user adds, so the next display
  // is stored whole too
  const display = decimal.format(value, Number.POSITIVE_INFINITY);
  const on_display = useCallback(
    (next: string) => onChange(decimal.unmask(next, Number.POSITIVE_INFINITY)),
    [onChange]
  );
  const { ref: set_ref, onInput } = useMaskedInput({
    mask,
    display,
    on_display,
    ref,
  });
  return {
    ref: set_ref,
    onInput,
    value: display,
    // a no-op: React wants an onChange beside `value`, and typing is handled
    // by onInput
    onChange: () => {},
    inputMode: "decimal" as const,
  };
}
