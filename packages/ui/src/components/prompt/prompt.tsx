import { Dialog } from "@ark-ui/react/dialog";
import { X } from "lucide-react";
import type { PropsWithChildren } from "react";
import { useNavigate } from "react-router";
import { Actions } from "../form/actions";
import { Modal } from "../modal";
import { PromptIcon } from "./prompt-icon";

// what the icon says to a sighted reader, said to a screen reader as the name
const type_titles = {
  success: "Success",
  error: "Error",
  loading: "Loading",
} as const;

export interface IPrompt extends PropsWithChildren {
  type?: "success" | "error" | "loading";
  open?: boolean;
  onClose?: () => void;
  isDismissable?: boolean;
  /** fired once the close animation has finished and the content is unmounted. */
  onExitComplete?: () => void;
  /** accessible name — defaults to the one `type`'s icon conveys. */
  title?: string;
}

export function Prompt({
  type,
  title = type && type_titles[type],
  children,
  onClose,
  open,
  isDismissable = true,
  onExitComplete,
}: IPrompt) {
  const navigate = useNavigate();
  function close() {
    if (!isDismissable) return;
    if (onClose) return onClose();
    navigate("..", { preventScrollReset: true, replace: true });
  }
  return (
    <Modal
      open={open ?? true}
      onClose={close}
      onExitComplete={onExitComplete}
      title={title}
      classes="grid bg-card text-gray-12"
    >
      <div className="flex justify-end p-4 border-b border-hairline">
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="btn btn-icon btn-secondary"
        >
          <X className="icon-xl" />
        </button>
      </div>

      <PromptIcon type={type} classes="mb-6 sm:mb-8 mt-4 sm:mt-12" />
      {/* a div: callers pass block content */}
      <Dialog.Description asChild>
        <div className="px-6 pb-4 text-center text-gray-11">{children}</div>
      </Dialog.Description>
      <Actions band>
        <button
          onClick={close}
          type="button"
          className="inline-block btn btn-primary"
        >
          {type === "success" ? "Done" : "Ok"}
        </button>
      </Actions>
    </Modal>
  );
}
