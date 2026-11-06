import { Field, LoadText, Select } from "@better-giving/ui";
import type { SubmitHandler } from "react-hook-form";
import { useFetcher, useNavigate, useRouteLoaderData } from "react-router";
import { step_loader } from "#/pages/registration/data/step-loader";
import {
  GRANT_STEP,
  GRANT_UPDATE_TYPE,
  next_step,
  steps,
} from "#/pages/registration/routes";
import type { Reg$IdData } from "#/pages/registration/types";
import { update_action } from "#/pages/registration/update-action";
import type { TRegUpdate, TRole } from "@/reg";
import { Progress } from "@/reg/progress";
import type { Route } from "./+types/route";
import { referral_methods, roles } from "./constants";
import type { FV } from "./schema";
import { use_rhf } from "./use-rhf";

export { ErrorBoundary } from "#/components/error";
// the step a draft grant opens — this route, its loader gate and its action
// all name it the same way
export const loader = step_loader(GRANT_STEP);
export const action = update_action(next_step[GRANT_STEP], {
  registrant: true,
});

export default function Page({ loaderData: reg }: Route.ComponentProps) {
  const fetcher = useFetcher();
  const {
    register,
    errors,
    org_role,
    rm,
    isDirty,
    handleSubmit,
    dirtyFields: df,
  } = use_rhf(reg);
  const navigate = useNavigate();
  const { connect_routing } = useRouteLoaderData(
    "routes/_app.register.$reg_id"
  ) as Reg$IdData;

  const submit: SubmitHandler<FV> = async (fv) => {
    if (!isDirty && new Progress(reg, connect_routing).contact) {
      return navigate(`../${steps.org_details}`); // go to latest step
    }

    const upd8: TRegUpdate = {
      update_type: GRANT_UPDATE_TYPE,
    };

    if (df.r_first_name) upd8.r_first_name = fv.r_first_name;
    if (df.r_last_name) upd8.r_last_name = fv.r_last_name;
    if (df.r_contact_number) upd8.r_contact_number = fv.r_contact_number;
    if (df.r_org_role) upd8.r_org_role = fv.r_org_role;
    if (df.r_org_role_other) upd8.r_org_role_other = fv.r_org_role_other;
    if (df.o_name) upd8.o_name = fv.o_name;
    if (df.rm) upd8.rm = fv.rm;
    if (df.rm_other) upd8.rm_other = fv.rm_other;
    if (df.rm_referral_code) upd8.rm_referral_code = fv.rm_referral_code;

    fetcher.submit(upd8, {
      method: "PATCH",
      encType: "application/json",
    });
  };

  return (
    <form className="w-full" onSubmit={handleSubmit(submit)}>
      <h2 className="text-center sm:text-left text-xl mb-2">
        Let's start with your contact details
      </h2>
      <p className="text-center sm:text-left mb-8">
        Thank you for sharing! This information will be kept private and will
        let us know more about you and your organization
      </p>
      <h3 className="mb-4">Personal information</h3>
      <Field
        required
        label="First name"
        {...register("r_first_name")}
        placeholder="e.g. John"
        error={errors.r_first_name?.message}
      />

      <Field
        {...register("r_last_name")}
        required
        label="Last name"
        {...register("r_last_name")}
        placeholder="e.g. Doe"
        error={errors.r_last_name?.message}
        classes={{ container: "mt-4" }}
      />

      <Field
        required={false}
        label="Phone number"
        {...register("r_contact_number")}
        placeholder="000000000"
        error={errors.r_contact_number?.message}
        classes={{ container: "mt-4" }}
      />

      <Field
        required
        defaultValue={reg.r_id}
        label="E-mail address"
        disabled
        classes={{ container: "mt-4" }}
      />

      <h3 className="mt-8 mb-4">Organization information</h3>
      <Field
        required
        label="Organization name"
        {...register("o_name")}
        placeholder="Organization name"
        error={errors.o_name?.message}
        classes={{ container: "mb-4" }}
      />
      <Select<TRole>
        required
        label=" What's your role within the organization?"
        value={org_role.value}
        onChange={org_role.onChange}
        options={Object.keys(roles) as TRole[]}
        error={errors.r_org_role?.message}
        ref={org_role.ref}
        classes={{ option: "text-sm" }}
        option_disp={(x) => roles[x]}
      />
      {org_role.value === "other" && (
        <Field
          classes="mt-4"
          required
          label="Specify your role"
          {...register("r_org_role_other", { shouldUnregister: true })}
          placeholder="Specify your role"
          error={errors.r_org_role_other?.message}
        />
      )}
      <h3 className="mt-8 mb-4">Other information</h3>
      <Select
        label="How did you find about us?"
        required
        value={rm.value}
        onChange={rm.onChange}
        options={Object.keys(referral_methods)}
        error={errors.rm?.message}
        ref={rm.ref}
        classes={{ option: "text-sm", container: "mb-4" }}
        option_disp={(x) => (referral_methods as any)[x]}
      />

      {rm.value === "other" && (
        <Field
          required
          label="Please provide additional information"
          {...register("rm_other", { shouldUnregister: true })}
          placeholder="Specify how you found us"
          error={errors.rm_other?.message}
        />
      )}
      {rm.value === "referral" && (
        <Field
          required
          label="Referral Code"
          {...register("rm_referral_code", { shouldUnregister: true })}
          placeholder="Referral Code"
          error={errors.rm_referral_code?.message}
        />
      )}
      <button
        type="submit"
        className="mt-8 w-full sm:w-auto btn btn-primary"
        disabled={fetcher.state !== "idle"}
      >
        <LoadText is_loading={fetcher.state === "submitting"}>
          Continue
        </LoadText>
      </button>
    </form>
  );
}
