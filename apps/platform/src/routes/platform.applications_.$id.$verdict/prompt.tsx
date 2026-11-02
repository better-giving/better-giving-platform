import { Actions, Badge, Field } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { ChevronRight, CircleAlert, Info, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link, useFetcher, useParams, useRouteLoaderData } from "react-router";
import { nonEmpty, object, pipe, string, trim } from "valibot";
import { RouteModal } from "#/components/route-modal";
import type { LoaderData } from "#/routes/platform.applications_.$id/api";

function Content() {
  const { verdict } = useParams();
  const review = useRouteLoaderData<LoaderData>(
    "routes/platform.applications_.$id"
  );
  const org_name = review?.reg.o_name ?? "";

  const fetcher = useFetcher({ key: "application-review" });

  const {
    register,
    formState: { errors },
    handleSubmit,
  } = useForm({
    resolver: valibotResolver(
      object({
        reason:
          verdict === "approved"
            ? pipe(string(), trim())
            : pipe(string(), trim(), nonEmpty("required")),
      })
    ),
    defaultValues: { reason: "" },
  });

  return (
    <form
      onSubmit={handleSubmit((fv) =>
        fetcher.submit(fv, {
          encType: "application/json",
          method: "POST",
          action: ".",
        })
      )}
      className="contents"
    >
      <div className="relative w-full">
        <p className="sm:text-xl font-bold text-center border-b border-hairline p-5">
          Changing application status
        </p>
        <Link
          aria-label="Close"
          aria-disabled={fetcher.state !== "idle"}
          preventScrollReset
          replace
          to=".."
          className="btn btn-icon btn-secondary absolute top-1/2 right-4 -translate-y-1/2 aria-disabled:pointer-events-none"
        >
          <X className="icon-xl" />
        </Link>
      </div>
      {verdict === "approved" ? (
        <Info className="my-6 text-primary pictogram-lg" />
      ) : (
        <CircleAlert className="my-6 text-destructive pictogram-lg" />
      )}

      <h3 className="text-center text-2xl mb-2 leading-tight px-3 sm:px-8">
        <div className="first-letter:uppercase">{verdict}</div>
        <div>Nonprofit</div>
      </h3>

      <p className="px-6 pb-4 text-center text-gray-11 mt-4">
        <span className="block">
          You are about to {verdict} the Application for
        </span>
        <span className="font-semibold block">{org_name}</span>
      </p>

      {verdict === "approved" ? (
        <div className="px-6 pb-4 text-center text-gray-11">
          This will immediately payout all pending funds to newly linked bank
          account and is irreversible.
        </div>
      ) : null}

      <div className="px-6 pb-4 text-center text-gray-11 font-bold">
        Please ensure you have confirmed all submitted details and supporting
        documentation before proceeding!
      </div>

      <div className="flex items-center gap-2 mb-6">
        <Badge>Pending</Badge>
        <ChevronRight className="icon-xl" />
        {verdict === "approved" ? (
          <Badge tone="success">Approved</Badge>
        ) : (
          <Badge tone="destructive">Rejected</Badge>
        )}
      </div>

      {verdict === "rejected" && (
        <div className="px-6 w-full pb-6">
          <Field
            {...register("reason")}
            error={errors.reason?.message}
            required
            type="textarea"
            label="Reason for rejection:"
          />
        </div>
      )}

      <Actions band>
        <Link
          to={".."}
          aria-disabled={fetcher.state === "submitting"}
          type="button"
          className="btn-secondary btn"
          preventScrollReset
          replace
        >
          Cancel
        </Link>
        <button
          disabled={fetcher.state !== "idle"}
          type="submit"
          className="btn btn-primary"
        >
          Submit
        </button>
      </Actions>
    </form>
  );
}

export default function Prompt() {
  return (
    <RouteModal classes="grid content-start justify-items-center bg-popover">
      <Content />
    </RouteModal>
  );
}
