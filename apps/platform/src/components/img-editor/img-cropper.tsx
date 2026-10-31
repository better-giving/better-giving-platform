import { Dialog } from "@ark-ui/react/dialog";
import { Portal } from "@ark-ui/react/portal";
import type { AskProps } from "@better-giving/ui";
import { Save } from "lucide-react";
import { useMemo, useRef } from "react";
import { file_from_crop } from "./crop-output";
import { Cropper, type ICropperHandle } from "./cropper";

export interface IImgCropperProps {
  rounded?: boolean;
  input: File;
  aspect: [number, number];
}

/** asked, never mounted directly — `await ask<File>(ImgCropper, { input, aspect })`. */
export function ImgCropper({
  input,
  aspect,
  rounded,
  open,
  resolve,
  on_closed,
}: IImgCropperProps & AskProps<File>) {
  const [x, y] = aspect;
  const cropper_ref = useRef<ICropperHandle>(null);
  const src = useMemo(() => URL.createObjectURL(input), [input]);

  async function handle_save() {
    const blob = await cropper_ref.current?.get_cropped_blob();
    // the canvas bytes are whatever we encoded. the name and type have to
    // say that too, or the upload sniff rejects the body.
    const cropped = blob ? file_from_crop(blob, input.name) : input;
    return resolve(cropped);
  }

  // content area fills viewport constrained by aspect ratio
  const content_style = {
    width: `min(90vw, 80vh * ${x / y})`,
    aspectRatio: `${x} / ${y}`,
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        // dismissed — no file, and `ask` answers undefined
        if (!e.open) resolve();
      }}
      lazyMount
      unmountOnExit
      onExitComplete={on_closed}
    >
      <Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-overlay z-scrim" />
        <Dialog.Positioner className="contents">
          <Dialog.Content className="z-modal fixed-center bg-card rounded-card overflow-hidden">
            <div className="flex items-center justify-end gap-2 p-1 border-b border-hairline">
              <button
                type="button"
                aria-label="Save cropped image"
                className="glyph-btn hover:text-primary"
                onClick={handle_save}
              >
                <Save className="icon-xl" />
              </button>
            </div>
            <div style={content_style}>
              <Cropper
                src={src}
                aspect={aspect}
                mime={input.type}
                rounded={rounded}
                ref={cropper_ref}
              />
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
