import { Steps } from "@ark-ui/react/steps";
import { DrawerIcon } from "@better-giving/ui";
import { useState } from "react";
import { useLocation } from "react-router";
import { id_param_to_num } from "#/helpers/id-param-to-num";
import type { IReg, Progress } from "@/reg";

const FSA_LABEL = "Fiscal Sponsorship";
const labels_501c3 = ["Contact Details", "Organization", "Banking", "Review"];
const labels_other = [
  "Contact Details",
  "Organization",
  FSA_LABEL,
  "Banking",
  "Review",
];

type Props = {
  step: Progress["step"];
  o_type: IReg["o_type"];
  classes?: string;
};

export function ProgressIndicator({ step, o_type, classes = "" }: Props) {
  const { pathname } = useLocation();
  const paths = pathname.split("/");
  const curr_path = id_param_to_num(paths.at(-1));

  // step numbers are the same for everyone, but a 501(c)(3) has no step 3 —
  // so its four labels sit one position left of steps 4 and 5.
  const is_501c3 = o_type === "501c3";
  const labels = is_501c3 ? labels_501c3 : labels_other;
  const pos = (n: number) => (is_501c3 && n >= 4 ? n - 1 : n);

  const active_index = pos(curr_path) - 1;

  // `Steps.Item` carries no completion state of its own — zag puts
  // `data-complete` on Trigger/Indicator/Separator, none of which this stepper
  // renders — so the rows behind the current step are marked here instead.
  // `step` is where the row data says the applicant is, which can sit ahead of
  // the page being viewed (back button, a stale link).
  const completed = pos(step) - 1;

  // mobile expansion only; desktop renders all items via CSS regardless.
  // avoids JS-driven `isDesktop` state which caused SSR/hydration layout flash.
  const [is_expanded, set_expanded] = useState(false);

  // anchor mobile toggle button to whichever row is first-visible:
  // expanded → row 0 (Contact); collapsed → the active row (only one shown).
  const first_visible = is_expanded ? 0 : active_index;

  return (
    <div
      style={{ "--gutter": "2.5rem" } as React.CSSProperties}
      className={`pb-4 pt-4 md:pt-2 max-md:pr-(--gutter) pl-12 md:pl-14 max-md:border-b border-hairline ${classes}`}
    >
      <Steps.Root
        step={Math.max(active_index, 0)}
        count={labels.length}
        orientation="vertical"
        data-expanded={is_expanded || undefined}
        className="group/root w-full"
      >
        <Steps.List>
          {labels.map((label, i) => (
            <Steps.Item
              key={i}
              index={i}
              data-curr={i === active_index || undefined}
              data-complete={i < completed || undefined}
              className="group hidden data-curr:block group-data-expanded/root:block md:block"
            >
              <div className="h-5.5 border-l group-data-complete:border-primary group-data-curr:border-primary my-2 group-first:hidden" />
              <div className="flex items-center w-full">
                <div className="w-4 aspect-square bg-gray-3 group-data-complete:bg-primary rounded-full transform -translate-x-1/2" />
                <span className="text-sm text-gray-11 group-data-curr:text-primary">
                  {label}
                </span>
                {i === first_visible && (
                  <button
                    type="button"
                    onClick={() => set_expanded((p) => !p)}
                    style={{ marginRight: "calc(var(--gutter) * -0.5)" }}
                    className="md:hidden ml-auto p-2 -my-2"
                    aria-label={is_expanded ? "Collapse steps" : "Expand steps"}
                    aria-expanded={is_expanded}
                  >
                    <DrawerIcon is_open={is_expanded} className="icon-xl" />
                  </button>
                )}
              </div>
            </Steps.Item>
          ))}
        </Steps.List>
      </Steps.Root>
    </div>
  );
}
