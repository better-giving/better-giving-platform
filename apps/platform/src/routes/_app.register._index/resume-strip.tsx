import { LoadText } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useFetcher } from "react-router";
import { useRemixForm } from "remix-hook-form";
import { use_submit_event } from "#/analytics";
import type { IRegResumeFv } from "@/reg";
import { reg_resume_fv } from "@/reg/schema";

interface Props {
  /** reference held in the registration cookie, if any */
  prev: string;
  /** carries the current query (referrer=…) through to the index action */
  action: string;
}

export function ResumeStrip({ prev, action }: Props) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitSuccessful },
  } = useRemixForm<IRegResumeFv>({
    fetcher,
    resolver: valibotResolver(reg_resume_fv),
    defaultValues: { reference: prev },
    submitData: { intent: "resume" },
    submitConfig: { action, method: "post" },
  });

  use_submit_event(isSubmitSuccessful, "reg_resume");

  return (
    <fetcher.Form
      method="POST"
      onSubmit={handleSubmit}
      className="mt-8 p-4 bg-panel rounded"
    >
      <p className="text-sm font-bold">Already started an application?</p>
      <div className="flex gap-2 mt-3">
        <input
          {...register("reference")}
          aria-label="Registration reference"
          aria-invalid={!!errors.reference}
          placeholder="Registration reference"
          className="field-input min-w-0 flex-1"
        />
        <button
          type="submit"
          disabled={busy}
          className="btn btn-secondary whitespace-nowrap"
        >
          <LoadText is_loading={busy} text="Resuming...">
            Resume
          </LoadText>
        </button>
      </div>
      <p className="field-err text-left mt-1 empty:hidden">
        {errors.reference?.message}
      </p>
    </fetcher.Form>
  );
}
