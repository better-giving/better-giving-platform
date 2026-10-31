import { Progress } from "@ark-ui/react/progress";
import type { ReactNode } from "react";
import diversity from "../assets/diversity.svg";
import { to_usd } from "../helpers/to-usd";

export interface ITarget {
  text?: ReactNode;
  progress: number;
  target: "smart" | number | null;
  classes?: string;
}

export type TTarget = "smart" | "0" | (string & {});

export const to_target = (target: TTarget): "smart" | number | null => {
  if (target === "0") return null;
  return target === "smart" ? "smart" : +target;
};

export function Target({ text, target, classes = "", progress }: ITarget) {
  if (target === null) return null;
  const to = target === "smart" ? smart_next(progress) : target;
  if (!(to > 0) || Number.isNaN(progress)) return null;

  return (
    <div className={classes}>
      {text}
      <Progress.Root
        value={Math.min(progress, to)}
        max={to}
        className="h-1.5 w-full"
      >
        <Progress.Track className="h-full w-full rounded-full bg-gray-3 inset-shadow-track">
          <Progress.Range className="h-full rounded-full bg-success shadow-track-fill" />
        </Progress.Track>
      </Progress.Root>
      <div className="flex items-center justify-between mt-1">
        <p className="flex items-center gap-x-1 text-sm text-gray-11">
          <span className="font-medium">{to_usd(progress)}</span>
          <span className="text-xs">Raised</span>
        </p>
        <p className="flex items-center gap-x-1 text-sm text-gray-11">
          <span className="font-medium">{to_usd(to)}</span>
          <span className="text-xs">Goal</span>
        </p>
      </div>
    </div>
  );
}

Target.Inline = ({ text, target, classes = "", progress }: ITarget) => {
  if (target === null) return null;
  const to = target === "smart" ? smart_next(progress) : target;
  if (!(to > 0) || Number.isNaN(progress)) return null;

  return (
    <div className={`flex items-center gap-x-3 ${classes}`}>
      {text}
      <p className="flex items-center gap-x-1 text-sm text-gray-11 whitespace-nowrap">
        <span className="font-medium">{to_usd(progress)}</span>
        <span className="text-xs">Raised</span>
      </p>
      <Progress.Root
        value={Math.min(progress, to)}
        max={to}
        className="h-1.5 flex-1"
      >
        <Progress.Track className="h-full w-full rounded-full bg-gray-3 inset-shadow-track">
          <Progress.Range className="h-full rounded-full bg-success shadow-track-fill" />
        </Progress.Track>
      </Progress.Root>
      <p className="flex items-center gap-x-1 text-sm text-gray-11 whitespace-nowrap">
        <span className="font-medium">{to_usd(to)}</span>
        <span className="text-xs">Goal</span>
      </p>
    </div>
  );
};

Target.Text = ({ classes = "" }) => {
  return (
    <p className={classes}>
      <img
        src={diversity}
        width={20}
        height={20}
        className="inline-block relative mr-2 bottom-1"
        alt=""
      />
      <span className="text-sm font-medium text-gray-11">
        Help them reach their goal!
      </span>
    </p>
  );
};

export function smart_next(progress: number): number {
  const base = 100;
  const multiplier = 2;
  let next = base;

  while (next <= progress) {
    next *= multiplier;
  }

  return next;
}
