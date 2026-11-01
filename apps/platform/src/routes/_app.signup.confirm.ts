import {
  type ActionFunction,
  type LoaderFunction,
  redirect,
} from "react-router";

/** the typed-code screen is gone — verification is a link now. skew protection
 * has no `.data` pinning, so old documents still linking or POSTing here must
 * land on the inbox screen rather than 404/405. */
const to_check_email = (url: URL) => redirect(`/check-email${url.search}`);

export const loader: LoaderFunction = ({ url }) => to_check_email(url);
export const action: ActionFunction = ({ url }) => to_check_email(url);
