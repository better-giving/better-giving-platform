import { Slider } from "@ark-ui/react/slider";
import { HandCoins, PiggyBank, Sprout } from "lucide-react";
import type { ReactNode } from "react";
import type { IAllocation } from "@/donations";

interface Props {
  disabled?: boolean;
  /** cash, liq, lock */
  value: IAllocation;
  onChange: (value: IAllocation) => void;
  classes?: string;
}

export type Boundary = [number, number];

const toBoundary = (val: IAllocation): Boundary => {
  return [val.cash, 100 - val.lock];
};

const toAlloc = ([b1, b2]: Boundary): IAllocation => {
  return {
    cash: b1,
    liq: b2 - b1,
    lock: 100 - b2,
  };
};

export function AllocationSlider({
  disabled = false,
  value,
  onChange,
  classes = "",
}: Props) {
  const boundary = toBoundary(value);

  return (
    <div
      className={`${classes} grid gap-y-4 border border-hairline p-4 rounded`}
    >
      {/** percentages */}
      <div className="grid grid-cols-[auto_auto_1fr_auto] gap-y-2">
        <Row
          title="Grant"
          icon={<HandCoins className="text-gray-11 icon-xl" />}
          pct={value.cash}
        />
        <Row
          title="Savings"
          icon={<PiggyBank width={20} className="text-warning" />}
          pct={value.liq}
        />
        <Row
          title="Investment"
          icon={<Sprout className="text-success icon-xl" />}
          pct={value.lock}
        />
      </div>

      {/** slider */}
      <Slider.Root
        value={boundary}
        minStepsBetweenThumbs={0}
        onValueChange={(e) => onChange(toAlloc(e.value as Boundary))}
        className="group/slider relative flex items-center select-none touch-none mt-2"
        disabled={disabled}
      >
        <Slider.Control className="flex w-full items-center">
          <Slider.Track
            style={
              disabled
                ? undefined
                : {
                    backgroundImage: `linear-gradient(to right, var(--gray-4) 0%, var(--gray-4) ${boundary[0]}%, var(--success) ${boundary[0]}%, var(--success) 100%)`,
                  }
            }
            className="inset-shadow-track bg-gray-4 group-aria-disabled/slider:bg-gray-3 relative grow rounded-full h-2"
          >
            <Slider.Range className="absolute bg-warning group-aria-disabled/slider:bg-gray-3 rounded-full h-full" />
          </Slider.Track>
          <Slider.Thumb
            index={0}
            className="block size-5 rounded-full bg-gray-11 shadow-track-fill group-aria-disabled/slider:bg-gray-11"
          />
          <Slider.Thumb
            index={1}
            className="block size-5 rounded-full bg-surface shadow-track-fill border-2 border-gray-11 group-aria-disabled/slider:bg-gray-11"
          />
        </Slider.Control>
      </Slider.Root>
    </div>
  );
}

interface IRow {
  title: string;
  icon: ReactNode;
  pct: number;
}

function Row(props: IRow) {
  return (
    <div className="grid grid-cols-subgrid col-span-full items-center gap-x-1">
      {props.icon}
      <p className="text-sm ml-2">{props.title}</p>
      <p className="text-right mr-2">{props.pct}%</p>
    </div>
  );
}
