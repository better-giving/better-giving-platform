import { ArrowDownToLine, CircleCheck } from "lucide-react";
import { href, Link, useNavigation, useRouteLoaderData } from "react-router";
import { next_step } from "#/pages/registration/routes";
import type { Reg$IdData } from "#/pages/registration/types";
import { Progress } from "@/reg/progress";
import type { SignerCompleteQueryParams } from "./types";

export default function Success({
  documentGroupEid,
}: SignerCompleteQueryParams) {
  const navigation = useNavigation();
  const { reg } = useRouteLoaderData(
    "routes/_app.register.$reg_id"
  ) as Reg$IdData;
  const step = new Progress(reg).step;

  const is_loading = navigation.state === "loading";

  return (
    <>
      <CircleCheck className="text-success pictogram-lg" />
      <h1 className="text-2xl text-center mt-10 mb-4">
        Fiscal Sponsorship Agreement signature was successfully saved!
      </h1>

      <a
        download
        href={`/api/anvil-doc/${documentGroupEid}`}
        className="link mb-4 inline-block"
      >
        <ArrowDownToLine className="icon-lg inline bottom-px relative mr-1" />
        <span className="text-sm font-semibold">Download</span>
      </a>
      <Link
        aria-disabled={is_loading}
        className="w-full max-w-105 btn btn-primary mt-4"
        to={`${href("/register/:reg_id", {
          reg_id: reg.id,
        })}/${next_step[step]}`}
      >
        {is_loading ? "Loading..." : "Continue"}
      </Link>
    </>
  );
}
