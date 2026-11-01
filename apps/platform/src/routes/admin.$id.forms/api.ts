import { admin_ctx } from "#/.server/auth";
import { forms_owned_by } from "$/pg/queries/form";
import type { Route } from "./+types/route";

export const loader = async (x: Route.LoaderArgs) => {
  const id = x.context.get(admin_ctx);
  const raw = x.url.searchParams.get("status");
  const status = raw === "active" || raw === "inactive" ? raw : undefined;
  const forms = await forms_owned_by(id.toString(), { status });
  return { ...forms, status: status ?? "all" };
};
