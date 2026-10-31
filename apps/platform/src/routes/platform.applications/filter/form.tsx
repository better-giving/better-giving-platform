import { Popover } from "@ark-ui/react/popover";
import { Actions, DateRangeField, popup_anim, Select } from "@better-giving/ui";
import { toYYYMMDD } from "@better-giving/ui/helpers";
import { valibotResolver } from "@hookform/resolvers/valibot";
import type { FC } from "react";
import { useController, useForm } from "react-hook-form";
import { CountryCombo } from "#/components/country-combo";
import type { IRegsSearchObj } from "@/reg";
import { statuses } from "./constants";
import { type FV, schema } from "./schema";

type Props = {
  onSubmit: (data: FV) => void;
  onReset: () => void;
  params: IRegsSearchObj;
};

export const Form: FC<Props> = ({ onReset, onSubmit, params }) => {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FV>({
    resolver: valibotResolver(schema),
    values: {
      start_date: params.start_date
        ? toYYYMMDD(new Date(params.start_date))
        : "",
      end_date: params.end_date ? toYYYMMDD(new Date(params.end_date)) : "",
      country: params.country ?? "",
      status: params.status || "02",
    },
  });

  const { field: country } = useController({ name: "country", control });
  const { field: stat } = useController({ name: "status", control });
  const { field: start } = useController({ name: "start_date", control });
  const { field: end } = useController({ name: "end_date", control });

  return (
    <Popover.Content
      asChild
      className={`grid content-start gap-4 w-(--reference-width) bg-card rounded-card shadow-floating text-gray-12 ${popup_anim}`}
    >
      <form
        onSubmit={handleSubmit(onSubmit, (err) => {
          console.error(err);
        })}
        onReset={(e) => {
          e.preventDefault();
          reset();
          onReset();
        }}
      >
        <div className="px-6 pt-6">
          <CountryCombo
            value={country.value || undefined}
            on_change={(c) => country.onChange(c ?? "")}
            label="Country"
            clearable
          />

          <DateRangeField
            classes="mt-4"
            startValue={start.value ?? ""}
            endValue={end.value ?? ""}
            onChange={(s, e) => {
              start.onChange(s);
              end.onChange(e);
            }}
            error={errors.start_date?.message ?? errors.end_date?.message}
          />

          <Select
            value={stat.value}
            onChange={stat.onChange}
            label="Application Status"
            classes={{
              button: "",
              options: "text-sm",
              container: "mt-4",
            }}
            options={Object.keys(statuses)}
            option_disp={(s) => (statuses as any)[s]}
          />
        </div>

        <Actions band align="split" classes="lg:mt-2">
          <button type="reset" className="text-primary underline text-sm">
            Reset filters
          </button>
          <button type="submit" className="btn btn-primary font-bold">
            Apply filters
          </button>
        </Actions>
      </form>
    </Popover.Content>
  );
};
