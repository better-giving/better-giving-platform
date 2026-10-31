import { href } from "react-router";
import { admin_mdlwr, auth_mdlwr } from "#/.server/auth";
import { metas } from "#/helpers/seo";
import { Layout } from "#/layout/dashboard";
import type { Route } from "./+types/route";
import { link_groups } from "./constants";

export { ErrorBoundary } from "#/components/error";

export const meta: Route.MetaFunction = () =>
  metas({ title: "Platform Admin" });

export const middleware = [auth_mdlwr, admin_mdlwr];

export default function Page() {
  return (
    <Layout rootRoute={`${href("/platform")}/`} linkGroups={link_groups} />
  );
}
