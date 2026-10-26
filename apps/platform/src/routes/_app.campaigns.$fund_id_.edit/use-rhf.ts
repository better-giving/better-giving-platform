import { valibotResolver } from "@hookform/resolvers/valibot";
import { type BaseSyntheticEvent, useEffect, useRef } from "react";
import {
  type FieldValues,
  type UseFormHandleSubmit,
  useController,
  useFieldArray,
  useForm,
} from "react-hook-form";
import { useFetcher } from "react-router";
import * as v from "valibot";
import { to_target } from "#/components/goal-selector";
import { to_content } from "#/components/rich-text";
import type { IFund } from "#/types/fund";
import type { IFundUpdate } from "@/campaign";
import { type FV, schema } from "./schema";

// each section's form is seeded through `values:` from its own slice of the
// fund, and RHF re-seeds only when that slice changes: another section's save
// (which revalidates the loader) leaves this one's unsaved edits alone, this
// section's confirmed write re-seeds it clean, a refused one leaves it dirty
const general_schema = v.pick(schema, ["name", "slug", "description"]);
const media_schema = v.pick(schema, ["videos", "banner", "logo"]);
const goal_schema = v.pick(schema, ["target", "increments"]);

type General = v.InferOutput<typeof general_schema>;
type Media = v.InferOutput<typeof media_schema>;
type Goal = v.InferOutput<typeof goal_schema>;

/** one section's PATCH, over its own fetcher so its pending state is its own */
function use_patch() {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  // latched from the press, not read off the fetcher: validation is async, so
  // a second press lands before the fetcher reports busy
  const held = useRef(false);
  useEffect(() => {
    if (!busy) held.current = false;
  }, [busy]);

  function submitter<T extends FieldValues>(
    handle: UseFormHandleSubmit<T>,
    to_update: (fv: T) => IFundUpdate
  ) {
    return (e?: BaseSyntheticEvent) => {
      e?.preventDefault();
      if (held.current) return;
      held.current = true;
      return handle(
        (fv) =>
          fetcher.submit(to_update(fv), {
            method: "PATCH",
            encType: "application/json",
          }),
        () => {
          held.current = false;
        }
      )(e);
    };
  }
  return { submitter, busy };
}

export function use_general(init: IFund) {
  const form = useForm<General>({
    resolver: valibotResolver(general_schema),
    values: {
      name: init.name,
      slug: init.slug ?? "",
      description: to_content(init.description_pt),
    },
  });
  const { errors, isDirty, dirtyFields: df } = form.formState;
  const { submitter, busy } = use_patch();
  const { field: desc } = useController({
    control: form.control,
    name: "description",
  });
  const slug = form.watch("slug");

  const save = submitter(form.handleSubmit, (fv) => {
    const update: IFundUpdate = {};
    if (df.name) update.name = fv.name;
    if (df.slug) update.slug = fv.slug;
    if (df.description) update.description_pt = fv.description.value;
    return update;
  });

  return { ...form, errors, is_dirty: isDirty, busy, save, desc, slug };
}

export function use_media(init: IFund) {
  const form = useForm<Media>({
    resolver: valibotResolver(media_schema),
    values: {
      videos: init.videos.map((v) => ({ url: v })),
      banner: init.banner,
      logo: init.logo,
    },
  });
  const { errors, isDirty, dirtyFields: df } = form.formState;
  const { submitter, busy } = use_patch();
  const { control } = form;
  const { field: banner } = useController({ control, name: "banner" });
  const { field: logo } = useController({ control, name: "logo" });
  const videos = useFieldArray<Pick<FV, "videos">>({
    control: control as any,
    name: "videos",
  });
  // preserve the generic — inference widens to FieldValues due to `control as any` in useFieldArray
  const handleSubmit: UseFormHandleSubmit<Media> = form.handleSubmit;

  const save = submitter(handleSubmit, (fv) => {
    const update: IFundUpdate = {};
    if (df.videos) update.videos = fv.videos.map((v) => v.url);
    if (df.banner) update.banner = fv.banner;
    if (df.logo) update.logo = fv.logo;
    return update;
  });

  return {
    ...form,
    errors,
    is_dirty: isDirty,
    busy,
    save,
    banner,
    logo,
    videos,
    is_uploading: logo.value === "loading" || banner.value === "loading",
  };
}

export function use_goal(init: IFund) {
  const form = useForm<Goal>({
    resolver: valibotResolver(goal_schema),
    values: {
      target:
        init.target === "0"
          ? { type: "none" }
          : init.target === "smart"
            ? { type: "smart" }
            : { type: "fixed", value: init.target ?? "" },
      increments: init.increments ?? [],
    },
  });
  const { errors, isDirty, dirtyFields: df } = form.formState;
  const { submitter, busy } = use_patch();
  const { control } = form;
  const { field: target_type } = useController({
    control,
    name: "target.type",
  });
  const increments = useFieldArray({ control, name: "increments" });
  const incs = form.watch("increments");

  const save = submitter(form.handleSubmit, (fv) => {
    const update: IFundUpdate = {};
    if (df.target) update.target = to_target(fv.target);
    if (df.increments) update.increments = fv.increments;
    return update;
  });

  return {
    ...form,
    errors,
    is_dirty: isDirty,
    busy,
    save,
    target_type,
    increments,
    incs,
  };
}
