//token selector
import * as v from "valibot";
import { to_text } from "#/components/rich-text/helpers";
import { donate_method_id } from "@/npo/schema";

//selector
export type ValKey = string | number;
export type OptionType<V extends ValKey> = { label: string; value: V };

const wise_currency_option = v.object({
  code: v.string(),
  name: v.string(),
  rate: v.null(),
});

export interface WiseCurrencyOption
  extends v.InferOutput<typeof wise_currency_option> {}

/**
 * Rich text strings contain not only the user input itself, but is a
 * stringified object that describes the styling of particular parts of
 * the text (bolding, italics, lists etc.), which complicates getting the
 * plain character length for checking whether the user has passed the max
 * char. threshold.
 * In order to avoid having to extract and calculate the plain text characters
 * after they have been included in the rich text string, we save the character
 * length as the text is being typed as a separate parameter and use *it* for
 * any validation necessary.
 */
interface RichTextContentOptions {
  maxChars?: number;
  required?: boolean;
}
/** the length cap on `{ value, length? }`. the count is the stored `length`, or
 * the text's own when a story was saved without one — so a long story that
 * arrives without a length can't slip past the cap. */
export const richtext_max = (maxChars: number) =>
  v.forward(
    v.check(
      (c: { value: string; length?: number | undefined }) =>
        (c.length ?? to_text(c.value).length) <= maxChars,
      `max length is ${maxChars} chars`
    ),
    ["length"]
  );

export const richtext_content = ({
  maxChars = Number.MAX_SAFE_INTEGER,
  required = false,
}: RichTextContentOptions) => {
  return v.pipe(
    v.object({
      value: required
        ? v.pipe(v.string("required"), v.nonEmpty("required"))
        : v.string("dev:set default value to empty"),
      length: v.optional(v.number()),
    }),
    richtext_max(maxChars)
  );
};

/** the state of an in-flight fetch, as a hook returns it */
export interface QueryState<T> {
  error?: unknown;
  data?: T | undefined;
  is_loading: boolean;
  is_fetching: boolean;
  is_error: boolean;
}

export type RichTextContent = v.InferOutput<
  ReturnType<typeof richtext_content>
>;

export const donate_method = v.object({
  id: donate_method_id,
  name: v.string(),
  disabled: v.boolean(),
});

export type TDonateMethod = v.InferOutput<typeof donate_method>;

//re-exports
export type { ICurrencyFv } from "#/types/currency";

export interface IPaginator<T> {
  items: T[];
  load_next?: () => void;
  loading?: boolean;
  disabled?: boolean;
  classes?: string;
}
