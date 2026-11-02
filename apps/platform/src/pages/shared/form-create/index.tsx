import { Modal } from "@better-giving/ui";
import { X } from "lucide-react";
import { useLoaderData, useNavigate } from "react-router";
import type { ILoaderData } from "./api";
import { Form } from "./form";

export { ErrorModal as ErrorBoundary } from "#/components/error";

export default function Page() {
  const loaderData = useLoaderData<ILoaderData>();
  const navigate = useNavigate();
  const close = () =>
    navigate({ pathname: ".." }, { replace: true, preventScrollReset: true });

  return (
    <Modal
      open={true}
      onClose={close}
      size="panel"
      title="Create donation form"
      classes="grid isolate bg-popover"
    >
      <Form {...loaderData} />
      {/* after the form in the dom so the dialog's first focus is the first
          field, not Close; drawn above it */}
      <div className="order-first flex justify-end px-4 pt-4">
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="btn btn-icon btn-secondary"
        >
          <X className="icon-xl" />
        </button>
      </div>
    </Modal>
  );
}
