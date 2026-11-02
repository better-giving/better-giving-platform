import { MultiCombo } from "@better-giving/ui";
import { useSearchParams } from "react-router";
import { toParsed, toRaw } from "#/pages/marketplace/helpers";
import { countries, country_names } from "@/constants/countries";

export default function Countries() {
  const [params, set_params] = useSearchParams();
  const { countries: pcountries = [], ...p } = toParsed(params);

  return (
    <MultiCombo
      label="Countries"
      values={pcountries}
      on_change={(values) =>
        set_params(toRaw({ ...p, countries: values }), {
          replace: true,
          preventScrollReset: true,
        })
      }
      options={country_names}
      render={(c) => (
        <>
          <span className="text-2xl">{countries[c]?.flag}</span>
          <span>{c}</span>
        </>
      )}
      classes={{ label: "text-sm font-semibold text-gray-11" }}
    />
  );
}
