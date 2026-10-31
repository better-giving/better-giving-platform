import { RouteModal } from "#/components/route-modal";
import { Panel } from "./panel";
import type { Props } from "./types";

export function Form(props: Props) {
  return (
    <RouteModal
      classes="grid bg-card text-gray-12 p-6"
      busy={props.is_submitting}
    >
      <Panel {...props} />
    </RouteModal>
  );
}
