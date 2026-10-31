import { Actions, CheckField, EmptyState, Form } from "@better-giving/ui";
import { type SubmitHandler, useFieldArray, useForm } from "react-hook-form";
import { useFetcher } from "react-router";
import type { IUserNpo2 } from "#/types/user";
import type { INpoAlertPrefUpdate } from "./schema";

interface Props {
  user_npos: IUserNpo2[];
  classes?: string;
}

type FV = { items: IUserNpo2[] };

export function EndowAlertForm({ classes = "", user_npos }: Props) {
  const fetcher = useFetcher();

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, isDirty },
  } = useForm<FV>({
    values: {
      items: user_npos.map((endow) => ({
        ...endow,
        //if preference is not specified, set to `true`
        alert_pref: endow.alert_pref ?? { banking: true, donation: true },
      })),
    },
  });

  const { fields } = useFieldArray({ control, name: "items" });

  if (user_npos.length === 0) {
    return <EmptyState classes={classes}>No organizations yet</EmptyState>;
  }

  const onSubmit: SubmitHandler<FV> = async (fv) => {
    fetcher.submit(
      fv.items.map<INpoAlertPrefUpdate>((item) => ({
        npo: item.id,
        banking: item.alert_pref?.banking ?? true,
        donation: item.alert_pref?.donation ?? true,
      })),
      { encType: "application/json", method: "POST" }
    );
  };

  return (
    <Form
      disabled={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
      onReset={(e) => {
        e.preventDefault();
        reset();
      }}
      className={`${classes} grid grid-cols-[auto_auto_auto] bg-card rounded-card shadow-card divide-y divide-hairline`}
    >
      <div className="grid grid-cols-subgrid col-span-3 font-bold text-sm">
        <h5 className="p-3">Receive Email Alerts for</h5>
        <h5 className="p-3">New donations</h5>
        <h5 className="p-3">Banking changes</h5>
      </div>
      {fields.map((field, idx) => (
        <div
          key={field.id}
          className="grid grid-cols-subgrid col-span-3 divide-x divide-hairline"
        >
          <div className="p-3">{field.name ?? `Endowment: ${field.id}`}</div>
          {
            <CheckField
              classes="px-4"
              {...register(`items.${idx}.alert_pref.donation`)}
            />
          }
          {
            <CheckField
              classes="px-4"
              {...register(`items.${idx}.alert_pref.banking`)}
            />
          }
        </div>
      ))}

      <Actions classes="col-span-full p-4">
        <button disabled={!isDirty} type="reset" className="btn-secondary btn">
          reset
        </button>
        <button
          disabled={!isDirty || fetcher.state === "submitting"}
          type="submit"
          className="btn btn-primary"
        >
          {fetcher.state === "submitting" ? "updating.." : "save"}
        </button>
      </Actions>
    </Form>
  );
}
