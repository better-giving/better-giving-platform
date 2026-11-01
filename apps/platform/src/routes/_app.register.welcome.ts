import {
  type ActionFunction,
  type LoaderFunction,
  redirect,
} from "react-router";

/** `/register` is the welcome screen. skew protection has no `.data` pinning,
 * so old documents still linking or POSTing here must land somewhere real
 * rather than 404/405. */
const to_register = (url: URL) => redirect(`/register${url.search}`);

export const loader: LoaderFunction = ({ url }) => to_register(url);
export const action: ActionFunction = ({ url }) => to_register(url);
