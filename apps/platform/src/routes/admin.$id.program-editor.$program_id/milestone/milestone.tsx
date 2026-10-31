import { Collapsible } from "@ark-ui/react/collapsible";
import { DrawerIcon, Field, Form, Label } from "@better-giving/ui";
import { toYYYMMDD } from "@better-giving/ui/helpers";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useController, useForm } from "react-hook-form";
import { useFetcher } from "react-router";
import { ImgEditor } from "#/components/img-editor";
import { RichText } from "#/components/rich-text";
import type { IMilestone, IMilestoneUpdate } from "@/npo";
import { img_spec, MAX_CHARS } from "../common";
import { type FV, schema } from "./schema";

type Props = IMilestone & { programId: string };
export function Milestone(props: Props) {
  const {
    register,
    handleSubmit,
    formState: { isDirty, isSubmitting, errors },
    control,
    trigger,
    resetField,
  } = useForm<FV>({
    values: {
      date: toYYYMMDD(new Date(props.date)),
      title: props.title,
      media: props.media ?? "",
      description: { value: props.description_pt },
    },
    resolver: valibotResolver(schema),
  });

  const { field: desc } = useController({ control, name: "description" });
  const { field: media } = useController({ control, name: "media" });

  const fetcher = useFetcher();

  return (
    <Collapsible.Root className="bg-panel rounded overflow-hidden">
      <div className="relative py-3 px-4 text-center bg-gray-3">
        <span className="text-xl font-bold ">{props.title}</span>
        <Collapsible.Trigger className="absolute right-4 top-1/2 -translate-y-1/2 group">
          <DrawerIcon
            is_open={false}
            className="icon-xl group-data-[state=open]:rotate-180"
          />
        </Collapsible.Trigger>
      </div>

      <Collapsible.Content
        asChild
        className="data-[state=open]:border-t border-hairline bg-panel py-6 px-4 grid content-start gap-6"
      >
        <Form
          disabled={isSubmitting}
          onSubmit={handleSubmit((fv) => {
            const update: IMilestoneUpdate = {
              description_pt: fv.description.value,
              title: fv.title,
              date: new Date(fv.date).toISOString(),
              ...(fv.media && { media: fv.media }),
            };
            fetcher.submit(
              {
                ...update,
                intent: "edit-milestone",
                "milestone-id": props.id,
              },
              {
                encType: "application/json",
                method: "POST",
                action: ".",
              }
            );
          })}
        >
          <Label htmlFor={`milestone-${props.id}-media`} className="-mb-4">
            Image of milestone
          </Label>
          <ImgEditor
            id={`milestone-${props.id}-media`}
            ref={media.ref}
            value={media.value}
            on_change={(v) => {
              media.onChange(v);
              trigger("media");
            }}
            on_undo={(e) => {
              e.stopPropagation();
              resetField("media");
            }}
            spec={img_spec([4, 1])}
            classes={{
              container: "mb-4",
              dropzone: "w-full @md:aspect-4/1 h-36 @md:h-auto",
            }}
            error={errors.media?.message}
          />
          <Field
            {...register("date")}
            type="date"
            classes={{ input: "date-input uppercase" }}
            label="Date of milestone"
            placeholder="e.g. 2014-09-23"
            required
            error={errors.date?.message}
          />
          <Field
            {...register("title")}
            label="Title of milestone"
            placeholder="e.g. John"
            required
            error={errors.title?.message}
          />
          <Label className="-mb-4">Description of milestone</Label>
          <RichText
            content={desc.value}
            onChange={desc.onChange}
            ref={desc.ref}
            charLimit={MAX_CHARS}
            classes={{
              field:
                "rich-text-toolbar border text-sm grid grid-rows-[auto_1fr] rounded bg-surface p-3 min-h-60",
              counter: "text-gray-11",
            }}
            error={
              errors.description?.value?.message ||
              errors.description?.length?.message
            }
          />
          <div className="mt-2 flex gap-2 flex-col @lg:flex-row justify-between">
            <button
              disabled={fetcher.state !== "idle"}
              type="button"
              className="btn btn-destructive"
              onClick={() => {
                if (!window.confirm("Delete milestone?")) return;
                fetcher.submit(
                  { intent: "delete-milestone", "milestone-id": props.id },
                  { method: "POST", encType: "application/json" }
                );
              }}
            >
              {fetcher.formData?.get("intent") === "delete-milestone" &&
              fetcher.state !== "idle"
                ? "Deleting.."
                : "Delete"}{" "}
              milestone
            </button>
            <button
              disabled={
                !isDirty ||
                fetcher.state !== "idle" ||
                media.value === "loading"
              }
              type="submit"
              className="btn btn-primary"
            >
              Save changes
            </button>
          </div>
        </Form>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
