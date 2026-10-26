import { type LoaderFunction, redirect } from "react-router";

// redirect funds/{id} to campaigns/{id}
export const loader: LoaderFunction = async ({ request, params }) => {
  const path = params["*"];
  const from = new URL(request.url);
  from.pathname = `campaigns/${path}`;
  return redirect(from.toString(), { status: 301 });
};
