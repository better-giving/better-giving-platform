import { auth_mdlwr } from "#/.server/auth";
import { AllowScreen } from "#/components/connector/allow-screen";
import { metas } from "#/helpers/seo";
import type { Route } from "./+types/route";

export { action, loader } from "./api";

export const middleware = [auth_mdlwr];

export const meta: Route.MetaFunction = () => metas({ title: "Connect" });

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className="page py-10">
      <AllowScreen
        nonprofits={loaderData.nonprofits}
        state={loaderData.state}
        email={loaderData.email}
        client={loaderData.client}
        error={
          actionData?.error ??
          (loaderData.blocked ? loaderData.error : undefined)
        }
        blocked={loaderData.blocked}
      />
    </main>
  );
}
