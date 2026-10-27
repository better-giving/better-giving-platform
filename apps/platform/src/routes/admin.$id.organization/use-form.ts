import type { IPrompt } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useEffect, useState } from "react";
import {
  type FieldValues,
  type Path,
  type UseFormReturn,
  useController,
  useForm,
  useWatch,
} from "react-hook-form";
import * as v from "valibot";
import { to_text } from "#/components/rich-text";
import {
  type FV,
  fields,
  type ProfileFV,
  profile_schema,
  schema,
} from "./schema";
import { type Update, use_save } from "./use-save";

type SetPrompt = (p: IPrompt) => void;

/** the Better Giving Page section's fields in the order the form renders
 * them — `trigger`'s focus-on-error walks this order */
const page_fields = [
  "tagline",
  "image",
  "overview",
] as const satisfies (keyof ProfileFV)[];

const page_schema = v.pick(profile_schema, page_fields);
const social_media_schema = v.pick(profile_schema, ["social_media_urls"]);

type BgPage = v.InferInput<typeof page_schema>;
type SocialMedia = v.InferInput<typeof social_media_schema>;

/** a dirty-fields entry is `true`, or an object/array of entries for a nested
 * field — which RHF can leave behind empty once every leaf is reverted */
const is_marked = (x: unknown): boolean =>
  x === true ||
  (typeof x === "object" && x !== null && Object.values(x).some(is_marked));

/** validation runs through `trigger`, which never marks the form submitted,
 * so `reValidateMode` never engages — an errored field re-validates here */
function use_revalidate_errored<T extends FieldValues>({
  watch,
  getFieldState,
  trigger,
}: UseFormReturn<T>) {
  useEffect(() => {
    const sub = watch((_, { name }) => {
      if (name && getFieldState(name).error) trigger(name);
    });
    return () => sub.unsubscribe();
  }, [watch, getFieldState, trigger]);
}

/** moves the baseline to what was sent, keeping every current value. the
 * held fieldset misses custom controls, so an edit can land mid-save: RHF's
 * own compare against the new baseline leaves just those fields dirty */
function mark_saved<T extends FieldValues>(form: UseFormReturn<T>, sent: T) {
  const current = form.getValues();
  // clears dirty state wholesale; the loop re-marks it against `sent`
  form.reset(sent, { keepValues: true });
  for (const name of Object.keys(current) as Path<T>[]) {
    form.setValue(name, current[name], { shouldDirty: true });
  }
}

/** validates with focus-on-error before the group's save holds its controls —
 * a disabled input can't take focus. marks saved the values it sent */
function use_group<T extends FieldValues>(
  form: UseFormReturn<T>,
  set_prompt: SetPrompt
) {
  const { save, busy } = use_save(set_prompt);
  const submit = async (
    names: Parameters<UseFormReturn<T>["trigger"]>[0],
    build: (values: T) => Update | undefined | Promise<Update | undefined>
  ) => {
    if (!(await form.trigger(names, { shouldFocus: true }))) return;
    // `getValues` copies shallowly: a nested edit would write through
    const values = structuredClone(form.getValues());
    await save(
      () => build(values),
      () => mark_saved(form, values)
    );
  };
  return { submit, busy };
}

export function use_organization_form(
  init: FV,
  npo_id: number,
  set_prompt: SetPrompt
) {
  const locked = init.slug !== "";
  const form = useForm<FV>({
    defaultValues: init,
    resolver: valibotResolver(schema),
  });
  use_revalidate_errored(form);
  const { control, formState } = form;

  const { save, busy } = use_save(set_prompt, "applying organization changes");
  const dirty = (name: keyof FV) => is_marked(formState.dirtyFields[name]);
  const { field: logo } = useController({ control, name: "logo" });
  const { field: designation } = useController({
    control,
    name: "endow_designation",
  });
  const { field: hq_country } = useController({ control, name: "hq_country" });
  const { field: active_in_countries } = useController({
    control,
    name: "active_in_countries",
  });
  const slug = useWatch({ control, name: "slug" });
  const name = useWatch({ control, name: "name" });

  /** the group's own fields, focusing the first invalid one. a locked slug is
   * not part of the group */
  const validate = () =>
    form.trigger(
      locked ? fields.filter((name) => name !== "slug") : [...fields],
      { shouldFocus: true }
    );

  const submit = async () => {
    if (!(await validate())) return;
    const values = structuredClone(form.getValues());
    await save(
      async () => {
        // a locked slug is not part of this save. an empty stand-in keeps
        // `slug`'s assignment rules off a value that was stored earlier.
        const fv = v.parse(schema, locked ? { ...values, slug: "" } : values);
        const update: Update = {};
        if (!locked && dirty("slug") && fv.slug !== "") {
          const found = await fetch(`/api/npos/${fv.slug}?fields=id`).then(
            (r) => (r.status === 404 ? undefined : r.json())
          );
          if (found?.id && found.id !== npo_id) {
            set_prompt({
              type: "error",
              children: `Slug "${fv.slug}" is already taken`,
            });
            return;
          }
          update.slug = fv.slug;
        }
        if (dirty("registration_number")) {
          update.registration_number = fv.registration_number;
        }
        if (dirty("logo")) update.logo = fv.logo;
        if (dirty("endow_designation")) {
          update.endow_designation = fv.endow_designation;
        }
        if (dirty("hq_country")) update.hq_country = fv.hq_country;
        if (dirty("url")) update.url = fv.url;
        if (dirty("street_address")) update.street_address = fv.street_address;
        if (dirty("active_in_countries")) {
          update.active_in_countries = fv.active_in_countries;
        }
        if (Object.keys(update).length === 0) return;
        return update;
      },
      () => mark_saved(form, values)
    );
  };

  return {
    ...form,
    errors: formState.errors,
    is_dirty: formState.isDirty,
    busy,
    save: submit,
    validate,
    locked,
    logo,
    designation,
    hq_country,
    active_in_countries,
    slug,
    name,
  };
}

export function use_page(init: ProfileFV, set_prompt: SetPrompt) {
  const form = useForm<BgPage>({
    // seeded once, never from `values`: another group's save revalidates the
    // loader, and a re-seed would wipe unsaved edits here
    defaultValues: {
      tagline: init.tagline,
      image: init.image,
      overview: init.overview,
    },
    resolver: valibotResolver(page_schema),
  });
  use_revalidate_errored(form);
  const { control } = form;
  const { errors, dirtyFields, isDirty } = form.formState;
  const { submit, busy } = use_group(form, set_prompt);
  const dirty = (name: keyof BgPage) => is_marked(dirtyFields[name]);

  const { field: banner } = useController({ control, name: "image" });
  const { field: overview } = useController({ control, name: "overview" });

  const save = () =>
    submit([...page_fields], (values) => {
      const fv = v.parse(page_schema, values);
      const update: Update = {};
      if (dirty("tagline")) update.tagline = fv.tagline;
      if (dirty("image")) update.image = fv.image;
      if (dirty("overview")) {
        update.overview_pt = fv.overview.value;
        update.overview_v2 = to_text(fv.overview.value);
      }
      return update;
    });

  return {
    ...form,
    errors,
    is_dirty: isDirty,
    busy,
    save,
    banner,
    overview,
  };
}

export function use_social_media(init: ProfileFV, set_prompt: SetPrompt) {
  const form = useForm<SocialMedia>({
    defaultValues: { social_media_urls: init.social_media_urls },
    resolver: valibotResolver(social_media_schema),
  });
  use_revalidate_errored(form);
  const { errors, isDirty } = form.formState;
  const { submit, busy } = use_group(form, set_prompt);

  const save = () =>
    submit("social_media_urls", (values) => {
      const fv = v.parse(social_media_schema, values);
      return { social_media_urls: fv.social_media_urls };
    });

  return { ...form, errors, is_dirty: isDirty, busy, save };
}

/** saves on flip. shows the requested value while the save is in flight, then
 * the stored one: the flip on a confirmed write, the prior value otherwise */
export function use_publish(init: ProfileFV, set_prompt: SetPrompt) {
  const [published, set_published] = useState(init.published);
  const [requested, set_requested] = useState(init.published);
  const { save, busy } = use_save(set_prompt);
  const publish = (next: boolean) => {
    set_requested(next);
    save(
      () => ({ published: next }),
      () => set_published(next)
    );
  };
  return { published: busy ? requested : published, publish, busy };
}
