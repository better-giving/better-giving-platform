import {
  admin_ctx,
  auth_mdlwr,
  npo_admin_mdlwr,
  user_ctx,
} from "#/.server/auth";
import { Layout } from "#/layout/dashboard";
import { npo_get } from "$/pg/queries/npo";
import type { Route } from "./+types/route";
import { linkGroups } from "./constants";
import { OrgSwitcher } from "./org-switcher";
import { admin_title } from "./page-meta";
import type { LoaderData } from "./types";

export { ErrorBoundary } from "#/components/error";

export const meta: Route.MetaFunction = ({ loaderData: d }) =>
  admin_title("Dashboard", d?.endow.name);

export const middleware = [auth_mdlwr, npo_admin_mdlwr];

export const loader = async ({ context }: Route.LoaderArgs) => {
  const user = context.get(user_ctx);
  const id = context.get(admin_ctx);

  const npo = await npo_get(id);
  if (!npo) throw new Response("Not found", { status: 404 });

  return {
    user,
    id,
    endow: {
      logo: npo.logo,
      name: npo.name,
      allocation: npo.allocation,
      payout_minimum: npo.payout_minimum,
    },
  } satisfies LoaderData;
};

export default function AdminLayout({
  loaderData: data,
}: Route.ComponentProps) {
  return (
    <Layout
      rootRoute="/admin/:id/"
      linkGroups={linkGroups}
      headerContext={<OrgSwitcher {...data.endow} />}
    />
  );
}
