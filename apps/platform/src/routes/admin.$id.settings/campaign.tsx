import { Actions, CheckField, Form as F } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useForm } from "react-hook-form";
import { useFetcher } from "react-router";
import * as v from "valibot";
import { SaveAlert } from "./helpers";

const schema = v.object({
  fund_opt_in: v.boolean(),
});

type FV = v.InferInput<typeof schema>;

interface Props {
  fund_opt_in: boolean;
}

export function CampaignTab({ fund_opt_in }: Props) {
  const fetcher = useFetcher();

  const {
    reset,
    register,
    handleSubmit,
    formState: { isSubmitting, isDirty },
  } = useForm<FV>({
    resolver: valibotResolver(schema),
    values: {
      fund_opt_in,
    },
  });

  const onSubmit = handleSubmit(async (fv) => {
    fetcher.submit(
      { fund_opt_in: fv.fund_opt_in },
      {
        method: "POST",
        encType: "application/json",
      }
    );
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
      <div>
        <CheckField {...register("fund_opt_in")} classes="font-medium">
          Allow campaigns to be created on behalf of your nonprofit
        </CheckField>
        <p className="text-sm text-gray-11 mt-1">
          This is optional for all Better Giving nonprofits. By opting in,
          people will be able to create campaigns on your behalf. You will
          receive 100% of funds raised for campaigns specific to your
          organization, and a percentage split of campaigns involving multiple
          nonprofits (such as curated giving indexes).
        </p>
      </div>

      <div className="mt-8">
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
