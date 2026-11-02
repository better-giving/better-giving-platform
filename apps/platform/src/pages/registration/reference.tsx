import { DrawerIcon } from "@better-giving/ui";
import { Arrow, Content, Tooltip } from "@better-giving/ui/tooltip";
import { CircleHelp } from "lucide-react";
import { useId, useState } from "react";

type Props = {
  id: string;
  classes?: string;
};

export default function Reference({ id, classes = "" }: Props) {
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const tooltip_id = useId();

  return (
    <div
      className={`${classes} w-full py-4 px-6 text-sm text-left md:text-center md:text-gray-11 md:border-t md:border-hairline`}
    >
      <div className="relative">
        <span className="font-semibold mr-2">Your registration number:</span>
        <span className="block mt-1 md:inline md:mt-0">{id}</span>

        {/* hidden outside the Tooltip: a glyph hidden inside it would leave
            the wrapping button as an invisible tab stop */}
        <span className="hidden md:inline-block ml-5">
          <Tooltip
            tip={
              <Content className="text-xs max-w-xs">
                {tooltip}
                <Arrow />
              </Content>
            }
          >
            <CircleHelp className="inline-block icon-xs" />
          </Tooltip>
        </span>
        <button
          type="button"
          aria-label={
            isTooltipOpen
              ? "Hide what this number is for"
              : "Show what this number is for"
          }
          aria-expanded={isTooltipOpen}
          aria-controls={tooltip_id}
          onClick={() => {
            setIsTooltipOpen((p) => !p);
          }}
          className="absolute -right-1 top-1/2 transform -translate-y-1/2 md:hidden"
        >
          <DrawerIcon is_open={isTooltipOpen} className="icon-xl" />
        </button>
      </div>
      <p
        id={tooltip_id}
        hidden={!isTooltipOpen}
        className="md:hidden mt-4 text-gray-11"
      >
        {tooltip}
      </p>
    </div>
  );
}

const tooltip =
  "Enter this number on the registration page to continue from where you finished.";
