import { CircleX } from "lucide-react";
import type { PropsWithChildren } from "react";
import { useSearchParams } from "react-router";
import { categories, sdgGroups } from "#/constants/unsdgs";
import { toParsed, toRaw } from "#/pages/marketplace/helpers";
import type { UnSdgNum } from "@/schemas";
import { CLEAR_ALL } from "./toolbar/search";

export function ActiveFilters() {
  const [params, setParams] = useSearchParams();
  const parsed = toParsed(params);

  const endowDesignations = (parsed.endow_designation || []).map(
    (designation) => (
      <Item
        key={designation}
        onRemove={() =>
          setParams(
            toRaw({
              ...parsed,
              endow_designation: parsed.endow_designation?.filter(
                (val) => val !== designation
              ),
            }),
            { replace: true, preventScrollReset: true }
          )
        }
      >
        {designation}
      </Item>
    )
  );

  const activeGroups = sdgGroups
    .filter(([, sdgs]) =>
      sdgs.every((sdg) => (parsed.sdgs || []).includes(sdg))
    )
    .map(([g]) => g);

  const sdgFilters = activeGroups.map((groupNum) => (
    <Item
      key={groupNum}
      onRemove={() =>
        setParams(
          toRaw({
            ...parsed,
            sdgs: parsed.sdgs?.filter(
              (x) => !categories[groupNum].sdgs.includes(x as UnSdgNum)
            ),
          }),
          { replace: true, preventScrollReset: true }
        )
      }
    >
      {categories[groupNum].name}
    </Item>
  ));

  const countryFilters = (parsed.countries || []).map((country) => (
    <Item
      key={country}
      onRemove={() =>
        setParams(
          toRaw({
            ...parsed,
            countries: parsed.countries?.filter((c) => c !== country),
          }),
          { replace: true, preventScrollReset: true }
        )
      }
    >
      {country}
    </Item>
  ));

  const kycFilters = (parsed.kyc_only || []).map((kyc) => (
    <Item
      key={`${kyc}`}
      onRemove={() => {
        setParams(
          toRaw({
            ...parsed,
            kyc_only: parsed.kyc_only?.filter((v) => v !== kyc),
          }),
          { replace: true, preventScrollReset: true }
        );
      }}
    >
      {kyc ? "KYC" : "No KYC"}
    </Item>
  ));

  const filters = endowDesignations
    .concat(sdgFilters)
    .concat(countryFilters)
    .concat(kycFilters);

  return (
    <div className="flex flex-wrap gap-1">
      {filters}
      {filters.length >= 2 && (
        <button
          type="button"
          onClick={() =>
            setParams(toRaw({ query: "", page: 1 }), {
              replace: true,
              preventScrollReset: true,
              state: CLEAR_ALL,
            })
          }
          className="text-primary hover:text-primary/80 text-sm ml-1"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

function Item({ children, onRemove }: PropsWithChildren<{ onRemove(): void }>) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="flex items-center gap-2 border border-gray-7 hover:border-gray-8 select-none rounded-full capitalize text-xs py-1 pl-3 pr-1.5 text-gray-11 bg-gray-3 hover:bg-gray-4 active:bg-gray-5"
    >
      <span>{children}</span>
      <CircleX className="icon-xl" />
    </button>
  );
}
