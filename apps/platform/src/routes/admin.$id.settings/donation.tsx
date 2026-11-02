import { Actions, CheckField, Form as F, Field } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useForm } from "react-hook-form";
import { useFetcher } from "react-router";
import * as v from "valibot";
import { $, MAX_RECEIPT_MSG_CHAR } from "@/npo/schema";
import { SaveAlert } from "./helpers";

const schema = v.object({
  receipt_msg: v.pipe(
    $,
    v.maxLength(
      MAX_RECEIPT_MSG_CHAR,
      ({ requirement }) => `cannot exceed ${requirement} characters`
    )
  ),
  hide_bg_tip: v.boolean(),
  donor_address_required: v.boolean(),
});

type FV = v.InferInput<typeof schema>;

interface Props {
  receipt_msg: string;
  hide_bg_tip: boolean;
  donor_address_required: boolean;
}

export function DonationTab({
  receipt_msg,
  hide_bg_tip,
  donor_address_required,
}: Props) {
  const fetcher = useFetcher();

  const {
    reset,
    register,
    handleSubmit,
    formState: { isSubmitting, isDirty, errors },
    watch,
  } = useForm<FV>({
    resolver: valibotResolver(schema),
    values: {
      receipt_msg: receipt_msg ?? "",
      hide_bg_tip: hide_bg_tip ?? false,
      donor_address_required: donor_address_required ?? false,
    },
  });

  const receipMsg = watch("receipt_msg");

  const onSubmit = handleSubmit(async (fv) => {
    fetcher.submit(fv as any, {
      method: "POST",
      action: ".",
      encType: "application/json",
    });
  });

  return (
    <F
      disabled={isSubmitting || fetcher.state !== "idle"}
      onReset={(e) => {
        e.preventDefault();
        reset();
        fetcher.reset();
      }}
      onSubmit={onSubmit}
      className="grid content-start gap-6"
    >
      <div className="relative">
        <Field
          {...register("receipt_msg")}
          rows={5}
          type="textarea"
          classes={{
            label: "",
          }}
          label="Tax receipt message for donors"
          placeholder="Your nonprofit's message to all donors"
        />
        <p
          data-exceed={receipMsg.length > MAX_RECEIPT_MSG_CHAR}
          className="text-xs text-gray-11 data-[exceed='true']:text-destructive-subtle-fg flex justify-between"
        >
          <span>
            {receipMsg.length}/{MAX_RECEIPT_MSG_CHAR}
          </span>
          <span className="text-destructive-subtle-fg text-xs">
            {errors.receipt_msg?.message ?? ""}
          </span>
        </p>
        <p className="text-sm text-gray-11 mt-1">
          This is an optional message that can be included on all tax receipts
          to your donors to add a personalized touch, a thank you, or a call to
          action.
        </p>
      </div>

      <div className="grid gap-2">
        <CheckField {...register("hide_bg_tip")} classes="font-medium">
          Opt out of support contribution model
        </CheckField>
        <span className="text-sm text-gray-11">
          In the donation form, there is a section in which users can choose to
          support Better Giving by contributing any amount they desire alongside
          their donation to you - the amount they contribute will not affect the
          donation amount you receive. You may choose to turn this step off in
          the donation flow by ticking the checkbox above and we will instead
          apply a fixed 1.5% fee to any donation amount you receive.
        </span>
      </div>

      <div className="grid gap-2">
        <CheckField
          {...register("donor_address_required")}
          classes="font-medium"
        >
          Require donor address
        </CheckField>
        <span className="text-sm text-gray-11">
          Collecting the donor address is not required and adds an additional
          step for donors before completing their gifts, so we do not normally
          ask for it. However, if this is information you would like, we can
          make it a mandatory field before checkout.
        </span>
      </div>

      <div>
        <SaveAlert data={fetcher.data} />
        <Actions>
          <button
            type="reset"
            className="btn-secondary btn"
            disabled={!isDirty}
          >
            Reset changes
          </button>
          <button type="submit" className="btn btn-primary" disabled={!isDirty}>
            Submit changes
          </button>
        </Actions>
      </div>
    </F>
  );
}
