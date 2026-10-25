import { Field as BaseField } from "@ark-ui/react/field";
import {
  Field,
  Fieldset,
  Form as Frm,
  Group,
  Increments,
} from "@better-giving/ui";
import { DollarSign } from "lucide-react";
import { useFetcher } from "react-router";
import { GoalSelector } from "#/components/goal-selector";
import { ImgEditor } from "#/components/img-editor";
import { RichText } from "#/components/rich-text";
import { img_spec } from "#/pages/funds/common";
import { Videos } from "#/pages/funds/common/videos";
import type { IFund } from "#/types/fund";
import { increment_label_max_chars } from "@/schemas";
import { MAX_DESCRIPTION_CHARS } from "./schema";
import { Slug } from "./slug";
import { use_general, use_goal, use_media } from "./use-rhf";

interface ISaveButton {
  /** the section's name — three identical "Save" buttons on one page each
   *  announce what they save */
  section: string;
  /** nothing to save yet */
  held: boolean;
  busy: boolean;
}

/** held with `aria-disabled`, never `disabled`: the commit that re-seeds a
 *  saved section clean would blur a disabled button and drop focus on `<body>` */
function SaveButton({ section, held, busy }: ISaveButton) {
  const inert = held || busy;
  return (
    <button
      type="submit"
      aria-disabled={inert || undefined}
      aria-busy={busy || undefined}
      aria-label={busy ? `Saving ${section}…` : `Save ${section}`}
      className="btn btn-primary justify-self-end aria-disabled:bg-gray-3 aria-disabled:text-gray-11"
      onClick={(e) => {
        if (inert) e.preventDefault();
      }}
    >
      {busy ? "Saving…" : "Save"}
    </button>
  );
}

interface Props {
  fund: IFund;
  init_slug?: string;
  base_url: string;
}

export function Sections({ fund, init_slug = "", base_url }: Props) {
  const general = use_general(fund);
  const media = use_media(fund);
  const goal = use_goal(fund);
  const closer = useFetcher();
  const is_closing_fund = closer.state !== "idle";

  return (
    <>
      <Frm onSubmit={general.save} busy={general.busy}>
        <Group title="General">
          <Fieldset disabled={general.busy} busy={false} className="contents">
            <Field
              {...general.register("name")}
              label="Name"
              required
              error={general.errors.name?.message}
            />
            <Slug
              base_url={base_url}
              slug_init={init_slug}
              slug_new={general.slug}
              slug_field={
                <Field
                  {...general.register("slug")}
                  label="Campaign link"
                  placeholder="my-campaign"
                  error={general.errors.slug?.message}
                />
              }
            />
            <div className="grid gap-1">
              <p className="label" data-required>
                Description
              </p>
              <RichText
                ref={general.desc.ref}
                content={general.desc.value}
                onChange={general.desc.onChange}
                placeHolder="A short overview of your campaign"
                charLimit={MAX_DESCRIPTION_CHARS}
                classes={{
                  field:
                    "rich-text-toolbar border text-sm grid grid-rows-[auto_1fr] rounded bg-surface p-3 min-h-60",
                  counter: "text-gray-11",
                  error: "text-right",
                }}
                error={
                  general.errors.description?.value?.message ||
                  general.errors.description?.length?.message
                }
              />
            </div>
          </Fieldset>
          <SaveButton
            section="general"
            held={!general.is_dirty}
            busy={general.busy}
          />
        </Group>
      </Frm>

      <Frm onSubmit={media.save} busy={media.busy}>
        <Group title="Media">
          <Fieldset disabled={media.busy} busy={false} className="contents">
            <Videos {...media.videos} />
            <div className="grid gap-2">
              <label htmlFor="fund-banner" className="label">
                Banner
              </label>
              <ImgEditor
                id="fund-banner"
                ref={media.banner.ref}
                disabled={media.busy}
                value={media.banner.value}
                on_change={(v) => {
                  media.banner.onChange(v);
                  media.trigger("banner");
                }}
                on_undo={(e) => {
                  e.stopPropagation();
                  media.resetField("banner");
                }}
                spec={img_spec([4, 1])}
                classes={{ dropzone: "w-full aspect-4/1" }}
                error={media.errors.banner?.message}
              />
            </div>
            <div className="grid gap-2">
              <label htmlFor="fund-logo" className="label">
                Logo
              </label>
              <ImgEditor
                id="fund-logo"
                ref={media.logo.ref}
                disabled={media.busy}
                value={media.logo.value}
                on_change={(v) => {
                  media.logo.onChange(v);
                  media.trigger("logo");
                }}
                on_undo={(e) => {
                  e.stopPropagation();
                  media.resetField("logo");
                }}
                spec={img_spec([1, 1])}
                classes={{ dropzone: "w-full max-w-80 aspect-square" }}
                error={media.errors.logo?.message}
              />
            </div>
          </Fieldset>
          <SaveButton
            section="media"
            held={!media.is_dirty || media.is_uploading}
            busy={media.busy}
          />
        </Group>
      </Frm>

      <Frm onSubmit={goal.save} busy={goal.busy}>
        <Group title="Goal and amounts">
          <Fieldset disabled={goal.busy} busy={false} className="contents">
            <div className="grid gap-2">
              <p className="label" data-required>
                Goal
              </p>
              <GoalSelector
                value={goal.target_type.value}
                onChange={goal.target_type.onChange}
              />
            </div>
            {goal.target_type.value === "fixed" && (
              <Field
                {...goal.register("target.value", { shouldUnregister: true })}
                label="How much money do you want to raise?"
                placeholder="$"
                error={goal.errors?.target?.value?.message}
              />
            )}
            <Increments
              fields={goal.increments.fields}
              onAdd={(val) => {
                if (goal.increments.fields.length >= 4) {
                  return alert("You can only have 4 increments");
                }
                goal.increments.append({ value: val, label: "" });
              }}
              onRemove={(idx) => goal.increments.remove(idx)}
              countError={goal.errors.increments?.root?.message}
              field={(idx) => (
                <>
                  <BaseField.Root className="grid grid-rows-subgrid row-span-2">
                    <div className="relative w-full">
                      <DollarSign className="text-gray-11 absolute top-1/2 left-2 transform -translate-y-1/2 icon-md" />
                      <input
                        type="number"
                        {...goal.register(`increments.${idx}.value`)}
                        className="w-full h-full  outline-ring rounded text-sm font-medium bg-surface pl-8 pr-4 py-3.5 placeholder:text-gray-11 border disabled:pointer-events-none disabled:bg-gray-3 disabled:text-gray-11"
                      />
                    </div>

                    <p className="mt-1 empty:hidden text-left text-xs text-destructive-subtle-fg">
                      {goal.errors.increments?.[idx]?.value?.message}
                    </p>
                  </BaseField.Root>
                  <BaseField.Root className="grid grid-rows-subgrid row-span-2">
                    <textarea
                      {...goal.register(`increments.${idx}.label`)}
                      rows={2}
                      className="w-full  outline-ring rounded text-sm font-medium bg-surface px-4 py-3.5 placeholder:text-gray-11 border disabled:pointer-events-none disabled:bg-gray-3 disabled:text-gray-11"
                    />
                    <p
                      data-error={
                        !!goal.errors.increments?.[idx]?.label?.message
                      }
                      className="mt-1 text-left text-xs data-[error='true']:text-destructive-subtle-fg"
                    >
                      {goal.incs[idx].label.length}/{increment_label_max_chars}
                    </p>
                  </BaseField.Root>
                </>
              )}
            />
          </Fieldset>
          <SaveButton
            section="goal and amounts"
            held={!goal.is_dirty}
            busy={goal.busy}
          />
        </Group>
      </Frm>

      <button
        aria-disabled={is_closing_fund || undefined}
        aria-busy={is_closing_fund || undefined}
        onClick={() => {
          if (is_closing_fund) return;
          const fundNameConfirmation = window.prompt(
            "Type the name of this campaign to confirm"
          );
          if (!fundNameConfirmation) return;
          if (fundNameConfirmation !== fund.name) {
            return window.alert("Campaign not closed: the name doesn't match");
          }

          closer.submit(
            { close: true },
            { action: ".", method: "POST", encType: "application/json" }
          );
        }}
        type="button"
        className={`btn btn-destructive font-medium justify-self-start${is_closing_fund ? " pending" : ""}`}
      >
        {is_closing_fund ? "Closing…" : "Close campaign"}
      </button>
    </>
  );
}
