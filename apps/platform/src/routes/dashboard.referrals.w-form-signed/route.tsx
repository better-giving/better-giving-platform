import { ArrowDownToLine, CircleCheck } from "lucide-react";
import { Link, useNavigation } from "react-router";
import { RouteModal } from "#/components/route-modal";
import type { Route } from "./+types/route";
import type { LoaderData } from "./api";

export { ErrorModal as ErrorBoundary } from "#/components/error";
export { loader } from "./api";

export default function Page({ loaderData: data }: Route.ComponentProps) {
  return (
    <RouteModal classes="grid bg-card text-gray-12 p-6 text-center">
      <Content {...data} />
    </RouteModal>
  );
}

function Content(props: LoaderData) {
  const navigation = useNavigation();
  const is_loading = navigation.state === "loading";

  return (
    <>
      <CircleCheck className="text-success mx-auto pictogram-lg" />
      <h1 className="text-2xl uppercase text-center mt-10 mb-4">
        Tax Form submission saved!
      </h1>

      <a
        download
        href={`/api/anvil-doc/${props.doc_eid}`}
        className="link mb-4 inline-block"
      >
        <ArrowDownToLine className="icon-lg inline bottom-px relative mr-1" />
        <span className="text-sm font-semibold">Download</span>
      </a>

      <Link
        aria-disabled={is_loading}
        className="w-full max-w-105 justify-self-center btn btn-primary mt-4"
        to="../payout"
      >
        Continue
      </Link>
    </>
  );
}
