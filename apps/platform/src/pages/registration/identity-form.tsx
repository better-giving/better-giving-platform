import { RadioGroup } from "@ark-ui/react/radio-group";
import { Field, LoadText, MaskedInput } from "@better-giving/ui";
import { ein } from "@better-giving/ui/masks";
import { valibotResolver } from "@hookform/resolvers/valibot";
import type { ReactNode } from "react";
import { useController } from "react-hook-form";
import type { FetcherWithComponents } from "react-router";
import { useRemixForm } from "remix-hook-form";
import { use_submit_event } from "#/analytics";
import { CountryCombo } from "#/components/country-combo";
import type { IRegStartFv } from "@/reg";
import { reg_start_fv } from "@/reg/schema";

const org_type_opts = [
  { value: "501c3", label: "U.S. 501(c)(3)" },
  { value: "other", label: "International" },
] as const;

const seg_opt =
  "flex-1 flex items-center justify-center text-center text-sm font-bold rounded px-3 py-2.5 select-none cursor-pointer hover:not-data-[state=checked]:bg-gray-4 data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg";

interface IIdentityForm {
  /** owned by the caller so it can read `duplicate` off `fetcher.data` and
   * decide what to show for it — both creating an application and changing
   * one can come back blocked. */
  fetcher: FetcherWithComponents<any>;
  /** where the form posts. the first screen has to name it to keep its
   * `referrer` query; left out, the submission goes to the route it's in. */
  action?: string;
  values: IRegStartFv;
  submit_text: string;
  classes?: string;
  /** rendered after the form, never inside it — the first screen's resume
   * strip is a form of its own and must not nest. */
  children?: ReactNode;
  /** dataLayer event pushed once a submission passes validation. named by the
   * caller because this form both creates an application and corrects one;
   * left out, nothing is tracked. */
  event?: string;
}

/** org type and the identity it implies — the only two questions asked before
 * an application exists, and the only two that can be corrected after. Shared
 * so the create and the change path can never drift apart on what a valid
 * identity is. */
export function IdentityForm({
  fetcher,
  action,
  values,
  submit_text,
  classes = "",
  children,
  event,
}: IIdentityForm) {
  const busy = fetcher.state !== "idle";

  const {
    register,
    control,
    watch,
    handleSubmit,
    formState: { errors, isSubmitSuccessful },
  } = useRemixForm<IRegStartFv>({
    fetcher,
    resolver: valibotResolver(reg_start_fv),
    // without it the resolver aborts the pipe on the first failing check, so
    // an untouched international form reports the country and stays silent
    // about the registration number until the country is fixed
    criteriaMode: "all",
    defaultValues: values,
    submitConfig: { action, method: "post" },
  });

  const { field: o_type } = useController({ control, name: "o_type" });
  const { field: country } = useController({ control, name: "o_hq_country" });
  const { field: o_ein } = useController({ control, name: "o_ein" });
  const is_us = watch("o_type") === "501c3";

  use_submit_event(isSubmitSuccessful, event, () => ({
    org_type: o_type.value,
  }));

  return (
    <>
      <fetcher.Form method="POST" onSubmit={handleSubmit} className={classes}>
        <RadioGroup.Root
          value={o_type.value}
          onValueChange={(e) =>
            o_type.onChange(e.value as IRegStartFv["o_type"])
          }
        >
          <RadioGroup.Label className="sr-only">
            Organization type
          </RadioGroup.Label>
          <div className="flex gap-1 p-1 bg-gray-3 rounded">
            {org_type_opts.map((o) => (
              <RadioGroup.Item
                key={o.value}
                value={o.value}
                className={seg_opt}
              >
                <RadioGroup.ItemText>{o.label}</RadioGroup.ItemText>
                <RadioGroup.ItemHiddenInput />
              </RadioGroup.Item>
            ))}
          </div>
        </RadioGroup.Root>

        {is_us ? (
          <MaskedInput
            id="o_ein"
            ref={o_ein.ref}
            mask={ein}
            value={ein.format(o_ein.value)}
            onChange={o_ein.onChange}
            onBlur={o_ein.onBlur}
            inputMode="numeric"
            label="Employer Identification Number (EIN)"
            required
            sub="The 9-digit number the IRS issued to your organization."
            placeholder="12-3456789"
            classes={{ container: "mt-6" }}
            error={errors.o_ein?.message}
          />
        ) : (
          <>
            <CountryCombo
              ref={country.ref}
              value={country.value || undefined}
              on_change={(c) => country.onChange(c ?? "")}
              required
              clearable
              label="Country of registration"
              classes={{ container: "mt-6" }}
              error={errors.o_hq_country?.message}
            />
            <Field
              {...register("o_registration_number")}
              label="Registration number"
              required
              placeholder="e.g. 1234567"
              classes={{ container: "mt-4" }}
              error={errors.o_registration_number?.message}
            />
          </>
        )}

        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary w-full mt-6"
        >
          <LoadText is_loading={busy}>{submit_text}</LoadText>
        </button>
      </fetcher.Form>

      {children}
    </>
  );
}
