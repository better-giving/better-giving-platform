import { Dialog } from "@ark-ui/react/dialog";
import { Actions, Field } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { X } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link, useFetcher } from "react-router";
import { RouteModal } from "#/components/route-modal";
import type { Route } from "./+types/route";
import { cancel_fv } from "./schema";

export { ErrorModal as ErrorBoundary } from "#/components/error";
export { action, loader } from "./api";

const fetcher_key = "cancel-subscription";

function Content({ recipient_name }: { recipient_name: string }) {
  const fetcher = useFetcher({ key: fetcher_key });
  const busy = fetcher.state !== "idle";

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: valibotResolver(cancel_fv),
    defaultValues: { reason: "" },
  });

  return (
    <form
      onSubmit={handleSubmit((fv) =>
        fetcher.submit(fv, { encType: "application/json", method: "POST" })
      )}
      className="contents"
    >
      <div className="relative w-full">
        <p className="sm:text-xl font-bold text-center border-b border-hairline bg-gray-3 p-5">
          Cancel Recurring Donation
        </p>
        <Dialog.CloseTrigger asChild>
          <Link
            aria-label="Close"
            aria-disabled={busy}
            preventScrollReset
            replace
            to=".."
            className="border p-2 rounded absolute top-1/2 right-4 transform -translate-y-1/2 aria-disabled:text-gray-11 aria-disabled:pointer-events-none"
          >
            <X className="size-4.5 sm:size-6" />
          </Link>
        </Dialog.CloseTrigger>
      </div>

      <p className="px-6 pb-4 text-gray-11 mt-4">
        <span className="block">
          You are about to cancel your recurring donations to
        </span>
        <span className="font-semibold">{recipient_name}</span>. This action
        cannot be undone. You will no longer be charged for this subscription.
      </p>

      <div className="px-6 pb-4 text-center text-gray-11" />

      <div className="px-6 w-full pb-6">
        <Field
          {...register("reason")}
          required
          type="textarea"
          label="Reason for cancellation"
          placeholder="Please tell us why you're canceling this recurring donation..."
          error={errors.reason?.message}
        />
      </div>

      <Actions band>
        <Dialog.CloseTrigger asChild>
          <Link
            to={".."}
            aria-disabled={busy}
            className="btn-secondary btn"
            preventScrollReset
            replace
          >
            Keep your support
          </Link>
        </Dialog.CloseTrigger>
        <button disabled={busy} type="submit" className="btn btn-destructive">
          {busy ? "Canceling..." : "Cancel"}
        </button>
      </Actions>
    </form>
  );
}

export default function CancelPrompt({
  loaderData: { recipient_name },
}: Route.ComponentProps) {
  const fetcher = useFetcher({ key: fetcher_key });
  return (
    <RouteModal
      title="Cancel recurring donation"
      busy={fetcher.state !== "idle"}
      classes="grid content-start justify-items-center bg-card"
    >
      <Content recipient_name={recipient_name} />
    </RouteModal>
  );
}
