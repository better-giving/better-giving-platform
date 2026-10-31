import { Tabs } from "@better-giving/ui";
import {
  Outlet,
  type ShouldRevalidateFunction,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { admin_ctx } from "#/.server/auth";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { npo_donor_tab_counts } from "$/pg/queries/donor";
import type { Route } from "./+types/route";

export { ErrorBoundary } from "#/components/error";

export const loader = async (x: Route.LoaderArgs) => {
  const npo_id = x.context.get(admin_ctx);
  return npo_donor_tab_counts(npo_id);
};

// only revalidate on path change — child sort/cursor params shouldn't refetch tab counts
export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}) =>
  currentUrl.pathname === nextUrl.pathname ? false : defaultShouldRevalidate;

export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Donors", matches);

export default function Page({
  loaderData: { donor_total, sub_count },
}: Route.ComponentProps) {
  const { id } = useParams<{ id: string }>();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (!id) throw new Error("missing npo id");
  const base = `/admin/${id}/donors`;
  const tab = pathname.endsWith("/subscribers") ? "subscribers" : "donors";
  return (
    <div className="px-6 py-4 md:px-10 md:py-8 max-w-[1400px]">
      <div className="grid gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Donors</h1>
        <Tabs
          className="w-full"
          stretch
          value={tab}
          onValueChange={(value) => {
            navigate(value === "subscribers" ? `${base}/subscribers` : base);
          }}
          items={[
            {
              value: "donors",
              label: `All donors ${donor_total.toLocaleString("en-US")}`,
            },
            {
              value: "subscribers",
              label: `Subscribers ${sub_count.toLocaleString("en-US")}`,
            },
          ]}
        >
          {null}
        </Tabs>
      </div>
      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
