import { EMAILS } from "@better-giving/brand";
import { Modal } from "@better-giving/ui";
import { CircleAlert } from "lucide-react";

interface Props {
  /** name of the nonprofit already on the platform */
  name: string;
  onClose: () => void;
}

export function AlreadyRegistered({ name, onClose }: Props) {
  return (
    <Modal
      open
      onClose={onClose}
      size="panel"
      classes="p-8 bg-card text-gray-12 text-center"
    >
      <div className="bg-warning grid place-items-center size-14 rounded-full mx-auto mb-5">
        <CircleAlert className="text-warning-fg pictogram-sm" />
      </div>
      <h3 className="text-xl font-bold text-balance">
        This organization is already registered
      </h3>
      <p className="text-gray-11 text-pretty mt-3">
        {name} already has an account on Better Giving. Ask an existing admin to
        invite you, or email{" "}
        <a
          href={`mailto:${EMAILS.support}`}
          className="text-gray-12 font-bold underline"
        >
          {EMAILS.support}
        </a>{" "}
        for help getting access.
      </p>
      <button type="button" onClick={onClose} className="btn btn-primary mt-6">
        Got it
      </button>
    </Modal>
  );
}
