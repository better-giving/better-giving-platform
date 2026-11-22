import { valibotResolver } from "@hookform/resolvers/valibot";
import { useController, useForm, useWatch } from "react-hook-form";
import { sans_https } from "@/helpers/https";
import type { IReg } from "@/reg";
import { type FV, schema } from "./schema";

export const use_rhf = (reg: IReg) => {
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<FV>({
    resolver: valibotResolver(schema),
    defaultValues: {
      o_website: sans_https(reg.o_website) ?? undefined,
      o_designation: reg.o_designation ?? ("" as any), // opt init display
      o_active_in_countries: reg.o_active_in_countries ?? [],
      o_slug: reg.o_slug ?? "",
    },
  });

  const { field: designation } = useController({
    control,
    name: "o_designation",
  });
  const { field: countries } = useController({
    control,
    name: "o_active_in_countries",
  });
  const slug = useWatch({ control, name: "o_slug" }) ?? "";

  return {
    register,
    handleSubmit,
    setError,
    errors,
    isDirty,
    designation,
    countries,
    slug,
    dirtyFields,
  };
};
