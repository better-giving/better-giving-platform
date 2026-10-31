import { Dialog } from "@ark-ui/react/dialog";
import { Actions, Modal } from "@better-giving/ui";
import { CircleAlert } from "lucide-react";
import {
  isRouteErrorResponse,
  useLocation,
  useNavigate,
  useRouteError,
} from "react-router";
import { GENERIC_ERROR_MESSAGE } from "@/constants/common";

const TITLE = "Something went wrong";

const STATUS_MESSAGES: Record<number, string> = {
  400: "The request was invalid.",
  403: "You don't have permission to do that.",
  404: "The resource you requested was not found.",
  500: "Something went wrong on our end.",
};

// error boundary for modal child routes: closes back to the parent route, query kept
export function ErrorModal() {
  // route errors already reported by entry.server handleError; only renders UI.
  const error = useRouteError();
  const navigate = useNavigate();
  const { search } = useLocation();
  // a reload re-runs the loader that threw, so the modal would only come back
  const close = () =>
    navigate(
      { pathname: "..", search },
      { replace: true, preventScrollReset: true }
    );

  let message = GENERIC_ERROR_MESSAGE;
  if (isRouteErrorResponse(error)) {
    message =
      STATUS_MESSAGES[error.status] ??
      error.statusText ??
      GENERIC_ERROR_MESSAGE;
  }

  return (
    <Modal open={true} onClose={close} classes="grid bg-card text-gray-12">
      <div className="px-6 pb-4 text-center mt-6">
        <CircleAlert className="text-destructive mx-auto pictogram-md" />
        <Dialog.Title className="font-bold mt-3">{TITLE}</Dialog.Title>
        <p className="text-gray-11 text-sm mt-2 text-balance">{message}</p>
      </div>
      <Actions band>
        <button
          onClick={close}
          type="button"
          className="inline-block btn btn-primary"
        >
          Ok
        </button>
      </Actions>
    </Modal>
  );
}
