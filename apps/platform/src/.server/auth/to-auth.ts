import { href, redirect } from "react-router";

export const to_auth = (from: URL, headers?: Headers) => {
  // copy of the arrival url — keeps its query (e.g. ?referrer) on the signup
  // url, which is the root loader's next chance to persist it. don't rebuild
  // this as a bare /signup url.
  const to = new URL(from);
  const { pathname: p, search: s } = from;
  to.pathname = href("/signup");
  to.searchParams.set("redirect", p + s);
  return redirect(to.toString(), { headers });
};
