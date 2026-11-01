import { href, redirect } from "react-router";
import type { Route } from "./+types/route";

export const loader = ({ params, url }: Route.LoaderArgs) =>
  redirect(`${href("/org/:org", { org: params.id })}${url.search}`);
