import { Actions, Field } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { ChevronRight, CircleAlert, X } from "lucide-react";
import type { PropsWithChildren } from "react";
import { useForm } from "react-hook-form";
import { Link, useFetcher, useParams, useSearchParams } from "react-router";
import { nonEmpty, object, pipe, string, trim } from "valibot";
import { RouteModal } from "#/components/route-modal";

function Content() {
  const { verdict } = useParams();
  const [params] = useSearchParams();
  const orgName = params.get("org_name") ?? "";

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
        <p className="sm:text-xl font-bold text-center border-b border-hairline bg-gray-3 p-5">
          Changing Application Status
        </p>
        <Link
          aria-label="Close"
          aria-disabled={fetcher.state !== "idle"}
          preventScrollReset
          replace
          to=".."
          className="border p-2 rounded absolute top-1/2 right-4 transform -translate-y-1/2 disabled:text-gray-11"
        >
          <X className="size-4.5 sm:size-6" />
        </Link>
      </div>
      <CircleAlert className="my-6 text-destructive pictogram-lg" />

      <h3 className="text-center text-2xl mb-2 leading-tight px-3 sm:px-8">
        <div className="uppercase">{verdict}</div>
        <div>Nonprofit</div>
      </h3>

      <p className="px-6 pb-4 text-center text-gray-11 mt-4">
        <span className="block">
          You are about to {verdict} the Application for
        </span>
        <span className="font-semibold block">{orgName}</span>
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
        <Status classes="bg-gray-11">Pending</Status>
        <ChevronRight className="icon-xl" />
        {verdict === "approved" ? (
          <Status classes="bg-success">Approved</Status>
        ) : (
          <Status classes="bg-destructive">Rejected</Status>
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
    <RouteModal classes="grid content-start justify-items-center bg-card">
      <Content />
    </RouteModal>
  );
}

function Status(props: PropsWithChildren<{ classes?: string }>) {
  return (
    <div
      className={`${
        props.classes ?? ""
      } text-primary-fg px-2 py-1 text-xs uppercase rounded`}
    >
      {props.children}
    </div>
  );
}
