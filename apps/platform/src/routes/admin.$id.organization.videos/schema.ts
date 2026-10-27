import {
  check,
  type InferOutput,
  isoTimestamp,
  literal,
  object,
  pipe,
  string,
  transform,
  union,
  url,
} from "valibot";
import { youtube_link_id } from "#/components/youtube-player";
import { $req } from "@/schemas";

export const schema = object({
  url: pipe(
    $req,
    url("invalid url"),
    check(
      (x) => youtube_link_id(x) !== null,
      "only YouTube links are supported"
    )
  ),
});
export interface ISchema extends InferOutput<typeof schema> {}

/** a deleted row's `date_created` sent back with its restore; "" for a row
 * stored without one */
export const restored_date = union([
  pipe(
    literal(""),
    transform(() => null)
  ),
  pipe(string(), isoTimestamp("invalid date")),
]);
