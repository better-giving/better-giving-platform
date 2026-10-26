import { type LoaderFunction, redirect } from "react-router";

// redirect donate-fund/{id} to campaigns/{id}/donate
export const loader: LoaderFunction = async ({ params, request }) => {
  const from = new URL(request.url);
  from.pathname = `campaigns/${params.fund_id}/donate`;
  return redirect(from.toString(), { status: 301 });
};
