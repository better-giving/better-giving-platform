import { check, type InferOutput, object, pipe, url } from "valibot";
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
