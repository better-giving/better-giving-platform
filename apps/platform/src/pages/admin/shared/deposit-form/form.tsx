import { useNavigate } from "react-router";
import { RouteModal } from "#/components/route-modal";
import { Panel } from "./panel";
import type { Props } from "./types";

export function Form(props: Props) {
  const navigate = useNavigate();
  const close = () =>
    navigate("..", { replace: true, preventScrollReset: true });

  return (
    <RouteModal size="md" classes="bg-popover text-gray-12">
      <Panel {...props} onClose={close} />
    </RouteModal>
  );
}
