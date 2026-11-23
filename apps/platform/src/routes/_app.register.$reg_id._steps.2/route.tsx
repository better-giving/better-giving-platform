import {
  Actions,
  ExtLink,
  Label,
  LoadText,
  MultiCombo,
  Select,
  UrlInput,
} from "@better-giving/ui";
import { useEffect } from "react";
import type { SubmitHandler } from "react-hook-form";
import {
  NavLink,
  useFetcher,
  useNavigate,
  useRouteLoaderData,
} from "react-router";
import { base_url } from "#/constants/env";
import { TERMS_OF_USE_NPO } from "#/constants/urls";
import { step_loader } from "#/pages/registration/data/step-loader";
import { after_org, steps } from "#/pages/registration/routes";
import type { Reg$IdData, TStepAnswer } from "#/pages/registration/types";
import { update_action } from "#/pages/registration/update-action";
import {
  PublicLinkField,
  suggest_slug,
} from "#/routes/admin.$id.campaigns/link-field";
import { country_names as cnames } from "@/constants/countries";
import type { TRegUpdate } from "@/reg";
import { Progress } from "@/reg/progress";
import { type OrgDesignation, org_designations } from "@/schemas";
import type { Route } from "./+types/route";
import type { FV } from "./schema";
import { use_rhf } from "./use-rhf";

export { ErrorBoundary } from "#/components/error";

const SLUG_NOTE_ID = "__o_slug_locks";

export const loader = step_loader(2);
export const action = update_action((reg) => after_org(reg.o_type));
export default function Page({ loaderData: reg }: Route.ComponentProps) {
  const fetcher = useFetcher<TStepAnswer>();
  const navigate = useNavigate();
  const { connect_routing } = useRouteLoaderData(
    "routes/_app.register.$reg_id"
  ) as Reg$IdData;

  const {
    register,
    errors,
    isDirty,
    handleSubmit,
    designation,
    countries,
    slug,
    setError,
    dirtyFields: df,
  } = use_rhf(reg);

  const refusal = fetcher.data;
  useEffect(() => {
    const taken =
      refusal && "field_errors" in refusal
        ? refusal.field_errors.o_slug
        : undefined;
    if (taken) setError("o_slug", { message: taken }, { shouldFocus: true });
  }, [refusal, setError]);

  const submit: SubmitHandler<FV> = async (fv) => {
    if (!isDirty && new Progress(reg, connect_routing).org) {
      return navigate(`../${after_org(reg.o_type)}`);
    }

    const update: TRegUpdate = {
      update_type: "org",
    };

    if (df.o_website) update.o_website = fv.o_website;
    if (df.o_designation) update.o_designation = fv.o_designation;
    if (df.o_active_in_countries)
      update.o_active_in_countries = fv.o_active_in_countries;
    if (df.o_slug) update.o_slug = fv.o_slug;

    fetcher.submit(update, {
      method: "PATCH",
      encType: "application/json",
    });
  };

  return (
    <form className="w-full" onSubmit={handleSubmit(submit)}>
      <h2 className="text-center sm:text-left text-xl mb-2">
        Organization details
      </h2>

      <UrlInput
        {...register("o_website")}
        label="Website of your organization"
        required
        classes={{ container: "mb-6 mt-4" }}
        placeholder="yourwebsite.com"
        error={errors.o_website?.message}
      />

      <Select<OrgDesignation>
        ref={designation.ref}
        value={designation.value}
        onChange={designation.onChange}
        required
        label="Nonprofit Designation"
        classes={{ options: "text-sm", container: "mt-4" }}
        options={org_designations as any}
        option_disp={(v) => v}
        error={errors.o_designation?.message}
      />

      <Label className="mt-6 mb-2">
        Select the countries your organization is active in
      </Label>
      <MultiCombo
        values={countries.value ?? []}
        on_change={countries.onChange}
        on_reset={() => countries.onChange([])}
        classes={{ options: "text-sm" }}
        options={cnames}
        error={errors.o_active_in_countries?.message}
        ref={countries.ref}
      />

      <div className="mt-6">
        <PublicLinkField
          reg={register("o_slug")}
          value={slug}
          base={`${base_url}/org/`}
          locked={false}
          label="Organization slug"
          lead="Your org slug will be part of your campaign URLs, like"
          tail="your-campaign"
          placeholder={suggest_slug(reg.o_name ?? "")}
          empty_url={null}
          error={errors.o_slug?.message}
          describedby={SLUG_NOTE_ID}
        />
        <p id={SLUG_NOTE_ID} className="mt-1 text-sm text-gray-11">
          You can't change your org slug after your application is approved.
        </p>
      </div>

      <p className="text-sm mt-4">
        By submitting this information, you declare that you have read and
        agreed to our{" "}
        <ExtLink className="underline link" href={TERMS_OF_USE_NPO}>
          Terms & Conditions
        </ExtLink>
        .
      </p>
      <Actions classes="mt-8">
        <NavLink
          aria-disabled={fetcher.state !== "idle"}
          to={`../${steps.contact}`}
          className="min-w-32 btn btn-secondary"
        >
          Back
        </NavLink>
        <button
          disabled={fetcher.state !== "idle"}
          type="submit"
          className="min-w-32 btn btn-primary"
        >
          <LoadText is_loading={fetcher.state !== "idle"}>Continue</LoadText>
        </button>
      </Actions>
    </form>
  );
}
