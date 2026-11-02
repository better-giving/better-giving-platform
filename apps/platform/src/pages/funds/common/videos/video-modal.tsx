import { Actions, Field, Modal } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { X } from "lucide-react";
import { useForm } from "react-hook-form";
import { object } from "valibot";
import { videoUrl } from "./types";

interface IVideoModal {
  onSubmit: (url: string) => void;
  initUrl?: string;
  open: boolean;
  set_open: (open: boolean) => void;
}

export function VideoModal(props: IVideoModal) {
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm({
    resolver: valibotResolver(object({ url: videoUrl })),
    values: { url: props.initUrl ?? "" },
  });

  return (
    <Modal
      open={props.open}
      onClose={() => props.set_open(false)}
      classes="grid bg-popover"
    >
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleSubmit((data) => {
            props.onSubmit(data.url);
            props.set_open(false);
          })();
        }}
      >
        <div className="relative">
          <h2 className="text-xl font-bold text-center border-b border-hairline p-5">
            {props.initUrl ? "Edit" : "Add"} video
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => props.set_open(false)}
            className="btn btn-icon btn-secondary absolute top-1/2 right-4 -translate-y-1/2"
          >
            <X className="icon-xl" />
          </button>
        </div>
        <div className="p-4">
          <Field
            {...register("url")}
            placeholder="e.g. https://youtu.be/XOUjJqQ68Ec?si=-WX60lgPXUWAXPCY"
            name="url"
            label="Web Address (URL)"
            required
            error={errors.url?.message}
          />
        </div>

        <Actions band classes="mt-4">
          <button
            type="button"
            className="btn-secondary btn"
            onClick={() => props.set_open(false)}
          >
            Cancel
          </button>
          <button disabled={!isDirty} type="submit" className="btn btn-primary">
            Continue
          </button>
        </Actions>
      </form>
    </Modal>
  );
}
